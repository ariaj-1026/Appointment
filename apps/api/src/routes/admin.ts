/**
 * Admin console (role: admin).
 *
 *  Accounts   — create employee/admin logins (the only way they exist),
 *               edit, deactivate, reset password, delete.
 *  Deletion   — hard-delete patients, appointments and users; a full snapshot
 *               of what was deleted is kept in the activity log.
 *  Activity   — who signed in, from where, and every change.
 *  Settings   — clinic time zone.
 *
 * Admins cannot edit services, staff or business hours (employee-only).
 */
import type { FastifyPluginAsync } from 'fastify';
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lt, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { ROLES, Email } from '@clinic/shared';
import type { DB } from '../db/client.js';
import { activity_log, appointments, clinic_settings, patients, staff, users } from '../db/schema.js';
import { logActivity } from '../domain/activity.js';
import { sendAccountEmail } from '../domain/notify.js';
import { getAppointment, getPatient } from '../domain/scheduling.js';
import { currentUser, publicUser } from '../lib/auth.js';
import { NotFoundError, ValidationError, isUniqueViolation } from '../lib/errors.js';
import { hashPassword } from '../lib/password.js';
import { getClinicZone } from '../lib/settings.js';
import { templates } from '../lib/templates.js';
import { clinicDayBounds, isValidZone, now, toClinicIso, toClinicIsoOrNull } from '../lib/time.js';
import { id, idParams, isoDate, parse } from '../lib/validate.js';
import { password } from './auth.js';

const StaffRole = z.enum(['employee', 'admin']);

const UserCreate = z.object({
  email: Email,
  full_name: z.string().trim().min(1).max(160),
  role: StaffRole,
  password,
  staff_id: id.nullable().optional(),
});

const UserUpdate = z
  .object({
    full_name: z.string().trim().min(1).max(160),
    role: StaffRole,
    is_active: z.boolean(),
    staff_id: id.nullable(),
  })
  .partial();

export const adminRoutes: FastifyPluginAsync<{ db: DB }> = async (app, { db }) => {
  async function getUser(userId: number) {
    const [u] = await db.select().from(users).where(eq(users.id, userId));
    if (!u) throw new NotFoundError(`No user with id ${userId}.`);
    return u;
  }

  async function activeAdminCount() {
    return db.$count(users, and(eq(users.role, 'admin'), eq(users.is_active, true)));
  }

  async function withStaffLinks(rows: (typeof users.$inferSelect)[]) {
    const ids = rows.map((r) => r.id);
    const links = ids.length
      ? await db.select({ id: staff.id, full_name: staff.full_name, user_id: staff.user_id }).from(staff).where(inArray(staff.user_id, ids))
      : [];
    const zone = await getClinicZone(db);
    return rows.map((u) => {
      const link = links.find((l) => l.user_id === u.id);
      return {
        ...publicUser(u),
        created_at: toClinicIso(u.created_at, zone),
        last_login_at: toClinicIsoOrNull(u.last_login_at, zone),
        staff: link ? { id: link.id, full_name: link.full_name } : null,
      };
    });
  }

  async function linkStaff(tx: Pick<DB, 'update'>, userId: number, staffId: number | null | undefined) {
    if (staffId === undefined) return;
    await tx.update(staff).set({ user_id: null }).where(eq(staff.user_id, userId));
    if (staffId !== null) {
      const res = await tx.update(staff).set({ user_id: userId }).where(eq(staff.id, staffId)).returning();
      if (!res.length) throw new NotFoundError(`No staff member with id ${staffId}.`);
    }
  }

  // ---- Accounts ----

  app.get('/users', async (req) => {
    const q = parse(
      z.object({ role: z.enum(ROLES).optional(), q: z.string().optional() }),
      req.query,
    );
    const conds: SQL[] = [];
    if (q.role) conds.push(eq(users.role, q.role));
    if (q.q?.trim()) conds.push(or(ilike(users.email, `%${q.q.trim()}%`), ilike(users.full_name, `%${q.q.trim()}%`))!);
    const rows = await db
      .select()
      .from(users)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(users.role), asc(users.full_name))
      .limit(500);
    return withStaffLinks(rows);
  });

  app.post('/users', async (req, reply) => {
    const body = parse(UserCreate, req.body);
    let created: typeof users.$inferSelect;
    try {
      created = await db.transaction(async (tx) => {
        const [u] = await tx
          .insert(users)
          .values({
            email: body.email,
            full_name: body.full_name,
            role: body.role,
            password_hash: await hashPassword(body.password),
            created_by: req.actor.user_id,
          })
          .returning();
        await linkStaff(tx, u!.id, body.staff_id);
        await logActivity(tx, req.actor, {
          action: 'create',
          entity: 'user',
          entity_id: u!.id,
          after: { email: body.email, full_name: body.full_name, role: body.role, staff_id: body.staff_id ?? null },
        });
        return u!;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ValidationError('An account with this email already exists.', { field: 'email' });
      throw err;
    }
    await sendAccountEmail({ email: created.email, name: created.full_name }, templates.staffWelcome(created.full_name, created.email, created.role));
    return reply.status(201).send((await withStaffLinks([created]))[0]);
  });

  app.patch('/users/:id', async (req) => {
    const { id: userId } = parse(idParams, req.params);
    const body = parse(UserUpdate, req.body);
    const me = currentUser(req);
    const target = await getUser(userId);

    if (target.role === 'patient' && (body.role || body.staff_id !== undefined)) {
      throw new ValidationError('Patient accounts cannot be given a staff role or staff link.');
    }
    if (userId === me.id && (body.is_active === false || (body.role && body.role !== 'admin'))) {
      throw new ValidationError('You cannot deactivate or demote your own account.');
    }
    const losesAdmin = target.role === 'admin' && target.is_active && (body.is_active === false || (body.role && body.role !== 'admin'));
    if (losesAdmin && (await activeAdminCount()) <= 1) {
      throw new ValidationError('This is the last active admin account.');
    }

    const { staff_id, ...fields } = body;
    const updated = await db.transaction(async (tx) => {
      let row = target;
      if (Object.keys(fields).length) {
        [row] = await tx.update(users).set(fields).where(eq(users.id, userId)).returning() as [typeof target];
      }
      await linkStaff(tx, userId, staff_id);
      await logActivity(tx, req.actor, {
        action: body.is_active === false ? 'deactivate' : body.is_active === true ? 'reactivate' : 'update',
        entity: 'user',
        entity_id: userId,
        before: Object.fromEntries(Object.keys(fields).map((k) => [k, target[k as keyof typeof target]])),
        after: body,
      });
      return row;
    });
    return (await withStaffLinks([updated]))[0];
  });

  app.post('/users/:id/password', async (req) => {
    const { id: userId } = parse(idParams, req.params);
    const body = parse(z.object({ password }), req.body);
    const target = await getUser(userId);
    await db.update(users).set({ password_hash: await hashPassword(body.password) }).where(eq(users.id, target.id));
    await logActivity(db, req.actor, { action: 'password_set_by_admin', entity: 'user', entity_id: userId });
    return { ok: true };
  });

  app.delete('/users/:id', async (req) => {
    const { id: userId } = parse(idParams, req.params);
    const me = currentUser(req);
    if (userId === me.id) throw new ValidationError('You cannot delete your own account.');
    const target = await getUser(userId);
    if (target.role === 'admin' && target.is_active && (await activeAdminCount()) <= 1) {
      throw new ValidationError('This is the last active admin account.');
    }
    await db.transaction(async (tx) => {
      // A patient's clinical record survives as a walk-in record (user_id → null).
      await tx.delete(users).where(eq(users.id, userId));
      await logActivity(tx, req.actor, {
        action: 'delete',
        entity: 'user',
        entity_id: userId,
        before: { ...publicUser(target) },
      });
    });
    return { ok: true };
  });

  // ---- Record deletion ----

  app.delete('/patients/:id', async (req) => {
    const { id: patientId } = parse(idParams, req.params);
    const body = parse(z.object({ reason: z.string().trim().min(1, 'A reason is required') }), req.body);
    const patient = await getPatient(db, patientId);
    const appts = await db.select().from(appointments).where(eq(appointments.patient_id, patientId));
    await db.transaction(async (tx) => {
      await tx.delete(patients).where(eq(patients.id, patientId)); // cascades to appointments
      await logActivity(tx, req.actor, {
        action: 'delete',
        entity: 'patient',
        entity_id: patientId,
        before: { ...patient, appointments: appts },
        note: body.reason,
      });
    });
    return { ok: true, deleted_appointments: appts.length };
  });

  app.delete('/appointments/:id', async (req) => {
    const { id: appointmentId } = parse(idParams, req.params);
    const body = parse(z.object({ reason: z.string().trim().min(1, 'A reason is required') }), req.body);
    const a = await getAppointment(db, appointmentId);
    const { patient, staff: member, service, ...row } = a;
    await db.transaction(async (tx) => {
      await tx.delete(appointments).where(eq(appointments.id, appointmentId));
      await logActivity(tx, req.actor, {
        action: 'delete',
        entity: 'appointment',
        entity_id: appointmentId,
        before: {
          ...row,
          patient_name: `${patient.first_name} ${patient.last_name}`,
          staff_name: member.full_name,
          service_name: service.name,
        },
        note: body.reason,
      });
    });
    return { ok: true };
  });

  // ---- Activity log ----

  app.get('/activity', async (req) => {
    const q = parse(
      z.object({
        user_id: id.optional(),
        role: z.enum([...ROLES, 'anonymous']).optional(),
        action: z.string().optional(),
        entity: z.string().optional(),
        entity_id: id.optional(),
        q: z.string().optional(),
        date_from: isoDate.optional(),
        date_to: isoDate.optional(),
        limit: z.coerce.number().int().min(1).max(1000).default(100),
        offset: z.coerce.number().int().min(0).default(0),
      }),
      req.query,
    );
    const zone = await getClinicZone(db);
    const conds: SQL[] = [];
    if (q.user_id) conds.push(eq(activity_log.user_id, q.user_id));
    if (q.role === 'anonymous') conds.push(isNull(activity_log.actor_role));
    else if (q.role) conds.push(eq(activity_log.actor_role, q.role));
    if (q.action) conds.push(eq(activity_log.action, q.action));
    if (q.entity) conds.push(eq(activity_log.entity, q.entity));
    if (q.entity_id) conds.push(eq(activity_log.entity_id, q.entity_id));
    if (q.date_from) conds.push(gte(activity_log.created_at, clinicDayBounds(q.date_from, zone)[0]));
    if (q.date_to) conds.push(lt(activity_log.created_at, clinicDayBounds(q.date_to, zone)[1]));
    if (q.q?.trim()) {
      const like = `%${q.q.trim()}%`;
      conds.push(or(ilike(users.email, like), ilike(users.full_name, like), ilike(activity_log.note, like))!);
    }
    const where = conds.length ? and(...conds) : undefined;

    const rows = await db
      .select({ log: activity_log, email: users.email, full_name: users.full_name })
      .from(activity_log)
      .leftJoin(users, eq(users.id, activity_log.user_id))
      .where(where)
      .orderBy(desc(activity_log.created_at), desc(activity_log.id))
      .limit(q.limit)
      .offset(q.offset);
    const [{ total }] = (await db
      .select({ total: count() })
      .from(activity_log)
      .leftJoin(users, eq(users.id, activity_log.user_id))
      .where(where)) as [{ total: number }];

    return {
      total,
      items: rows.map(({ log, email, full_name }) => ({
        ...log,
        created_at: toClinicIso(log.created_at, zone),
        user_email: email,
        user_name: full_name,
      })),
    };
  });

  app.get('/activity/actions', async () => {
    const rows = await db.selectDistinct({ action: activity_log.action }).from(activity_log).orderBy(asc(activity_log.action));
    return rows.map((r) => r.action);
  });

  // ---- Settings ----

  app.put('/settings', async (req) => {
    const body = parse(z.object({ timezone: z.string().trim().min(1) }), req.body);
    if (!isValidZone(body.timezone)) {
      throw new ValidationError(`'${body.timezone}' is not a known time zone (e.g. Asia/Manila).`, { field: 'timezone' });
    }
    const before = await getClinicZone(db);
    await db
      .insert(clinic_settings)
      .values({ id: 1, timezone: body.timezone, updated_by: req.actor.user_id, updated_at: now() })
      .onConflictDoUpdate({
        target: clinic_settings.id,
        set: { timezone: body.timezone, updated_by: req.actor.user_id, updated_at: now() },
      });
    await logActivity(db, req.actor, {
      action: 'update',
      entity: 'settings',
      entity_id: 1,
      before: { timezone: before },
      after: { timezone: body.timezone },
    });
    return { timezone: body.timezone };
  });
};

