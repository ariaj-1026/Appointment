import type { FastifyPluginAsync } from 'fastify';
import { and, asc, desc, eq, like } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../db/client.js';
import { notifications } from '../db/schema.js';
import {
  REMINDER_TYPES,
  SENDERS,
  dispatch,
  findDue,
  type ReminderSender,
} from '../domain/reminders.js';
import { getAppointment } from '../domain/scheduling.js';
import { serializeAppointmentDetail } from '../domain/serialize.js';
import { ValidationError } from '../lib/errors.js';
import { getClinicZone } from '../lib/settings.js';
import { toClinicIso } from '../lib/time.js';
import { idParams, parse } from '../lib/validate.js';

export type { ReminderSender };

const SweepQuery = z.object({
  within_hours: z.coerce.number().int().min(1).max(720).default(24),
  type: z.enum(REMINDER_TYPES).default('reminder_24h'),
});

type Row = typeof notifications.$inferSelect;
const logRow = (r: Row, zone: string) => ({
  id: r.id,
  appointment_id: r.appointment_id,
  type: r.type,
  channel: r.channel,
  status: r.status,
  recipient: r.recipient,
  detail: r.detail,
  sent_at: toClinicIso(r.created_at, zone),
});

const isReminder = like(notifications.type, 'reminder_%');

export const reminderRoutes: FastifyPluginAsync<{ db: DB; sender?: ReminderSender }> = async (
  app,
  opts,
) => {
  const { db } = opts;

  /** Upcoming appointments that have not had this reminder yet. */
  app.get('/due', async (req) => {
    const q = parse(SweepQuery, req.query);
    const zone = await getClinicZone(db);
    const due = await findDue(db, q.within_hours, q.type);
    return due.map((a) => serializeAppointmentDetail(a, zone));
  });

  /** Send every due reminder and log each attempt. */
  app.post('/dispatch', async (req) => {
    const q = parse(SweepQuery.extend({ sender: z.string().optional() }), req.query);
    let sender = opts.sender ?? SENDERS.email!;
    if (q.sender) {
      const chosen = SENDERS[q.sender.toLowerCase()];
      if (!chosen) {
        throw new ValidationError(
          `Unknown reminder sender '${q.sender}'. Available: ${Object.keys(SENDERS).sort().join(', ')}.`,
        );
      }
      sender = chosen;
    }
    const zone = await getClinicZone(db);
    const result = await dispatch(db, { withinHours: q.within_hours, type: q.type, sender, zone });
    return {
      ...result,
      results: result.results.map((r) => ({ ...r, starts_at: toClinicIso(r.starts_at, zone) })),
    };
  });

  app.get('/log', async (req) => {
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }), req.query);
    const zone = await getClinicZone(db);
    const rows = await db
      .select()
      .from(notifications)
      .where(isReminder)
      .orderBy(desc(notifications.created_at), desc(notifications.id))
      .limit(q.limit);
    return rows.map((r) => logRow(r, zone));
  });

  app.get('/log/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    const zone = await getClinicZone(db);
    await getAppointment(db, id);
    const rows = await db
      .select()
      .from(notifications)
      .where(and(isReminder, eq(notifications.appointment_id, id)))
      .orderBy(asc(notifications.created_at), asc(notifications.id));
    return rows.map((r) => logRow(r, zone));
  });
};
