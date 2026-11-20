/**
 * Patient portal (role: patient). Patients only ever see their own records,
 * and only the public fields of staff and services.
 *
 * Booking creates a `pending` request that holds the slot until an employee
 * approves or declines it. Cancelling or rescheduling a confirmed visit is
 * allowed up to PATIENT_CANCEL_CUTOFF_HOURS before it; a pending request can
 * be withdrawn at any time. A reschedule goes back to `pending`.
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  PATIENT_CANCEL_CUTOFF_HOURS,
  PATIENT_MAX_DAYS_AHEAD,
  PATIENT_MAX_PENDING_REQUESTS,
  PersonName,
} from '@clinic/shared';
import type { DB } from '../db/client.js';
import { appointments, patients, services, staff, staff_services } from '../db/schema.js';
import { APPOINTMENT_ACTIONS, logActivity } from '../domain/activity.js';
import { availableSlots } from '../domain/availability.js';
import { notifyEmployees, notifyPatient } from '../domain/notify.js';
import {
  assertServiceBookable,
  assertStaffBookable,
  assertStaffOffersService,
  computeEnd,
  getAppointment,
  getService,
  getStaff,
  validateSlot,
} from '../domain/scheduling.js';
import { serializeAppointmentDetail, serializePatient, type AppointmentWithRelations } from '../domain/serialize.js';
import { currentUser } from '../lib/auth.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { getClinicZone } from '../lib/settings.js';
import { addDays, addMinutes, clinicParts, clinicToday, now, parseClinicDateTime, toClinicIso } from '../lib/time.js';
import { id, idParams, isoDate, parse } from '../lib/validate.js';

const ACTIVE = ['pending', 'scheduled', 'confirmed'] as const;

const BookBody = z.object({
  service_id: id,
  staff_id: id,
  starts_at: z.string().min(16),
  reason: z.string().trim().max(500).nullable().optional(),
});

const ProfileUpdate = z
  .object({
    first_name: PersonName,
    last_name: PersonName,
    phone: z.string().trim().min(3).max(32),
    date_of_birth: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()]),
  })
  .partial();

/** What a patient may see of an appointment (no internal notes / ids of other users). */
function forPatient(a: AppointmentWithRelations, zone: string) {
  const d = serializeAppointmentDetail(a, zone);
  const cutoff = addMinutes(a.starts_at, -PATIENT_CANCEL_CUTOFF_HOURS * 60);
  const changeable = a.status === 'pending' || ((a.status === 'scheduled' || a.status === 'confirmed') && now() <= cutoff);
  return {
    id: d.id,
    status: d.status,
    starts_at: d.starts_at,
    ends_at: d.ends_at,
    duration_minutes: d.duration_minutes,
    reason: d.reason,
    booked_via: d.booked_via,
    decision_reason: d.decision_reason,
    staff: { id: a.staff.id, full_name: a.staff.full_name, role: a.staff.role },
    service: { id: a.service.id, name: a.service.name, duration_minutes: a.service.duration_minutes },
    can_change: changeable && a.starts_at > now(),
    /** Last moment the patient can cancel/reschedule themselves (null = any time). */
    change_deadline: a.status === 'pending' ? null : toClinicIso(cutoff, zone),
  };
}

export const portalRoutes: FastifyPluginAsync<{ db: DB }> = async (app, { db }) => {
  async function myPatient(req: FastifyRequest) {
    const user = currentUser(req);
    const [p] = await db.select().from(patients).where(eq(patients.user_id, user.id));
    if (!p) throw new NotFoundError('No patient profile is linked to this account.');
    return p;
  }

  async function myAppointment(req: FastifyRequest, appointmentId: number) {
    const p = await myPatient(req);
    const a = await getAppointment(db, appointmentId).catch(() => null);
    // 404 (not 403) for someone else's appointment: don't confirm it exists.
    if (!a || a.patient_id !== p.id) throw new NotFoundError(`No appointment with id ${appointmentId}.`);
    return a;
  }

  function assertChangeable(a: AppointmentWithRelations) {
    if (!(ACTIVE as readonly string[]).includes(a.status)) {
      throw new ValidationError(`This appointment is ${a.status} and can no longer be changed.`);
    }
    if (a.starts_at <= now()) throw new ValidationError('This appointment has already started.');
    if (a.status !== 'pending' && now() > addMinutes(a.starts_at, -PATIENT_CANCEL_CUTOFF_HOURS * 60)) {
      throw new ValidationError(
        `Changes are only possible up to ${PATIENT_CANCEL_CUTOFF_HOURS} hours before the appointment. Please call the clinic.`,
        { code_hint: 'cutoff' },
      );
    }
  }

  /** Validates a requested slot exactly as the picker offered it. */
  async function assertOfferedSlot(
    staffId: number,
    service: typeof services.$inferSelect,
    startsAt: Date,
    zone: string,
    excludeId?: number,
  ) {
    const day = clinicParts(startsAt, zone).date;
    if (day > addDays(clinicToday(zone), PATIENT_MAX_DAYS_AHEAD)) {
      throw new ValidationError(`Appointments can be requested up to ${PATIENT_MAX_DAYS_AHEAD} days ahead.`);
    }
    const slots = await availableSlots(db, { staff_id: staffId, service, day, zone, exclude_appointment_id: excludeId });
    if (!slots.some((s) => new Date(s.starts_at).getTime() === startsAt.getTime())) {
      throw new ValidationError('That time is no longer available. Please pick another slot.', { code_hint: 'slot_unavailable' });
    }
  }

  // ---- Catalogue ----
  app.get('/services', async () =>
    db
      .select({ id: services.id, name: services.name, duration_minutes: services.duration_minutes, description: services.description })
      .from(services)
      .where(eq(services.is_active, true))
      .orderBy(asc(services.name)),
  );

  /** Active staff; with ?service_id only those whose specialty covers it. */
  app.get('/staff', async (req) => {
    const q = parse(z.object({ service_id: id.optional() }), req.query);
    const cols = { id: staff.id, full_name: staff.full_name, role: staff.role };
    if (!q.service_id) {
      return db.select(cols).from(staff).where(eq(staff.is_active, true)).orderBy(asc(staff.full_name));
    }
    return db
      .select(cols)
      .from(staff)
      .innerJoin(staff_services, eq(staff_services.staff_id, staff.id))
      .where(and(eq(staff.is_active, true), eq(staff_services.service_id, q.service_id)))
      .orderBy(asc(staff.full_name));
  });

  app.get('/availability', async (req) => {
    const q = parse(z.object({ service_id: id, staff_id: id, date: isoDate, exclude_appointment_id: id.optional() }), req.query);
    const zone = await getClinicZone(db);
    const service = await getService(db, q.service_id);
    const member = await getStaff(db, q.staff_id);
    if (!service.is_active || !member.is_active) return { date: q.date, slots: [] };
    await assertStaffOffersService(db, member, service);
    if (q.date > addDays(clinicToday(zone), PATIENT_MAX_DAYS_AHEAD)) return { date: q.date, slots: [] };
    if (q.exclude_appointment_id) await myAppointment(req, q.exclude_appointment_id);
    const slots = await availableSlots(db, {
      staff_id: member.id,
      service,
      day: q.date,
      zone,
      exclude_appointment_id: q.exclude_appointment_id,
    });
    return { date: q.date, timezone: zone, slots };
  });

  // ---- Profile ----
  app.get('/profile', async (req) => serializePatient(await myPatient(req), await getClinicZone(db)));

  app.patch('/profile', async (req) => {
    const p = await myPatient(req);
    const body = parse(ProfileUpdate, req.body);
    const zone = await getClinicZone(db);
    if (!Object.keys(body).length) return serializePatient(p, zone);
    const [row] = await db.update(patients).set(body).where(eq(patients.id, p.id)).returning();
    await logActivity(db, req.actor, {
      action: 'update',
      entity: 'patient',
      entity_id: p.id,
      before: Object.fromEntries(Object.keys(body).map((k) => [k, p[k as keyof typeof p]])),
      after: body,
    });
    return serializePatient(row!, zone);
  });

  // ---- My appointments ----
  app.get('/appointments', async (req) => {
    const p = await myPatient(req);
    const zone = await getClinicZone(db);
    const rows = await db.query.appointments.findMany({
      where: eq(appointments.patient_id, p.id),
      with: { patient: true, staff: true, service: true },
      orderBy: desc(appointments.starts_at),
    });
    return rows.map((r) => forPatient(r, zone));
  });

  app.get('/appointments/:id', async (req) => {
    const { id: appointmentId } = parse(idParams, req.params);
    return forPatient(await myAppointment(req, appointmentId), await getClinicZone(db));
  });

  /** Request a booking → `pending`. */
  app.post('/appointments', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
    const p = await myPatient(req);
    const body = parse(BookBody, req.body);
    const zone = await getClinicZone(db);
    if (!p.phone.trim()) {
      throw new ValidationError('Please add your phone number to your profile before booking.', { code_hint: 'profile_incomplete' });
    }
    const pendingCount = await db.$count(appointments, and(eq(appointments.patient_id, p.id), eq(appointments.status, 'pending')));
    if (pendingCount >= PATIENT_MAX_PENDING_REQUESTS) {
      throw new ValidationError(
        `You already have ${pendingCount} requests waiting for the clinic. Please wait for them to be answered.`,
      );
    }
    const startsAt = parseClinicDateTime(body.starts_at, zone);
    if (!startsAt) throw new ValidationError('starts_at: not a valid datetime');

    const member = await getStaff(db, body.staff_id);
    const service = await getService(db, body.service_id);
    assertStaffBookable(member);
    assertServiceBookable(service);
    await assertStaffOffersService(db, member, service);
    await assertOfferedSlot(member.id, service, startsAt, zone);

    const createdId = await db.transaction(async (tx) => {
      const endsAt = computeEnd(startsAt, service);
      await validateSlot(tx, { staff_id: member.id, starts_at: startsAt, ends_at: endsAt }, zone);
      const [row] = await tx
        .insert(appointments)
        .values({
          patient_id: p.id,
          staff_id: member.id,
          service_id: service.id,
          starts_at: startsAt,
          ends_at: endsAt,
          reason: body.reason ?? null,
          status: 'pending',
          booked_via: 'patient',
          created_by: req.actor.user_id,
        })
        .returning();
      await logActivity(tx, req.actor, {
        action: APPOINTMENT_ACTIONS.created,
        entity: 'appointment',
        entity_id: row!.id,
        after: { status: 'pending', starts_at: startsAt.toISOString(), staff_id: member.id },
      });
      const when = clinicParts(startsAt, zone);
      await notifyEmployees(tx, {
        type: 'booking_request',
        appointment_id: row!.id,
        title: `Booking request: ${p.first_name} ${p.last_name}`,
        detail: `${service.name} with ${member.full_name}, ${when.label} ${when.hhmm}`,
      });
      return row!.id;
    });
    await notifyPatient(db, createdId, { type: 'request_received' });
    return reply.status(201).send(forPatient(await getAppointment(db, createdId), zone));
  });

  app.post('/appointments/:id/cancel', async (req) => {
    const { id: appointmentId } = parse(idParams, req.params);
    const body = parse(z.object({ reason: z.string().trim().max(500).nullable().optional() }), req.body);
    const a = await myAppointment(req, appointmentId);
    assertChangeable(a);
    const zone = await getClinicZone(db);
    await db.transaction(async (tx) => {
      await tx.update(appointments).set({ status: 'cancelled', updated_at: now() }).where(eq(appointments.id, a.id));
      await logActivity(tx, req.actor, {
        action: APPOINTMENT_ACTIONS.statusChanged,
        entity: 'appointment',
        entity_id: a.id,
        before: { status: a.status },
        after: { status: 'cancelled' },
        note: body.reason ? `Cancelled by patient: ${body.reason}` : 'Cancelled by patient',
      });
      const when = clinicParts(a.starts_at, zone);
      await notifyEmployees(tx, {
        type: 'patient_cancelled',
        appointment_id: a.id,
        title: `${a.status === 'pending' ? 'Request withdrawn' : 'Patient cancelled'}: ${a.patient.first_name} ${a.patient.last_name}`,
        detail: `${a.service.name} with ${a.staff.full_name}, ${when.label} ${when.hhmm}${body.reason ? ` — ${body.reason}` : ''}`,
      });
    });
    await notifyPatient(db, a.id, { type: 'cancel_confirmed' });
    return forPatient(await getAppointment(db, a.id), zone);
  });

  /** Move to another offered slot (and optionally staff); goes back to `pending`. */
  app.post('/appointments/:id/reschedule', async (req) => {
    const { id: appointmentId } = parse(idParams, req.params);
    const body = parse(z.object({ starts_at: z.string().min(16), staff_id: id.optional() }), req.body);
    const a = await myAppointment(req, appointmentId);
    assertChangeable(a);
    const zone = await getClinicZone(db);
    const startsAt = parseClinicDateTime(body.starts_at, zone);
    if (!startsAt) throw new ValidationError('starts_at: not a valid datetime');
    const staffId = body.staff_id ?? a.staff_id;
    if (body.staff_id) {
      const member = await getStaff(db, body.staff_id);
      assertStaffBookable(member);
      await assertStaffOffersService(db, member, a.service);
    }
    await assertOfferedSlot(staffId, a.service, startsAt, zone, a.id);

    await db.transaction(async (tx) => {
      const endsAt = computeEnd(startsAt, a.service);
      await validateSlot(tx, { staff_id: staffId, starts_at: startsAt, ends_at: endsAt, exclude_appointment_id: a.id }, zone);
      await tx
        .update(appointments)
        .set({ staff_id: staffId, starts_at: startsAt, ends_at: endsAt, status: 'pending', decision_by: null, decision_reason: null, updated_at: now() })
        .where(eq(appointments.id, a.id));
      await logActivity(tx, req.actor, {
        action: APPOINTMENT_ACTIONS.rescheduled,
        entity: 'appointment',
        entity_id: a.id,
        before: { status: a.status, starts_at: a.starts_at.toISOString(), staff_id: a.staff_id },
        after: { status: 'pending', starts_at: startsAt.toISOString(), staff_id: staffId },
        note: 'Reschedule requested by patient',
      });
      const from = clinicParts(a.starts_at, zone);
      const to = clinicParts(startsAt, zone);
      await notifyEmployees(tx, {
        type: 'reschedule_request',
        appointment_id: a.id,
        title: `Reschedule request: ${a.patient.first_name} ${a.patient.last_name}`,
        detail: `${a.service.name}: ${from.label} ${from.hhmm} → ${to.label} ${to.hhmm}`,
      });
    });
    await notifyPatient(db, a.id, { type: 'reschedule_requested' });
    return forPatient(await getAppointment(db, a.id), zone);
  });
};
