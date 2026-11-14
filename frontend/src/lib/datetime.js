/**
 * Date helpers.
 *
 * The API speaks naive local clinic time ("2026-11-16T09:00:00" with no
 * offset), which is exactly what <input type="datetime-local"> produces. So
 * these helpers deliberately avoid `new Date(...).toISOString()`, which would
 * shift everything into UTC and move appointments by the timezone offset.
 */

export const WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
]

const pad = (n) => String(n).padStart(2, '0')

/** "YYYY-MM-DD" for a Date, in local time. */
export function toDateInput(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** "YYYY-MM-DDTHH:MM" for a datetime-local input. */
export function toDateTimeInput(dateStr, hour, minute = 0) {
  return `${dateStr}T${pad(hour)}:${pad(minute)}`
}

export function todayInput() {
  return toDateInput(new Date())
}

export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d + days)
  return toDateInput(date)
}

/** Monday of the week containing `dateStr`. */
export function startOfWeek(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const offset = (date.getDay() + 6) % 7 // JS: Sunday = 0, we want Monday = 0
  return addDays(dateStr, -offset)
}

/** Parse the API's naive timestamp into a local Date, with no UTC shift. */
export function parseNaive(iso) {
  const [datePart, timePart = '00:00:00'] = iso.split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  const [hh, mm, ss] = timePart.split(':').map(Number)
  return new Date(y, m - 1, d, hh || 0, mm || 0, ss || 0)
}

export function formatTime(iso) {
  const date = parseNaive(iso)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function formatTimeRange(startIso, endIso) {
  return `${formatTime(startIso)}–${formatTime(endIso)}`
}

export function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export function formatDateShort(iso) {
  const date = parseNaive(iso)
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return (new Date(y, m - 1, d).getDay() + 6) % 7
}

/** "09:00:00" -> minutes since midnight. */
export function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  return h * 60 + m
}

export function minutesToTime(minutes) {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}

export const STATUS_LABELS = {
  scheduled: 'Scheduled',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No-show',
}

/** Mirrors backend app/services/status.py — keep the two in step. */
export const ALLOWED_TRANSITIONS = {
  scheduled: ['confirmed', 'completed', 'cancelled', 'no_show'],
  confirmed: ['completed', 'cancelled', 'no_show'],
  completed: [],
  cancelled: [],
  no_show: [],
}

export const RELEASES_SLOT = ['cancelled', 'no_show']
