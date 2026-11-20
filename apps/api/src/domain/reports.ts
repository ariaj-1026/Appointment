/**
 * Daily summary, utilisation and cancellation reports. Ported from v1.
 *
 * Booked minutes count only slot-holding appointments (pending, scheduled,
 * confirmed, completed). Available minutes come from business hours; a staff
 * member with none configured has *undefined* capacity, so utilisation is
 * null for them rather than an invented 0% or 100%.
 */
import { and, asc, eq, gte, lt } from 'drizzle-orm';
import { APPOINTMENT_STATUSES, SLOT_BLOCKING_STATUSES } from '@clinic/shared';
import type { Conn } from '../db/client.js';
import { appointments, business_hours, staff, type BusinessHour } from '../db/schema.js';
import {
  clinicDayBounds,
  clinicRangeBounds,
  dateRange,
  minutesBetween,
  timeToMinutes,
  toClinicIso,
  weekdayOf,
} from '../lib/time.js';

const blocking = new Set<string>(SLOT_BLOCKING_STATUSES);

async function hoursByStaff(conn: Conn) {
  const out = new Map<number, BusinessHour[]>();
  for (const w of await conn.select().from(business_hours)) {
    out.set(w.staff_id, [...(out.get(w.staff_id) ?? []), w]);
  }
  return out;
}

function availableMinutes(windows: BusinessHour[] | undefined, days: string[]): number | null {
  if (!windows?.length) return null;
  const perWeekday = new Map<number, number>();
  for (const w of windows) {
    const len = timeToMinutes(w.closes_at) - timeToMinutes(w.opens_at);
    perWeekday.set(w.weekday, (perWeekday.get(w.weekday) ?? 0) + len);
  }
  return days.reduce((sum, d) => sum + (perWeekday.get(weekdayOf(d)) ?? 0), 0);
}

const pct = (n: number, d: number | null) => (d === null || d === 0 ? null : round1((n / d) * 100));
const round1 = (n: number) => Math.round(n * 10) / 10;
const blankCounts = () =>
  Object.fromEntries(APPOINTMENT_STATUSES.map((s) => [s, 0])) as Record<string, number>;

async function fetchRange(conn: Conn, start: Date, end: Date, staffId?: number) {
  const conds = [gte(appointments.starts_at, start), lt(appointments.starts_at, end)];
  if (staffId) conds.push(eq(appointments.staff_id, staffId));
  return conn.query.appointments.findMany({
    where: and(...conds),
    with: { patient: true, staff: true, service: true },
  });
}

async function staffRows(conn: Conn, staffId?: number) {
  return conn
    .select()
    .from(staff)
    .where(staffId ? eq(staff.id, staffId) : undefined)
    .orderBy(asc(staff.full_name));
}

const duration = (a: { starts_at: Date; ends_at: Date }) => minutesBetween(a.starts_at, a.ends_at);

// ---------------------------------------------------------------------------

export async function dailySummary(conn: Conn, day: string, zone: string, staffId?: number) {
  const [start, end] = clinicDayBounds(day, zone);
  const appts = await fetchRange(conn, start, end, staffId);
  const hours = await hoursByStaff(conn);
  const members = await staffRows(conn, staffId);

  const rows = members.map((m) => {
    const mine = appts.filter((a) => a.staff_id === m.id);
    const counts = blankCounts();
    let booked = 0;
    for (const a of mine) {
      counts[a.status]! += 1;
      if (blocking.has(a.status)) booked += duration(a);
    }
    const available = availableMinutes(hours.get(m.id), [day]);
    const starts = mine.map((a) => a.starts_at.getTime());
    const ends = mine.map((a) => a.ends_at.getTime());
    return {
      staff_id: m.id,
      staff_name: m.full_name,
      role: m.role,
      total: mine.length,
      counts,
      booked_minutes: booked,
      available_minutes: available,
      free_minutes: available === null ? null : Math.max(available - booked, 0),
      utilisation_pct: pct(booked, available),
      first_start: starts.length ? toClinicIso(new Date(Math.min(...starts)), zone) : null,
      last_end: ends.length ? toClinicIso(new Date(Math.max(...ends)), zone) : null,
    };
  });

  const totalCounts = blankCounts();
  for (const a of appts) totalCounts[a.status]! += 1;
  const totalBooked = rows.reduce((s, r) => s + r.booked_minutes, 0);
  const known = rows.filter((r) => r.available_minutes !== null).map((r) => r.available_minutes!);
  const totalAvailable = known.length ? known.reduce((s, n) => s + n, 0) : null;

  return {
    date: day,
    staff: rows,
    totals: {
      total: appts.length,
      counts: totalCounts,
      booked_minutes: totalBooked,
      available_minutes: totalAvailable,
      utilisation_pct: pct(totalBooked, totalAvailable),
      partial_capacity: known.length < rows.length,
    },
  };
}

export async function utilisation(
  conn: Conn,
  dateFrom: string,
  dateTo: string,
  zone: string,
  staffId?: number,
) {
  const days = dateRange(dateFrom, dateTo);
  const [start, end] = clinicRangeBounds(dateFrom, dateTo, zone);
  const appts = await fetchRange(conn, start, end, staffId);
  const hours = await hoursByStaff(conn);
  const members = await staffRows(conn, staffId);

  const rows = members.map((m) => {
    const mine = appts.filter((a) => a.staff_id === m.id);
    const booked = mine.filter((a) => blocking.has(a.status)).reduce((s, a) => s + duration(a), 0);
    const available = availableMinutes(hours.get(m.id), days);
    return {
      staff_id: m.id,
      staff_name: m.full_name,
      role: m.role,
      appointments: mine.length,
      booked_minutes: booked,
      available_minutes: available,
      free_minutes: available === null ? null : Math.max(available - booked, 0),
      utilisation_pct: pct(booked, available),
    };
  });

  const totalBooked = rows.reduce((s, r) => s + r.booked_minutes, 0);
  const known = rows.filter((r) => r.available_minutes !== null).map((r) => r.available_minutes!);
  const totalAvailable = known.length ? known.reduce((s, n) => s + n, 0) : null;

  return {
    date_from: dateFrom,
    date_to: dateTo,
    days: days.length,
    staff: rows,
    totals: {
      appointments: appts.length,
      booked_minutes: totalBooked,
      available_minutes: totalAvailable,
      utilisation_pct: pct(totalBooked, totalAvailable),
      partial_capacity: known.length < rows.length,
    },
  };
}

export async function cancellations(
  conn: Conn,
  dateFrom: string,
  dateTo: string,
  zone: string,
  staffId?: number,
) {
  const [start, end] = clinicRangeBounds(dateFrom, dateTo, zone);
  const appts = await fetchRange(conn, start, end, staffId);
  const total = appts.length;
  const cancelled = appts.filter((a) => a.status === 'cancelled');
  const noShows = appts.filter((a) => a.status === 'no_show');
  const lost = [...cancelled, ...noShows];
  const rate = (n: number) => (total === 0 ? null : round1((n / total) * 100));

  type StaffRow = { staff_id: number; staff_name: string; total: number; cancelled: number; no_show: number; lost_minutes: number; rate_pct?: number | null };
  type ServiceRow = { service_id: number; service_name: string; total: number; cancelled: number; no_show: number; rate_pct?: number | null };
  const byStaff = new Map<number, StaffRow>();
  const byService = new Map<number, ServiceRow>();

  for (const a of appts) {
    const s = byStaff.get(a.staff_id) ?? { staff_id: a.staff_id, staff_name: a.staff.full_name, total: 0, cancelled: 0, no_show: 0, lost_minutes: 0 };
    const v = byService.get(a.service_id) ?? { service_id: a.service_id, service_name: a.service.name, total: 0, cancelled: 0, no_show: 0 };
    s.total += 1;
    v.total += 1;
    if (a.status === 'cancelled' || a.status === 'no_show') {
      s[a.status === 'cancelled' ? 'cancelled' : 'no_show'] += 1;
      v[a.status === 'cancelled' ? 'cancelled' : 'no_show'] += 1;
      s.lost_minutes += duration(a);
    }
    byStaff.set(a.staff_id, s);
    byService.set(a.service_id, v);
  }
  for (const r of [...byStaff.values(), ...byService.values()]) {
    r.rate_pct = r.total ? round1(((r.cancelled + r.no_show) / r.total) * 100) : null;
  }

  return {
    date_from: dateFrom,
    date_to: dateTo,
    totals: {
      total,
      cancelled: cancelled.length,
      no_show: noShows.length,
      lost: lost.length,
      cancellation_rate_pct: rate(cancelled.length),
      no_show_rate_pct: rate(noShows.length),
      combined_rate_pct: rate(lost.length),
      lost_minutes: lost.reduce((s, a) => s + duration(a), 0),
    },
    by_staff: [...byStaff.values()].sort((a, b) => b.lost_minutes - a.lost_minutes),
    by_service: [...byService.values()].sort((a, b) => b.total - a.total),
    recent: lost
      .sort((a, b) => b.starts_at.getTime() - a.starts_at.getTime())
      .slice(0, 50)
      .map((a) => ({
        id: a.id,
        starts_at: toClinicIso(a.starts_at, zone),
        status: a.status,
        patient_name: `${a.patient.first_name} ${a.patient.last_name}`,
        staff_name: a.staff.full_name,
        service_name: a.service.name,
        duration_minutes: duration(a),
        reason: a.reason,
      })),
  };
}
