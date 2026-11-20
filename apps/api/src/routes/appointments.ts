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
  computeEnd,
  getAppointment,
  getPatient,
  getService,
  getStaff,
  validateSlot,
} from '../domain/scheduling.js';
import { serializeAppointmentDetail } from '../domain/serialize.js';
import { assertReschedulable, assertTransition } from '../domain/status.js';
import { ValidationError } from '../lib/errors.js';
import { getClinicZone } from '../lib/settings.js';
import { clinicDayBounds, clinicRangeBounds, now, parseClinicDateTime } from '../lib/time.js';
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
    return reply.status(201).send(await detail(createdId, zone));
  });

  /** Move through the lifecycle, rejecting illegal moves. */
  app.patch('/:id/status', async (req) => {
    const { id: appointmentId } = parse(idParams, req.params);
    const body = parse(AppointmentStatusUpdate, req.body);
    const zone = await getClinicZone(db);

    await db.transaction(async (tx) => {
      const current = await getAppointment(tx, appointmentId);
      assertTransition(current.status, body.status);
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
    });
    return detail(appointmentId, zone);
  });

  /** Move an appointment, re-running every booking rule at the new slot. */
  app.patch('/:id/reschedule', async (req) => {
    const { id: appointmentId } = parse(idParams, req.params);
    const body = parse(AppointmentReschedule, req.body);
    const zone = await getClinicZone(db);
    const startsAt = toInstant(body.starts_at, zone);

    await db.transaction(async (tx) => {
      const current = await getAppointment(tx, appointmentId);
      assertReschedulable(current.status);

      const staffId = body.staff_id ?? current.staff_id;
      if (body.staff_id) assertStaffBookable(await getStaff(tx, body.staff_id));

      let service = current.service;
      if (body.service_id) {
        service = await getService(tx, body.service_id);
        assertServiceBookable(service);
      }

      const endsAt = computeEnd(startsAt, service);
      await validateSlot(
        tx,
        { staff_id: staffId, starts_at: startsAt, ends_at: endsAt, exclude_appointment_id: current.id },
        zone,
      );

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
    });
    return detail(appointmentId, zone);
  });
};
