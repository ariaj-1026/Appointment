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
