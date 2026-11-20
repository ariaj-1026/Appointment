/**
 * Free slots for the patient booking flow: the staff member's business-hour
 * windows on that day, cut into a SLOT_STEP_MINUTES grid, minus anything that
 * overlaps a slot-holding appointment, minus the near past.
 *
 * This is a convenience for the picker. Booking still runs the full rule set
 * (validateSlot) and the database constraint, so a slot taken between listing
 * and booking is refused cleanly.
 */
import { and, eq, gt, inArray, lt } from 'drizzle-orm';
import { DateTime } from 'luxon';
import {
  DEFAULT_PATIENT_HOURS,
  PATIENT_MIN_LEAD_MINUTES,
  SLOT_BLOCKING_STATUSES,
  SLOT_STEP_MINUTES,
} from '@clinic/shared';
import type { Conn } from '../db/client.js';
import { appointments, business_hours, type Service } from '../db/schema.js';
import { addMinutes, clinicDayBounds, now, timeToMinutes, toClinicIso, weekdayOf } from '../lib/time.js';

export async function availableSlots(
  conn: Conn,
  opts: { staff_id: number; service: Service; day: string; zone: string; exclude_appointment_id?: number },
) {
  const weekday = weekdayOf(opts.day);
  const configured = await conn
    .select()
    .from(business_hours)
    .where(eq(business_hours.staff_id, opts.staff_id));

  const windows = configured.length
    ? configured.filter((w) => w.weekday === weekday).map((w) => [timeToMinutes(w.opens_at), timeToMinutes(w.closes_at)] as const)
    : DEFAULT_PATIENT_HOURS.weekdays.includes(weekday)
      ? [[timeToMinutes(DEFAULT_PATIENT_HOURS.opens_at), timeToMinutes(DEFAULT_PATIENT_HOURS.closes_at)] as const]
      : [];
  if (!windows.length) return [];

  const [dayStart, dayEnd] = clinicDayBounds(opts.day, opts.zone);
  const busy = (
    await conn
      .select({ id: appointments.id, starts_at: appointments.starts_at, ends_at: appointments.ends_at })
      .from(appointments)
      .where(
        and(
          eq(appointments.staff_id, opts.staff_id),
          inArray(appointments.status, [...SLOT_BLOCKING_STATUSES]),
          lt(appointments.starts_at, dayEnd),
          gt(appointments.ends_at, dayStart),
        ),
      )
  ).filter((b) => b.id !== opts.exclude_appointment_id);

  const earliest = addMinutes(now(), PATIENT_MIN_LEAD_MINUTES);
  const midnight = DateTime.fromISO(opts.day, { zone: opts.zone }).startOf('day');
  const duration = opts.service.duration_minutes;
  const slots: { starts_at: string; ends_at: string }[] = [];

  for (const [open, close] of [...windows].sort((a, b) => a[0] - b[0])) {
    for (let m = open; m + duration <= close; m += SLOT_STEP_MINUTES) {
      const start = midnight.plus({ minutes: m }).toJSDate();
      const end = midnight.plus({ minutes: m + duration }).toJSDate();
      if (start < earliest) continue;
      if (busy.some((b) => b.starts_at < end && b.ends_at > start)) continue;
      slots.push({ starts_at: toClinicIso(start, opts.zone), ends_at: toClinicIso(end, opts.zone) });
    }
  }
  return slots;
}
