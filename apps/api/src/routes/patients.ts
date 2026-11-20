import type { FastifyPluginAsync } from 'fastify';
import { asc, eq, ilike, or } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../db/client.js';
import { patients } from '../db/schema.js';
import { logActivity } from '../domain/activity.js';
import { getPatient } from '../domain/scheduling.js';
import { serializePatient } from '../domain/serialize.js';
import { getClinicZone } from '../lib/settings.js';
import { idParams, isoDate, parse } from '../lib/validate.js';

const fields = {
  first_name: z.string().trim().min(1).max(80),
  last_name: z.string().trim().min(1).max(80),
  phone: z.string().trim().min(3).max(32),
  email: z.string().trim().toLowerCase().email().nullable(),
  date_of_birth: isoDate.nullable(),
  notes: z.string().nullable(),
};
const PatientCreate = z.object({
  ...fields,
  email: fields.email.optional(),
  date_of_birth: fields.date_of_birth.optional(),
  notes: fields.notes.optional(),
});
const PatientUpdate = z.object(fields).partial();

/** Shared "name or phone" filter, also used by appointment search. */
export function patientMatch(q: string) {
  const like = `%${q.trim()}%`;
  return or(
    ilike(patients.first_name, like),
    ilike(patients.last_name, like),
    ilike(patients.phone, like),
  );
}

export const patientRoutes: FastifyPluginAsync<{ db: DB }> = async (app, { db }) => {
  app.get('/', async (req) => {
    const q = parse(
      z.object({
        q: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      }),
      req.query,
    );
    const zone = await getClinicZone(db);
    const rows = await db
      .select()
      .from(patients)
      .where(q.q ? patientMatch(q.q) : undefined)
      .orderBy(asc(patients.last_name), asc(patients.first_name))
      .limit(q.limit);
    return rows.map((p) => serializePatient(p, zone));
  });

  app.post('/', async (req, reply) => {
    const body = parse(PatientCreate, req.body);
    const zone = await getClinicZone(db);
    const created = await db.transaction(async (tx) => {
      const [row] = await tx.insert(patients).values(body).returning();
      await logActivity(tx, req.actor, {
        action: 'create',
        entity: 'patient',
        entity_id: row!.id,
        after: body,
      });
      return row!;
    });
    return reply.status(201).send(serializePatient(created, zone));
  });

  app.get('/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    return serializePatient(await getPatient(db, id), await getClinicZone(db));
  });

  app.patch('/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(PatientUpdate, req.body);
    const zone = await getClinicZone(db);
    const updated = await db.transaction(async (tx) => {
      const current = await getPatient(tx, id);
      if (Object.keys(body).length === 0) return current;
      const [row] = await tx.update(patients).set(body).where(eq(patients.id, id)).returning();
      await logActivity(tx, req.actor, {
        action: 'update',
        entity: 'patient',
        entity_id: id,
        before: pick(current, Object.keys(body)),
        after: body,
      });
      return row!;
    });
    return serializePatient(updated, zone);
  });
};

export function pick<T extends object>(obj: T, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((k) => [k, (obj as Record<string, unknown>)[k]]));
}
