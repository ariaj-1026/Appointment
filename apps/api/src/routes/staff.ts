import type { FastifyPluginAsync } from 'fastify';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Conn, DB } from '../db/client.js';
import { business_hours, staff } from '../db/schema.js';
import { logActivity } from '../domain/activity.js';
import { getStaff } from '../domain/scheduling.js';
import { ValidationError } from '../lib/errors.js';
import { clockTime, idParams, parse, queryBool } from '../lib/validate.js';
import { pick } from './patients.js';

const fields = {
  full_name: z.string().trim().min(1).max(160),
  role: z.string().trim().min(1).max(80),
  is_active: z.boolean(),
};
const StaffCreate = z.object({ ...fields, is_active: fields.is_active.default(true) });
const StaffUpdate = z.object(fields).partial();

const BusinessHourWrite = z
  .object({ weekday: z.number().int().min(0).max(6), opens_at: clockTime, closes_at: clockTime })
  .refine((w) => w.opens_at < w.closes_at, 'opens_at must be earlier than closes_at');

const hhmm = (t: string) => t.slice(0, 5);

async function listHours(db: Conn, staffId: number) {
  return db
    .select()
    .from(business_hours)
    .where(eq(business_hours.staff_id, staffId))
    .orderBy(asc(business_hours.weekday), asc(business_hours.opens_at));
}

export const staffRoutes: FastifyPluginAsync<{ db: DB }> = async (app, { db }) => {
  app.get('/', async (req) => {
    const q = parse(z.object({ include_inactive: queryBool.default(false) }), req.query);
    return db
      .select()
      .from(staff)
      .where(q.include_inactive ? undefined : eq(staff.is_active, true))
      .orderBy(asc(staff.full_name));
  });

  app.post('/', async (req, reply) => {
    const body = parse(StaffCreate, req.body);
    const created = await db.transaction(async (tx) => {
      const [row] = await tx.insert(staff).values(body).returning();
      await logActivity(tx, req.actor, {
        action: 'create',
        entity: 'staff',
        entity_id: row!.id,
        after: body,
      });
      return row!;
    });
    return reply.status(201).send(created);
  });

  app.get('/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    return getStaff(db, id);
  });

  app.patch('/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(StaffUpdate, req.body);
    return db.transaction(async (tx) => {
      const current = await getStaff(tx, id);
      if (Object.keys(body).length === 0) return current;
      const [row] = await tx.update(staff).set(body).where(eq(staff.id, id)).returning();
      await logActivity(tx, req.actor, {
        action: 'update',
        entity: 'staff',
        entity_id: id,
        before: pick(current, Object.keys(body)),
        after: body,
      });
      return row!;
    });
  });

  // ---- Business hours ----

  app.get('/:id/business-hours', async (req) => {
    const { id } = parse(idParams, req.params);
    await getStaff(db, id);
    return listHours(db, id);
  });

  /**
   * Replace the whole weekly schedule. Existing appointments are not
   * revalidated — moving them is a deliberate act, not a side effect.
   */
  app.put('/:id/business-hours', async (req) => {
    const { id } = parse(idParams, req.params);
    const windows = parse(z.array(BusinessHourWrite), req.body);
    await getStaff(db, id);

    const seen = new Set<string>();
    for (const w of windows) {
      const key = `${w.weekday}|${w.opens_at}`;
      if (seen.has(key)) {
        throw new ValidationError(
          `Duplicate opening time ${hhmm(w.opens_at)} for weekday ${w.weekday}.`,
          { weekday: w.weekday },
        );
      }
      seen.add(key);
    }

    const byDay = new Map<number, typeof windows>();
    for (const w of windows) byDay.set(w.weekday, [...(byDay.get(w.weekday) ?? []), w]);
    for (const [weekday, list] of byDay) {
      list.sort((a, b) => a.opens_at.localeCompare(b.opens_at));
      for (let i = 1; i < list.length; i++) {
        const [earlier, later] = [list[i - 1]!, list[i]!];
        if (later.opens_at < earlier.closes_at) {
          throw new ValidationError(
            `Overlapping hours on weekday ${weekday}: ` +
              `${hhmm(earlier.opens_at)}-${hhmm(earlier.closes_at)} and ` +
              `${hhmm(later.opens_at)}-${hhmm(later.closes_at)}.`,
            { weekday },
          );
        }
      }
    }

    await db.transaction(async (tx) => {
      const before = await listHours(tx, id);
      await tx.delete(business_hours).where(eq(business_hours.staff_id, id));
      if (windows.length) {
        await tx.insert(business_hours).values(windows.map((w) => ({ ...w, staff_id: id })));
      }
      await logActivity(tx, req.actor, {
        action: 'update',
        entity: 'business_hours',
        entity_id: id,
        before: { windows: before.map(({ weekday, opens_at, closes_at }) => ({ weekday, opens_at, closes_at })) },
        after: { windows },
      });
    });
    return listHours(db, id);
  });
};
