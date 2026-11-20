/**
 * Booking rules: lookups, slot conflicts, business hours, booking horizon.
 * Ported from v1 app/services/scheduling.py.
 *
 * The overlap test:  new.starts_at < existing.ends_at AND new.ends_at > existing.starts_at
 * Strict on both sides, so back-to-back appointments do not collide. Only
 * slot-holding statuses count, which is what makes a cancelled slot rebookable.
 *
 * The check here produces a helpful error; the exclusion constraint in the
 * database is the guarantee that two concurrent requests cannot both win.
 */
import { and, asc, eq, gt, inArray, lt, ne } from 'drizzle-orm';
import { SLOT_BLOCKING_STATUSES, WEEKDAY_NAMES } from '@clinic/shared';
import type { Conn } from '../db/client.js';
import {
  appointments,
  business_hours,
  patients,
  services,
  staff,
  type Service,
  type Staff,
} from '../db/schema.js';
import { env } from '../env.js';
import {
  ConflictError,
  NotFoundError,
  OutsideBusinessHoursError,
  ValidationError,
} from '../lib/errors.js';
import {
  addMinutes,
  clinicParts,
  now,
  timeToMinutes,
  toClinicIso,
} from '../lib/time.js';

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export async function getPatient(conn: Conn, id: number) {
  const [row] = await conn.select().from(patients).where(eq(patients.id, id));
  if (!row) throw new NotFoundError(`No patient with id ${id}.`, { patient_id: id });
  return row;
}

export async function getStaff(conn: Conn, id: number) {
  const [row] = await conn.select().from(staff).where(eq(staff.id, id));
  if (!row) throw new NotFoundError(`No staff member with id ${id}.`, { staff_id: id });
  return row;
}

export async function getService(conn: Conn, id: number) {
  const [row] = await conn.select().from(services).where(eq(services.id, id));
  if (!row) throw new NotFoundError(`No service with id ${id}.`, { service_id: id });
  return row;
}

export async function getAppointment(conn: Conn, id: number) {
  const row = await conn.query.appointments.findFirst({
    where: eq(appointments.id, id),
    with: { patient: true, staff: true, service: true },
  });
  if (!row) throw new NotFoundError(`No appointment with id ${id}.`, { appointment_id: id });
  return row;
}

// Deactivation is not deletion: inactive staff/services still appear in past
// appointments and reports. It means "take no new bookings", so the check
// sits at booking time, per entity, so a reschedule validates only what changes.

export function assertStaffBookable(member: Staff): void {
  if (!member.is_active) {
    throw new ValidationError(
      `${member.full_name} is deactivated and is not taking new bookings.`,
      { staff_id: member.id },
    );
  }
}

export function assertServiceBookable(service: Service): void {
  if (!service.is_active) {
    throw new ValidationError(`${service.name} is deactivated and cannot be booked.`, {
      service_id: service.id,
    });
  }
}

/** Appointment length always comes from the service, never the caller. */
export function computeEnd(startsAt: Date, service: Service): Date {
  return addMinutes(startsAt, service.duration_minutes);
}

// ---------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------

interface Window {
  staff_id: number;
  starts_at: Date;
  ends_at: Date;
  exclude_appointment_id?: number;
}

export async function findConflicts(conn: Conn, w: Window) {
  const conds = [
    eq(appointments.staff_id, w.staff_id),
    inArray(appointments.status, [...SLOT_BLOCKING_STATUSES]),
    lt(appointments.starts_at, w.ends_at),
    gt(appointments.ends_at, w.starts_at),
  ];
  if (w.exclude_appointment_id !== undefined) {
    conds.push(ne(appointments.id, w.exclude_appointment_id));
  }
  return conn.query.appointments.findMany({
    where: and(...conds),
    with: { patient: true, staff: true },
    orderBy: asc(appointments.starts_at),
  });
}

export async function assertNoConflict(conn: Conn, w: Window, zone: string): Promise<void> {
  const conflicts = await findConflicts(conn, w);
  if (conflicts.length === 0) return;
  const clash = conflicts[0]!;
  const s = clinicParts(clash.starts_at, zone);
  const e = clinicParts(clash.ends_at, zone);
  throw new ConflictError(
    `${clash.staff?.full_name ?? 'This staff member'} is already booked from ` +
      `${s.hhmm} to ${e.hhmm} on ${s.longDate}.`,
    {
      conflicting_appointment_ids: conflicts.map((c) => c.id),
      conflicting_appointments: conflicts.map((c) => ({
        id: c.id,
        starts_at: toClinicIso(c.starts_at, zone),
        ends_at: toClinicIso(c.ends_at, zone),
        status: c.status,
        patient_name: c.patient ? `${c.patient.first_name} ${c.patient.last_name}` : null,
      })),
    },
  );
}

/** Thrown when the database's exclusion constraint catches a race. */
export function raceConflict(): ConflictError {
  return new ConflictError('That slot was just taken by another booking. Pick another time.');
}

// ---------------------------------------------------------------------------
// Business hours
// ---------------------------------------------------------------------------

const hhmm = (t: string) => t.slice(0, 5);

/**
 * The whole appointment must fit inside one open window on its (clinic-local)
 * day. No configured hours = unrestricted.
 */
export async function assertWithinBusinessHours(
  conn: Conn,
  w: Omit<Window, 'exclude_appointment_id'>,
  zone: string,
): Promise<void> {
  const windows = await conn
    .select()
    .from(business_hours)
    .where(eq(business_hours.staff_id, w.staff_id));
  if (windows.length === 0) return;

  const start = clinicParts(w.starts_at, zone);
  const end = clinicParts(w.ends_at, zone);

  if (start.date !== end.date) {
    throw new OutsideBusinessHoursError('An appointment cannot run past midnight.', {
      starts_at: toClinicIso(w.starts_at, zone),
      ends_at: toClinicIso(w.ends_at, zone),
    });
  }

  const dayName = WEEKDAY_NAMES[start.weekday]!;
  const todays = windows
    .filter((x) => x.weekday === start.weekday)
    .sort((a, b) => a.opens_at.localeCompare(b.opens_at));

  if (todays.length === 0) {
    const openWeekdays = [...new Set(windows.map((x) => x.weekday))].sort((a, b) => a - b);
    const openNames = openWeekdays.map((d) => WEEKDAY_NAMES[d]).sort();
    throw new OutsideBusinessHoursError(
      `${dayName} is not a working day for this staff member. Open: ${openNames.join(', ')}.`,
      { weekday: start.weekday, open_weekdays: openWeekdays },
    );
  }

  const fits = todays.some(
    (x) => timeToMinutes(x.opens_at) <= start.minutes && end.minutes <= timeToMinutes(x.closes_at),
  );
  if (fits) return;

  const offered = todays.map((x) => `${hhmm(x.opens_at)}-${hhmm(x.closes_at)}`).join(', ');
  throw new OutsideBusinessHoursError(
    `${start.hhmm}-${end.hhmm} falls outside this staff member's ${dayName} hours (${offered}).`,
    {
      weekday: start.weekday,
      windows: todays.map((x) => ({ opens_at: x.opens_at, closes_at: x.closes_at })),
    },
  );
}

// ---------------------------------------------------------------------------
// Horizon + composite
// ---------------------------------------------------------------------------

/**
 * No booking in the past (beyond a short grace for a slot just begun), and
 * none absurdly far ahead.
 */
export function assertBookableHorizon(startsAt: Date, zone: string): void {
  const current = now();
  const floor = addMinutes(current, -env.BOOKING_GRACE_MINUTES);
  if (startsAt < floor) {
    throw new ValidationError('Appointments cannot be booked in the past.', {
      starts_at: toClinicIso(startsAt, zone),
      now: toClinicIso(current, zone),
    });
  }
  const limit = addMinutes(current, env.MAX_BOOKING_DAYS_AHEAD * 24 * 60);
  if (startsAt > limit) {
    throw new ValidationError(
      `Appointments cannot be booked more than ${env.MAX_BOOKING_DAYS_AHEAD} days ahead.`,
      { starts_at: toClinicIso(startsAt, zone) },
    );
  }
}

/** Every booking rule for a proposed slot, cheapest first. */
export async function validateSlot(conn: Conn, w: Window, zone: string): Promise<void> {
  assertBookableHorizon(w.starts_at, zone);
  await assertWithinBusinessHours(conn, w, zone);
  await assertNoConflict(conn, w, zone);
}
