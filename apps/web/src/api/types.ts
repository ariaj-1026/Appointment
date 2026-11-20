import type { AppointmentStatus, Role } from '@clinic/shared';

export type { AppointmentStatus, Role };

export interface Staff {
  id: number;
  full_name: string;
  role: string;
  is_active: boolean;
  user_id?: number | null;
}

export interface Service {
  id: number;
  name: string;
  duration_minutes: number;
  description: string | null;
  is_active: boolean;
}

export interface Patient {
  id: number;
  first_name: string;
  last_name: string;
  full_name: string;
  phone: string;
  email: string | null;
  date_of_birth: string | null;
  notes: string | null;
  user_id: number | null;
  created_at: string;
}

export interface BusinessHour {
  id?: number;
  staff_id?: number;
  weekday: number;
  opens_at: string;
  closes_at: string;
}

export interface Appointment {
  id: number;
  patient_id: number;
  staff_id: number;
  service_id: number;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  reason: string | null;
  booked_via: 'employee' | 'patient';
  created_by: number | null;
  decision_by: number | null;
  decision_reason: string | null;
  created_at: string;
  updated_at: string;
  duration_minutes: number;
  patient: Patient;
  staff: Staff;
  service: Service;
}

export interface HistoryEntry {
  id: number;
  appointment_id: number;
  action: string;
  from_status: AppointmentStatus | null;
  to_status: AppointmentStatus | null;
  from_starts_at: string | null;
  to_starts_at: string | null;
  from_staff_id: number | null;
  to_staff_id: number | null;
  note: string | null;
  user_id: number | null;
  actor_role: Role | null;
  changed_at: string;
}

export interface ReminderLogEntry {
  id: number;
  appointment_id: number | null;
  type: string;
  channel: string;
  status: 'sent' | 'failed' | 'skipped';
  recipient: string | null;
  detail: string | null;
  sent_at: string;
}

export interface SessionUser {
  id: number;
  email: string;
  role: Role;
  full_name: string;
  is_active: boolean;
  has_password: boolean;
  has_google: boolean;
  created_at: string;
  last_login_at: string | null;
}

export interface Me {
  user: SessionUser;
  patient: Patient | null;
  staff: Staff | null;
  timezone: string;
}

export interface NotificationItem {
  id: number;
  type: string;
  title: string | null;
  detail: string | null;
  appointment_id: number | null;
  read_at: string | null;
  created_at: string;
}

export interface PortalAppointment {
  id: number;
  status: AppointmentStatus;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  reason: string | null;
  booked_via: 'employee' | 'patient';
  decision_reason: string | null;
  staff: { id: number; full_name: string; role: string };
  service: { id: number; name: string; duration_minutes: number };
  can_change: boolean;
  change_deadline: string | null;
}

export interface Slot {
  starts_at: string;
  ends_at: string;
}

export interface AdminUser extends SessionUser {
  staff: { id: number; full_name: string } | null;
}

export interface ActivityEntry {
  id: number;
  user_id: number | null;
  actor_role: Role | null;
  action: string;
  entity: string | null;
  entity_id: number | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  note: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  user_email: string | null;
  user_name: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Report payloads are rendered field-by-field; typed loosely. */
export type Report = Record<string, any>;
