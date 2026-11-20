import { z } from 'zod';

export const ROLES = ['patient', 'employee', 'admin'] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

/**
 * v1 statuses plus `pending` (patient request awaiting an employee) and
 * `declined` (request refused).
 *
 *   pending ──approve──▶ scheduled ──▶ confirmed ──▶ completed
 *      │                    │              │
 *      ├──decline──▶ declined└──────┬───────┘
 *      └──withdraw──▶ cancelled ◀───┴──▶ no_show
 */
export const APPOINTMENT_STATUSES = [
  'pending',
  'declined',
  'scheduled',
  'confirmed',
  'completed',
  'cancelled',
  'no_show',
] as const;
export const AppointmentStatus = z.enum(APPOINTMENT_STATUSES);
export type AppointmentStatus = z.infer<typeof AppointmentStatus>;

/**
 * Statuses that occupy a staff member's time slot. `completed` still blocks
 * (the time was used); cancelled, no_show and declined release it.
 */
export const SLOT_BLOCKING_STATUSES = ['pending', 'scheduled', 'confirmed', 'completed'] as const;

export const TERMINAL_STATUSES = ['declined', 'completed', 'cancelled', 'no_show'] as const;

export const ALLOWED_TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  pending: ['scheduled', 'declined', 'cancelled'],
  scheduled: ['confirmed', 'completed', 'cancelled', 'no_show'],
  confirmed: ['completed', 'cancelled', 'no_show'],
  declined: [],
  completed: [],
  cancelled: [],
  no_show: [],
};

export const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

export const DEFAULT_TIMEZONE = 'Asia/Manila';
export const REMINDER_OFFSETS_HOURS = [24, 2] as const;

// ---- Patient portal rules ----
/** Patients may cancel/reschedule a confirmed visit up to this long before it. */
export const PATIENT_CANCEL_CUTOFF_HOURS = 24;
/** Earliest a patient can request: now + this. */
export const PATIENT_MIN_LEAD_MINUTES = 60;
/** Furthest ahead a patient can request. */
export const PATIENT_MAX_DAYS_AHEAD = 90;
/** Open (pending) requests a patient may have at once. */
export const PATIENT_MAX_PENDING_REQUESTS = 3;
/** Slot grid offered to patients. */
export const SLOT_STEP_MINUTES = 15;
/**
 * Hours offered to patients for a staff member with no business hours
 * configured (employees can still book them at any time): Mon–Fri 09–17.
 */
export const DEFAULT_PATIENT_HOURS = { weekdays: [0, 1, 2, 3, 4], opens_at: '09:00', closes_at: '17:00' };

export const NOTIFICATION_TYPES = {
  new_patient: 'New patient registered',
  booking_request: 'New booking request',
  reschedule_request: 'Reschedule request',
  patient_cancelled: 'Patient cancelled',
} as const;

export interface HealthResponse {
  ok: boolean;
  db: 'up' | 'down' | 'unconfigured';
  time: string;
}

// ---- Email ----
/**
 * Allowed email shape: letters, digits and . _ + - before the @; letters,
 * digits, dots and hyphens after it, ending in a 2+ letter TLD. Stricter
 * than RFC 5322 on purpose — quotes, spaces, slashes, semicolons, % etc. are
 * refused. (SQL injection is already impossible: every query is
 * parameterized. This is input hygiene on top of that.)
 */
export const EMAIL_PATTERN = '[A-Za-z0-9](?:[A-Za-z0-9._+\\-]{0,62}[A-Za-z0-9_+\\-])?@[A-Za-z0-9](?:[A-Za-z0-9\\-]{0,61}[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9\\-]{0,61}[A-Za-z0-9])?)*\\.[A-Za-z]{2,24}';
export const EMAIL_RE = new RegExp(`^${EMAIL_PATTERN}$`);
/** Keystroke filter: drop any character an email can never contain, keep one @. */
export function cleanEmailInput(v: string): string {
  const s = v.replace(/[^A-Za-z0-9._+\-@]/g, '');
  const at = s.indexOf('@');
  return at === -1 ? s : s.slice(0, at + 1) + s.slice(at + 1).replace(/@/g, '');
}

// ---- Person names ----
/** Letters (any language, incl. ñ/é), single spaces, hyphens and apostrophes. No digits or symbols. */
export const NAME_RE = /^\p{L}[\p{L}\p{M}]*(?:[ '\-’][\p{L}\p{M}]+)*$/u;
/** Keystroke filter for name inputs. */
export function cleanNameInput(v: string): string {
  return v.replace(/[^\p{L}\p{M} '\-’]/gu, '').replace(/^[ '\-’]+/, '').replace(/ {2,}/g, ' ');
}
export const PersonName = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((v) => NAME_RE.test(v), { message: 'Use letters only (spaces, hyphens and apostrophes are fine).' });
export const Email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine((v) => EMAIL_RE.test(v) && !v.includes('..'), {
    message: 'Enter a valid email using only letters, numbers and . _ + -',
  });
