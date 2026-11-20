/**
 * Notifications: patient emails (+ an in-app copy when they have an account)
 * and the shared employee inbox.
 *
 * Called *after* the business change has committed. A failed email never
 * undoes or fails the change; it is recorded as a `failed` notification.
 */
import type { Conn } from '../db/client.js';
import { notifications } from '../db/schema.js';
import { sendEmail } from '../lib/email.js';
import { getClinicZone } from '../lib/settings.js';
import { templates, type Email, type VisitInfo } from '../lib/templates.js';
import { clinicParts } from '../lib/time.js';
import { getAppointment } from './scheduling.js';
import type { AppointmentWithRelations } from './serialize.js';

export type PatientEvent =
  | { type: 'request_received' }
  | { type: 'approved' }
  | { type: 'declined'; reason?: string | null }
  | { type: 'booked_by_clinic' }
  | { type: 'changed_by_clinic'; previous: { starts_at: Date; staff_name: string }; reason?: string | null }
  | { type: 'cancelled_by_clinic'; reason?: string | null }
  | { type: 'cancel_confirmed' }
  | { type: 'reschedule_requested' };

export function visitInfo(a: AppointmentWithRelations, zone: string, at = a.starts_at): VisitInfo {
  const p = clinicParts(at, zone);
  return {
    patient_name: a.patient.first_name,
    service: a.service.name,
    staff: a.staff.full_name,
    date: `${p.label} ${p.longDate.slice(-4)}`,
    time: p.hhmm,
  };
}

function render(event: PatientEvent, a: AppointmentWithRelations, zone: string): Email {
  const v = visitInfo(a, zone);
  switch (event.type) {
    case 'request_received': return templates.requestReceived(v);
    case 'approved': return templates.approved(v);
    case 'declined': return templates.declined(v, event.reason);
    case 'booked_by_clinic': return templates.bookedByClinic(v);
    case 'cancelled_by_clinic': return templates.cancelledByClinic(v, event.reason);
    case 'cancel_confirmed': return templates.cancelConfirmed(v);
    case 'reschedule_requested': return templates.rescheduleRequested(v);
    case 'changed_by_clinic': {
      const prev = visitInfo(a, zone, event.previous.starts_at);
      return templates.changedByClinic(v, `${prev.date} at ${prev.time} with ${event.previous.staff_name}`, event.reason);
    }
  }
}

/** Email + in-app record for the appointment's patient. Never throws. */
export async function notifyPatient(conn: Conn, appointmentId: number, event: PatientEvent) {
  try {
    const a = await getAppointment(conn, appointmentId);
    const zone = await getClinicZone(conn);
    const email = render(event, a, zone);

    if (a.patient.user_id) {
      await conn.insert(notifications).values({
        type: event.type,
        channel: 'in_app',
        audience: 'user',
        user_id: a.patient.user_id,
        appointment_id: a.id,
        status: 'sent',
        title: email.subject,
        detail: email.text.split('\n').slice(2).join(' ').trim(),
      });
    }

    let status: 'sent' | 'failed' | 'skipped' = 'skipped';
    let detail = 'No email address on file';
    if (a.patient.email) {
      try {
        const r = await sendEmail({ to: { email: a.patient.email, name: `${a.patient.first_name} ${a.patient.last_name}` }, ...email });
        status = 'sent';
        detail = r.sent ? `sent via Brevo${r.id ? ` (${r.id})` : ''}` : 'logged only (BREVO_API_KEY not set)';
      } catch (err) {
        status = 'failed';
        detail = (err as Error).message;
      }
    }
    await conn.insert(notifications).values({
      type: event.type,
      channel: 'email',
      audience: 'user',
      user_id: a.patient.user_id,
      appointment_id: a.id,
      recipient: a.patient.email,
      status,
      title: email.subject,
      detail,
    });
  } catch (err) {
    console.error('[notifyPatient]', err);
  }
}

/** A message in the shared employee inbox. */
export async function notifyEmployees(
  conn: Conn,
  n: { type: string; title: string; detail?: string; appointment_id?: number },
) {
  await conn.insert(notifications).values({
    type: n.type,
    channel: 'in_app',
    audience: 'employees',
    appointment_id: n.appointment_id ?? null,
    status: 'sent',
    title: n.title,
    detail: n.detail ?? null,
  });
}

/** Account emails (password reset, welcome). Returns whether it went out. */
export async function sendAccountEmail(to: { email: string; name: string }, email: Email): Promise<boolean> {
  try {
    const r = await sendEmail({ to, ...email });
    return r.sent;
  } catch (err) {
    console.error('[sendAccountEmail]', err);
    return false;
  }
}
