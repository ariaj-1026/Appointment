/**
 * Appointment reminders. Ported from v1; delivery is now email (Brevo).
 *
 * Each attempt is recorded in `notifications`. An appointment drops out of
 * "due" once it has a `sent` (or `skipped`: no email on file) row for the same
 * reminder type, so re-running dispatch never pesters a patient twice. A
 * `failed` row leaves it due, so a transient outage retries on the next sweep.
 *
 * Two reminder types exist — 24h and 2h before (Phase 5 schedules both via a
 * Render cron job).
 */
import { and, asc, eq, gte, inArray, lte, notInArray } from 'drizzle-orm';
import type { Conn } from '../db/client.js';
import { appointments, notifications } from '../db/schema.js';
import { env } from '../env.js';
import { sendEmail } from '../lib/email.js';
import { templates } from '../lib/templates.js';
import { addMinutes, clinicParts, now } from '../lib/time.js';
import { visitInfo } from './notify.js';
import type { AppointmentWithRelations } from './serialize.js';

export const REMINDER_TYPES = ['reminder_24h', 'reminder_2h'] as const;
export type ReminderType = (typeof REMINDER_TYPES)[number];

/** Only appointments the patient is still expected at. */
const REMINDABLE = ['scheduled', 'confirmed'] as const;

export interface ReminderSender {
  /** Stored in notifications.channel. */
  channel: 'email';
  name: string;
  /** Deliver; return a short detail string. Throw to signal failure. */
  send(appt: AppointmentWithRelations, message: string, ctx: { type: ReminderType; zone: string }): Promise<string>;
}

export const emailSender: ReminderSender = {
  channel: 'email',
  name: 'email',
  async send(appt, _message, { type, zone }) {
    const email = templates.reminder(visitInfo(appt, zone), type === 'reminder_2h' ? '2h' : '24h');
    const result = await sendEmail({
      to: { email: appt.patient.email!, name: `${appt.patient.first_name} ${appt.patient.last_name}` },
      ...email,
    });
    if (result.sent) return `sent via Brevo${result.id ? ` (${result.id})` : ''}`;
    if (env.NODE_ENV === 'production') throw new Error('Brevo is not configured');
    return 'logged only (BREVO_API_KEY not set)';
  },
};

/** Logs instead of sending. Selectable with ?sender=log. */
export const logSender: ReminderSender = {
  channel: 'email',
  name: 'log',
  async send(_appt, message) {
    console.info('[reminder]', message);
    return 'logged only';
  },
};

export const SENDERS: Record<string, ReminderSender> = { email: emailSender, log: logSender };

export function buildMessage(appt: AppointmentWithRelations, zone: string): string {
  const p = clinicParts(appt.starts_at, zone);
  return (
    `Reminder for ${appt.patient.first_name} ${appt.patient.last_name} (${appt.patient.phone}): ` +
    `${appt.service.name} with ${appt.staff.full_name} on ${p.label} at ${p.hhmm}.`
  );
}

/**
 * Due = starts in (now + afterHours, now + withinHours] and not yet handled
 * for this reminder type.
 */
export async function findDue(conn: Conn, withinHours: number, type: ReminderType, afterHours = 0) {
  const current = now();
  const handled = conn
    .select({ id: notifications.appointment_id })
    .from(notifications)
    .where(
      and(
        eq(notifications.type, type),
        eq(notifications.channel, 'email'),
        inArray(notifications.status, ['sent', 'skipped']),
      ),
    );
  return conn.query.appointments.findMany({
    where: and(
      inArray(appointments.status, [...REMINDABLE]),
      gte(appointments.starts_at, addMinutes(current, afterHours * 60)),
      lte(appointments.starts_at, addMinutes(current, withinHours * 60)),
      notInArray(appointments.id, handled),
    ),
    with: { patient: true, staff: true, service: true },
    orderBy: asc(appointments.starts_at),
  });
}

export async function dispatch(
  conn: Conn,
  opts: { withinHours: number; afterHours?: number; type: ReminderType; sender: ReminderSender; zone: string },
) {
  const due = await findDue(conn, opts.withinHours, opts.type, opts.afterHours);
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const results = [];

  // Sequential on purpose: one sender failure must not abort the sweep, and
  // each attempt is logged before moving on.
  for (const appt of due) {
    const message = buildMessage(appt, opts.zone);
    let status: 'sent' | 'failed' | 'skipped';
    let detail: string;
    if (!appt.patient.email) {
      status = 'skipped';
      detail = 'No email address on file';
      skipped += 1;
    } else {
      try {
        detail = await opts.sender.send(appt, message, { type: opts.type, zone: opts.zone });
        status = 'sent';
        sent += 1;
      } catch (err) {
        detail = `${(err as Error).name}: ${(err as Error).message}`;
        status = 'failed';
        failed += 1;
      }
    }
    await conn.insert(notifications).values({
      type: opts.type,
      channel: opts.sender.channel,
      audience: 'user',
      user_id: appt.patient.user_id,
      appointment_id: appt.id,
      recipient: appt.patient.email,
      status,
      title: 'Appointment reminder',
      detail,
    });
    results.push({
      appointment_id: appt.id,
      patient_name: `${appt.patient.first_name} ${appt.patient.last_name}`,
      starts_at: appt.starts_at,
      status,
      detail,
    });
  }

  return {
    channel: opts.sender.channel,
    sender: opts.sender.name,
    type: opts.type,
    considered: due.length,
    sent,
    failed,
    skipped,
    results,
  };
}
