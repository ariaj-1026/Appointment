import type { FastifyPluginAsync } from 'fastify';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../db/client.js';
import { services } from '../db/schema.js';
import { logActivity } from '../domain/activity.js';
import { getService } from '../domain/scheduling.js';
import { ValidationError, isUniqueViolation } from '../lib/errors.js';
import { idParams, parse, queryBool } from '../lib/validate.js';
import { pick } from './patients.js';

const fields = {
  name: z.string().trim().min(1).max(120),
  duration_minutes: z.number().int().positive().max(600),
  description: z.string().nullable(),
  is_active: z.boolean(),
};
const ServiceCreate = z.object({
  ...fields,
  description: fields.description.optional(),
  is_active: fields.is_active.default(true),
});
const ServiceUpdate = z.object(fields).partial();

function duplicateName(err: unknown, name: string | undefined): never {
  if (isUniqueViolation(err)) {
    throw new ValidationError(`A service named "${name}" already exists.`, { name });
  }
  throw err;
}

export const serviceRoutes: FastifyPluginAsync<{ db: DB }> = async (app, { db }) => {
  app.get('/', async (req) => {
    const q = parse(z.object({ include_inactive: queryBool.default(false) }), req.query);
    return db
      .select()
      .from(services)
      .where(q.include_inactive ? undefined : eq(services.is_active, true))
      .orderBy(asc(services.name));
  });

  app.post('/', async (req, reply) => {
    const body = parse(ServiceCreate, req.body);
    const created = await db
      .transaction(async (tx) => {
        const [row] = await tx.insert(services).values(body).returning();
        await logActivity(tx, req.actor, {
          action: 'create',
          entity: 'service',
          entity_id: row!.id,
          after: body,
        });
        return row!;
      })
      .catch((err) => duplicateName(err, body.name));
    return reply.status(201).send(created);
  });

  app.get('/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    return getService(db, id);
  });

  /**
   * Changing duration_minutes does not move existing appointments — their
   * ends_at was fixed at booking time on purpose.
   */
  app.patch('/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(ServiceUpdate, req.body);
    return db
      .transaction(async (tx) => {
        const current = await getService(tx, id);
        if (Object.keys(body).length === 0) return current;
        const [row] = await tx.update(services).set(body).where(eq(services.id, id)).returning();
        await logActivity(tx, req.actor, {
          action: 'update',
          entity: 'service',
          entity_id: id,
          before: pick(current, Object.keys(body)),
          after: body,
        });
        return row!;
      })
      .catch((err) => duplicateName(err, body.name));
  });
};
