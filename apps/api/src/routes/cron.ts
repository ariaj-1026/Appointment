/**
 * Scheduled jobs, called by an external scheduler (Render cron job, GitHub
 * Actions, cron-job.org …) every 15–30 minutes:
 *
 *   curl -X POST https://<app>/api/cron/reminders -H "authorization: Bearer $CRON_SECRET"
 *
 * Sends the 24h reminder to visits starting 2–24h from now and the 2h reminder
 * to visits starting within 2h. Each reminder goes out once per appointment
 * (tracked in `notifications`), so overlapping or repeated runs are harmless.
 */
import crypto from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import type { DB } from '../db/client.js';
import { dispatch, emailSender, type ReminderSender } from '../domain/reminders.js';
import { env } from '../env.js';
import { UnauthorizedError } from '../lib/auth.js';
import { getClinicZone } from '../lib/settings.js';

function secretMatches(header: string | undefined): boolean {
  if (!env.CRON_SECRET || !header) return false;
  const given = Buffer.from(header.replace(/^Bearer\s+/i, ''));
  const expected = Buffer.from(env.CRON_SECRET);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

export const cronRoutes: FastifyPluginAsync<{ db: DB; sender?: ReminderSender }> = async (app, opts) => {
  app.post('/reminders', async (req) => {
    if (!secretMatches(req.headers.authorization)) throw new UnauthorizedError('Invalid cron secret.');
    const zone = await getClinicZone(opts.db);
    const sender = opts.sender ?? emailSender;
    const day = await dispatch(opts.db, { type: 'reminder_24h', withinHours: 24, afterHours: 2, sender, zone });
    const soon = await dispatch(opts.db, { type: 'reminder_2h', withinHours: 2, sender, zone });
    const summary = (r: typeof day) => ({ considered: r.considered, sent: r.sent, failed: r.failed, skipped: r.skipped });
    return { ok: true, reminder_24h: summary(day), reminder_2h: summary(soon) };
  });
};
