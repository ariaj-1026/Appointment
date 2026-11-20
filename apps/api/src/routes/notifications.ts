/**
 * In-app notifications. Employees share one inbox (new patients, booking
 * requests, cancellations); patients see their own. Admins have none.
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { and, desc, eq, isNull, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../db/client.js';
import { notifications } from '../db/schema.js';
import { currentUser } from '../lib/auth.js';
import { getClinicZone } from '../lib/settings.js';
import { now, toClinicIso, toClinicIsoOrNull } from '../lib/time.js';
import { idParams, parse, queryBool } from '../lib/validate.js';

function scope(req: FastifyRequest): SQL {
  const user = currentUser(req);
  return user.role === 'patient'
    ? and(eq(notifications.channel, 'in_app'), eq(notifications.user_id, user.id))!
    : and(eq(notifications.channel, 'in_app'), eq(notifications.audience, 'employees'))!;
}

export const notificationRoutes: FastifyPluginAsync<{ db: DB }> = async (app, { db }) => {
  app.get('/', async (req) => {
    const q = parse(
      z.object({ unread_only: queryBool.default(false), limit: z.coerce.number().int().min(1).max(200).default(50) }),
      req.query,
    );
    const zone = await getClinicZone(db);
    const base = scope(req);
    const rows = await db
      .select()
      .from(notifications)
      .where(q.unread_only ? and(base, isNull(notifications.read_at)) : base)
      .orderBy(desc(notifications.created_at), desc(notifications.id))
      .limit(q.limit);
    const unread = await db.$count(notifications, and(base, isNull(notifications.read_at)));
    return {
      unread,
      items: rows.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        detail: n.detail,
        appointment_id: n.appointment_id,
        read_at: toClinicIsoOrNull(n.read_at, zone),
        created_at: toClinicIso(n.created_at, zone),
      })),
    };
  });

  app.post('/:id/read', async (req) => {
    const { id } = parse(idParams, req.params);
    await db.update(notifications).set({ read_at: now() }).where(and(scope(req), eq(notifications.id, id)));
    return { ok: true };
  });

  app.post('/read-all', async (req) => {
    await db.update(notifications).set({ read_at: now() }).where(and(scope(req), isNull(notifications.read_at)));
    return { ok: true };
  });
};
