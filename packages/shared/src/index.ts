import { z } from 'zod';

export const ROLES = ['patient', 'employee', 'admin'] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

export const APPOINTMENT_STATUSES = [
  'pending',
  'declined',
  'scheduled',
  'confirmed',
  'checked_in',
  'completed',
  'cancelled',
  'no_show',
] as const;
export const AppointmentStatus = z.enum(APPOINTMENT_STATUSES);
export type AppointmentStatus = z.infer<typeof AppointmentStatus>;

/** Statuses that occupy a staff member's time slot. */
export const SLOT_BLOCKING_STATUSES: readonly AppointmentStatus[] = [
  'pending',
  'scheduled',
  'confirmed',
  'checked_in',
];

export const DEFAULT_TIMEZONE = 'Asia/Manila';
export const PATIENT_CANCEL_CUTOFF_HOURS = 24;
export const REMINDER_OFFSETS_HOURS = [24, 2] as const;

export interface HealthResponse {
  ok: boolean;
  db: 'up' | 'down' | 'unconfigured';
  time: string;
}
