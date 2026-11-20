/**
 * Date helpers.
 *
 * The API returns instants as clinic-zone ISO strings with an offset
 * ("2026-11-23T09:00:00+08:00") and reads offset-less input
 * ("2026-11-23T09:00", what <input type="datetime-local"> produces) as clinic
 * time. So the UI works in clinic wall-clock time throughout: `parseNaive`
 * reads the wall-clock fields and ignores the offset, and "today"/"now" come
 * from the clinic's zone, not the browser's — a receptionist's laptop set to
 * another zone still sees and books Manila time.
 */
import type { AppointmentStatus } from '@clinic/shared';

export { ALLOWED_TRANSITIONS } from '@clinic/shared';

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const pad = (n: number) => String(n).padStart(2, '0');

// ---------------------------------------------------------------------------
// Clinic clock
// ---------------------------------------------------------------------------

let clinicZone = 'Asia/Manila';

/** Set from /api/auth/me once signed in. */
export function setClinicZone(zone: string) {
  clinicZone = zone;
}

export function getClinicZone() {
  return clinicZone;
}

/** Wall-clock fields of "now" in the clinic zone. */
function clinicNowParts() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: clinicZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return parts as Record<'year' | 'month' | 'day' | 'hour' | 'minute', string>;
}

/** "Now" as a local Date carrying clinic wall-clock fields (comparable with parseNaive). */
export function clinicNow(): Date {
  const p = clinicNowParts();
  return new Date(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
}

/** "YYYY-MM-DD" for a Date's local fields. */
export function toDateInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "YYYY-MM-DDTHH:MM" for a datetime-local input. */
export function toDateTimeInput(dateStr: string, hour: number, minute = 0): string {
  return `${dateStr}T${pad(hour)}:${pad(minute)}`;
}

/** Today at the clinic. */
export function todayInput(): string {
  const p = clinicNowParts();
  return `${p.year}-${p.month}-${p.day}`;
}

/** Now at the clinic, as a datetime-local value; compares correctly as text. */
export function nowInput(): string {
  const p = clinicNowParts();
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

// ---------------------------------------------------------------------------
// Calendar arithmetic on YYYY-MM-DD strings
// ---------------------------------------------------------------------------

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return toDateInput(new Date(y!, m! - 1, d! + days));
}

/** Monday of the week containing `dateStr`. */
export function startOfWeek(dateStr: string): string {
  return addDays(dateStr, -weekdayOf(dateStr));
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return (new Date(y!, m! - 1, d!).getDay() + 6) % 7;
}

// ---------------------------------------------------------------------------
// Parsing and formatting API timestamps
// ---------------------------------------------------------------------------

/** Wall-clock reading of an API timestamp as a local Date (offset ignored). */
export function parseNaive(iso: string): Date {
  const [datePart, timePart = '00:00:00'] = iso.split('T');
  const [y, m, d] = datePart!.split('-').map(Number);
  const [hh, mm] = timePart.slice(0, 5).split(':').map(Number);
  return new Date(y!, m! - 1, d!, hh || 0, mm || 0);
}

/** First 16 chars: the value a datetime-local input wants. */
export function toLocalInput(iso: string): string {
  return iso.slice(0, 16);
}

export function formatTime(iso: string): string {
  return iso.slice(11, 16);
}

export function formatTimeRange(startIso: string, endIso: string): string {
  return `${formatTime(startIso)}–${formatTime(endIso)}`;
}

export function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function formatDateShort(iso: string): string {
  return parseNaive(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso: string): string {
  return `${formatDateShort(iso)} · ${formatTime(iso)}`;
}

/** "Mon 23 Nov" */
export function formatDayLabel(iso: string): string {
  return parseNaive(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** "09:00:00" → minutes since midnight. */
export function timeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  return h! * 60 + m!;
}

export function minutesToTime(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

export const STATUS_LABELS: Record<AppointmentStatus, string> = {
  pending: 'Pending',
  declined: 'Declined',
  scheduled: 'Scheduled',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No-show',
};

export const RELEASES_SLOT: AppointmentStatus[] = ['cancelled', 'no_show', 'declined'];
