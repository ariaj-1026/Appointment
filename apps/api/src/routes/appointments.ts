import type { FastifyPluginAsync } from 'fastify';
import { and, asc, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import { z } from 'zod';
import { AppointmentStatus } from '@clinic/shared';
import type { DB } from '../db/client.js';
import { appointments, patients } from '../db/schema.js';
import { APPOINTMENT_ACTIONS, appointmentHistory, logActivity } from '../domain/activity.js';
import {
  assertServiceBookable,
  assertStaffBookable,
  assertStaffOffersService,
  computeEnd,
  getAppointment,
  getPatient,
  getService,
  getStaff,
  validateSlot,
} from '../domain/scheduling.js';
import { serializeAppointmentDetail } from '../domain/serialize.js';
import { assertReschedulable, assertTransition } from '../domain/status.js';
import { InvalidStatusTransitionError, ValidationError } from '../lib/errors.js';
import { notifyPatient } from '../domain/notify.js';
import { getClinicZone } from '../lib/settings.js';
import { clinicDayBounds, now, parseClinicDateTime } from '../lib/time.js';
import { id, idParams, isoDate, parse } from '../lib/validate.js';
import { patientMatch } from './patients.js';

/** A datetime string; offset optional (none = clinic wall-clock time). */
const dateTimeInput = z.string().min(16, 'Expected a datetime like 2026-11-23T09:00');

const AppointmentCreate = z.object({
  patient_id: id,
  staff_id: id,
  service_id: id,
  starts_at: dateTimeInput,
  reason: z.string().nullable().optional(),
  // ends_at is deliberately absent: duration comes from the service.
});

const AppointmentReschedule = z.object({
  starts_at: dateTimeInput,
  staff_id: id.nullable().optional(),
  service_id: id.nullable().optional(),
  note: z.string().nullable().optional(),
});

const AppointmentStatusUpdate = z.object({
  status: AppointmentStatus,
  note: z.string().nullable().optional(),
});

function toInstant(value: string, zone: string, field = 'starts_at'): Date {
  const parsed = parseClinicDateTime(value, zone);
  if (!parsed) throw new ValidationError(`${field}: not a valid datetime`, { field });
  return parsed;
}

const iso = (d: Date) => d.toISOString();

export const appointmentRoutes: FastifyPluginAsync<{ db: DB }> = async (app, { db }) => {
  const detail = async (appointmentId: number, zone: string) =>
    serializeAppointmentDetail(await getAppointment(db, appointmentId), zone);

  // ---- Read ----

  app.get('/', async (req) => {
    const q = parse(z.object({ on: isoDate.optional(), staff_id: id.optional() }), req.query);
    const zone = await getClinicZone(db);
    const conds = [];
    if (q.on) {
      const [start, end] = clinicDayBounds(q.on, zone);
      conds.push(gte(appointments.starts_at, start), lt(appointments.starts_at, end));
    }
    if (q.staff_id) conds.push(eq(appointments.staff_id, q.staff_id));
    const rows = await db.query.appointments.findMany({
      where: conds.length ? and(...conds) : undefined,
      with: { patient: true, staff: true, service: true },
      orderBy: asc(appointments.starts_at),
    });
    return rows.map((r) => serializeAppointmentDetail(r, zone));
  });

  app.get('/search', async (req) => {
    const q = parse(
      z.object({
        q: z.string().optional(),
        staff_id: id.optional(),
        service_id: id.optional(),
        status: AppointmentStatus.optional(),
        date_from: isoDate.optional(),
        date_to: isoDate.optional(),
        limit: z.coerce.number().int().min(1).max(1000).default(200),
      }),
      req.query,
    );
    const zone = await getClinicZone(db);
    const conds = [];
    if (q.q?.trim()) {
      conds.push(
        inArray(
          appointments.patient_id,
          db.select({ id: patients.id }).from(patients).where(patientMatch(q.q)),
        ),
      );
    }
    if (q.staff_id) conds.push(eq(appointments.staff_id, q.staff_id));
    if (q.service_id) conds.push(eq(appointments.service_id, q.service_id));
    if (q.status) conds.push(eq(appointments.status, q.status));
    if (q.date_from) conds.push(gte(appointments.starts_at, clinicDayBounds(q.date_from, zone)[0]));
    if (q.date_to) conds.push(lt(appointments.starts_at, clinicDayBounds(q.date_to, zone)[1]));

    const rows = await db.query.appointments.findMany({
      where: conds.length ? and(...conds) : undefined,
      with: { patient: true, staff: true, service: true },
      orderBy: desc(appointments.starts_at),
      limit: q.limit,
    });
    return rows.map((r) => serializeAppointmentDetail(r, zone));
  });

  app.get('/:id', async (req) => {
    const { id: appointmentId } = parse(idParams, req.params);
    return detail(appointmentId, await getClinicZone(db));
  });

  app.get('/:id/history', async (req) => {
    const { id: appointmentId } = parse(idParams, req.params);
    const zone = await getClinicZone(db);
    await getAppointment(db, appointmentId); // 404 rather than an empty list
    return appointmentHistory(db, appointmentId, zone);
  });

  // ---- Write ----

  /** Employee booking: created as `scheduled`, refusing overlaps with 409. */
  app.post('/', async (req, reply) => {
    const body = parse(AppointmentCreate, req.body);
    const zone = await getClinicZone(db);
    const startsAt = toInstant(body.starts_at, zone);

    const createdId = await db.transaction(async (tx) => {
      await getPatient(tx, body.patient_id);
      const member = await getStaff(tx, body.staff_id);
      const service = await getService(tx, body.service_id);
      assertStaffBookable(member);
      assertServiceBookable(service);
      await assertStaffOffersService(tx, member, service);

      const endsAt = computeEnd(startsAt, service);
      await validateSlot(tx, { staff_id: member.id, starts_at: startsAt, ends_at: endsAt }, zone);

      const [row] = await tx
        .insert(appointments)
        .values({
          patient_id: body.patient_id,
          staff_id: member.id,
          service_id: service.id,
          starts_at: startsAt,
          ends_at: endsAt,
          reason: body.reason ?? null,
          status: 'scheduled',
          booked_via: 'employee',
          created_by: req.actor.user_id,
        })
        .returning();
      await logActivity(tx, req.actor, {
        action: APPOINTMENT_ACTIONS.created,
        entity: 'appointment',
        entity_id: row!.id,
        after: { status: row!.status, starts_at: iso(startsAt), staff_id: member.id },
      });
      return row!.id;
    });
    await notifyPatient(db, createdId, { type: 'booked_by_clinic' });
    return reply.status(201).send(await detail(createdId, zone));
  });

  /**
   * Move through the lifecycle, rejecting illegal moves. Pending patient
   * requests go through /approve and /decline instead. Cancelling a portal
   * patient's appointment needs a reason, which is emailed to them.
   */
  app.patch('/:id/status', async (req) => {
    const { id: appointmentId } = parse(idParams, req.params);
    const body = parse(AppointmentStatusUpdate, req.body);
    const zone = await getClinicZone(db);

    const previous = await db.transaction(async (tx) => {
      const current = await getAppointment(tx, appointmentId);
      if (current.status === 'pending' && body.status !== 'pending') {
        throw new InvalidStatusTransitionError(
          'This is a patient request awaiting a decision. Approve or decline it instead.',
          { current_status: 'pending', target_status: body.status },
        );
      }
      assertTransition(current.status, body.status);
      if (body.status === 'cancelled') requireReasonForPortalPatient(current, body.note);
      await tx
        .update(appointments)
        .set({ status: body.status, updated_at: now() })
        .where(eq(appointments.id, appointmentId));
      await logActivity(tx, req.actor, {
        action: APPOINTMENT_ACTIONS.statusChanged,
        entity: 'appointment',
        entity_id: appointmentId,
        before: { status: current.status },
        after: { status: body.status },
        note: body.note ?? null,
      });
      return current;
    });
    if (body.status === 'cancelled' && previous.starts_at > now()) {
      await notifyPatient(db, appointmentId, { type: 'cancelled_by_clinic', reason: body.note });
    }
    return detail(appointmentId, zone);
  });

  /** Accept a patient's pending request. */
  app.post('/:id/approve', async (req) => {
    const { id: appointmentId } = parse(idParams, req.params);
    const body = parse(DecisionBody, req.body);
    const zone = await getClinicZone(db);
    await db.transaction(async (tx) => {
      const current = await getAppointment(tx, appointmentId);
      assertTransition(current.status, 'scheduled');
      if (current.starts_at < now()) {
        throw new ValidationError('This request is for a time that has already passed. Decline it instead.');
      }
      await tx
        .update(appointments)
        .set({ status: 'scheduled', decision_by: req.actor.user_id, decision_reason: body.reason ?? null, updated_at: now() })
        .where(eq(appointments.id, appointmentId));
      await logActivity(tx, req.actor, {
        action: APPOINTMENT_ACTIONS.statusChanged,
        entity: 'appointment',
        entity_id: appointmentId,
        before: { status: 'pending' },
        after: { status: 'scheduled' },
        note: body.reason ? `Approved: ${body.reason}` : 'Approved',
      });
    });
    await notifyPatient(db, appointmentId, { type: 'approved' });
    return detail(appointmentId, zone);
  });

  /** Refuse a patient's pending request; the reason is emailed to them. */
  app.post('/:id/decline', async (req) => {
    const { id: appointmentId } = parse(idParams, req.params);
    const body = parse(z.object({ reason: z.string().trim().min(1, 'A reason is required') }), req.body);
    const zone = await getClinicZone(db);
    await db.transaction(async (tx) => {
      const current = await getAppointment(tx, appointmentId);
      assertTransition(current.status, 'declined');
      await tx
        .update(appointments)
        .set({ status: 'declined', decision_by: req.actor.user_id, decision_reason: body.reason, updated_at: now() })
        .where(eq(appointments.id, appointmentId));
      await logActivity(tx, req.actor, {
        action: APPOINTMENT_ACTIONS.statusChanged,
        entity: 'appointment',
        entity_id: appointmentId,
        before: { status: 'pending' },
        after: { status: 'declined' },
        note: body.reason,
      });
    });
    await notifyPatient(db, appointmentId, { type: 'declined', reason: body.reason });
    return detail(appointmentId, zone);
  });

  /**
   * Move an appointment, re-running every booking rule at the new slot.
   * Overriding a portal patient's booking needs a reason; they are emailed.
   */
  app.patch('/:id/reschedule', async (req) => {
    const { id: appointmentId } = parse(idParams, req.params);
    const body = parse(AppointmentReschedule, req.body);
    const zone = await getClinicZone(db);
    const startsAt = toInstant(body.starts_at, zone);

    const previous = await db.transaction(async (tx) => {
      const current = await getAppointment(tx, appointmentId);
      assertReschedulable(current.status);

      const staffId = body.staff_id ?? current.staff_id;
      let member = current.staff;
      if (body.staff_id) {
        member = await getStaff(tx, body.staff_id);
        assertStaffBookable(member);
      }

      let service = current.service;
      if (body.service_id) {
        service = await getService(tx, body.service_id);
        assertServiceBookable(service);
      }
      if (staffId !== current.staff_id || service.id !== current.service_id) {
        await assertStaffOffersService(tx, member, service);
      }

      const endsAt = computeEnd(startsAt, service);
      await validateSlot(
        tx,
        { staff_id: staffId, starts_at: startsAt, ends_at: endsAt, exclude_appointment_id: current.id },
        zone,
      );
      const moved = staffId !== current.staff_id || startsAt.getTime() !== current.starts_at.getTime();
      if (moved) requireReasonForPortalPatient(current, body.note);

      await tx
        .update(appointments)
        .set({
          staff_id: staffId,
          service_id: service.id,
          starts_at: startsAt,
          ends_at: endsAt,
          updated_at: now(),
        })
        .where(eq(appointments.id, appointmentId));
      await logActivity(tx, req.actor, {
        action: APPOINTMENT_ACTIONS.rescheduled,
        entity: 'appointment',
        entity_id: appointmentId,
        before: { starts_at: iso(current.starts_at), staff_id: current.staff_id, service_id: current.service_id },
        after: { starts_at: iso(startsAt), staff_id: staffId, service_id: service.id },
        note: body.note ?? null,
      });
      return { ...current, moved };
    });
    if (previous.moved) {
      await notifyPatient(db, appointmentId, {
        type: 'changed_by_clinic',
        previous: { starts_at: previous.starts_at, staff_name: previous.staff.full_name },
        reason: body.note,
      });
    }
    return detail(appointmentId, zone);
  });
};

const DecisionBody = z.object({ reason: z.string().trim().nullable().optional() });

/** Employees must explain changes they force on a patient who booked online. */
function requireReasonForPortalPatient(
  appt: { patient: { user_id: number | null } },
  note: string | null | undefined,
) {
  if (appt.patient.user_id && !note?.trim()) {
    throw new ValidationError(
      'This patient has an online account and will be notified. Please give a reason.',
      { field: 'note' },
    );
  }
}
