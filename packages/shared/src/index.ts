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
export const PATIENT_CANCEL_CUTOFF_HOURS = 24;
export const REMINDER_OFFSETS_HOURS = [24, 2] as const;

export interface HealthResponse {
  ok: boolean;
  db: 'up' | 'down' | 'unconfigured';
  time: string;
}
