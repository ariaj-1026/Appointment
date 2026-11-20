/** Rows → JSON in v1's shapes, with instants rendered in the clinic zone. */
import type { Appointment, Patient, Service, Staff } from '../db/schema.js';
import { minutesBetween, toClinicIso } from '../lib/time.js';

export function serializePatient(p: Patient, zone: string) {
  return {
    ...p,
    full_name: `${p.first_name} ${p.last_name}`,
    created_at: toClinicIso(p.created_at, zone),
  };
}

export function serializeAppointment(a: Appointment, zone: string) {
  return {
    ...a,
    starts_at: toClinicIso(a.starts_at, zone),
    ends_at: toClinicIso(a.ends_at, zone),
    created_at: toClinicIso(a.created_at, zone),
    updated_at: toClinicIso(a.updated_at, zone),
    duration_minutes: minutesBetween(a.starts_at, a.ends_at),
  };
}

export type AppointmentWithRelations = Appointment & {
  patient: Patient;
  staff: Staff;
  service: Service;
};

export function serializeAppointmentDetail(a: AppointmentWithRelations, zone: string) {
  const { patient, staff, service, ...rest } = a;
  return {
    ...serializeAppointment(rest, zone),
    patient: serializePatient(patient, zone),
    staff,
    service,
  };
}
