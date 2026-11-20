/**
 * Time handling.
 *
 * Instants are stored as `timestamptz`. The clinic works in one named time
 * zone (admin-configurable, default Asia/Manila), and everything a person reads
 * or types — appointment starts, business hours, "today" — is wall-clock time
 * in that zone.
 *
 * Input: `2026-11-23T09:00` (no offset) means 09:00 clinic time. An explicit
 * offset (`...+08:00`, `...Z`) is honoured as given.
 * Output: ISO strings in the clinic zone with offset, e.g.
 * `2026-11-23T09:00:00+08:00`. The first 16 characters are the wall-clock
 * reading, which is exactly what a `datetime-local` input wants.
 */
import { DateTime } from 'luxon';

// ---------------------------------------------------------------------------
// Clock (overridable in tests)
// ---------------------------------------------------------------------------

let frozenNow: Date | null = null;

export function now(): Date {
  return frozenNow ? new Date(frozenNow) : new Date();
}

/** Test hook: pin "now". Pass null to release. */
export function setNow(value: Date | null): void {
  frozenNow = value;
}

// ---------------------------------------------------------------------------
// Conversions
// ---------------------------------------------------------------------------

export function isValidZone(zone: string): boolean {
  return DateTime.local().setZone(zone).isValid;
}

const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;

/** Parse an incoming datetime string. Seconds are dropped, as in v1. */
export function parseClinicDateTime(input: string, zone: string): Date | null {
  const dt = HAS_OFFSET.test(input)
    ? DateTime.fromISO(input, { setZone: true })
    : DateTime.fromISO(input, { zone });
  if (!dt.isValid) return null;
  return dt.startOf('minute').toJSDate();
}

export function toClinicIso(value: Date, zone: string): string {
  return DateTime.fromJSDate(value).setZone(zone).toISO({ suppressMilliseconds: true })!;
}

export function toClinicIsoOrNull(value: Date | null | undefined, zone: string): string | null {
  return value ? toClinicIso(value, zone) : null;
}

/** The clinic-zone view of an instant. weekday: 0 = Monday … 6 = Sunday. */
export function clinicParts(value: Date, zone: string) {
  const dt = DateTime.fromJSDate(value).setZone(zone);
  return {
    date: dt.toISODate()!,
    weekday: dt.weekday - 1,
    minutes: dt.hour * 60 + dt.minute,
    hhmm: dt.toFormat('HH:mm'),
    label: dt.toFormat('ccc dd LLL'),
    longDate: dt.toFormat('dd LLL yyyy'),
  };
}

/** Today's date (YYYY-MM-DD) at the clinic. */
export function clinicToday(zone: string): string {
  return DateTime.fromJSDate(now()).setZone(zone).toISODate()!;
}

/** [start, end) instants of a clinic-local calendar day. */
export function clinicDayBounds(day: string, zone: string): [Date, Date] {
  const start = DateTime.fromISO(day, { zone }).startOf('day');
  return [start.toJSDate(), start.plus({ days: 1 }).toJSDate()];
}

/** [start of date_from, start of the day after date_to) — inclusive range. */
export function clinicRangeBounds(dateFrom: string, dateTo: string, zone: string): [Date, Date] {
  return [clinicDayBounds(dateFrom, zone)[0], clinicDayBounds(dateTo, zone)[1]];
}

export function addDays(day: string, days: number): string {
  return DateTime.fromISO(day).plus({ days }).toISODate()!;
}

/** Inclusive list of YYYY-MM-DD dates. */
export function dateRange(dateFrom: string, dateTo: string): string[] {
  const out: string[] = [];
  for (let d = dateFrom; d <= dateTo; d = addDays(d, 1)) out.push(d);
  return out;
}

export function daysBetween(dateFrom: string, dateTo: string): number {
  return Math.round(DateTime.fromISO(dateTo).diff(DateTime.fromISO(dateFrom), 'days').days);
}

/** 0 = Monday … 6 = Sunday, for a YYYY-MM-DD date. */
export function weekdayOf(day: string): number {
  return DateTime.fromISO(day).weekday - 1;
}

/** "09:00" or "09:00:00" → minutes since midnight. */
export function timeToMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return h! * 60 + m!;
}

export function minutesBetween(start: Date, end: Date): number {
  return Math.floor((end.getTime() - start.getTime()) / 60_000);
}

export function addMinutes(value: Date, minutes: number): Date {
  return new Date(value.getTime() + minutes * 60_000);
}
