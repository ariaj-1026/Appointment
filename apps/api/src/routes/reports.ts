import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db/client.js';
import * as reports from '../domain/reports.js';
import { getStaff } from '../domain/scheduling.js';
import { ValidationError } from '../lib/errors.js';
import { getClinicZone } from '../lib/settings.js';
import { addDays, clinicToday, daysBetween } from '../lib/time.js';
import { id, isoDate, parse } from '../lib/validate.js';

const MAX_RANGE_DAYS = 366;
// With no range given: last week through the next four weeks. A clinic's
// appointments are mostly in the future, so a purely backward default would
// report zeros on a freshly seeded database.
const DEFAULT_DAYS_BACK = 7;
const DEFAULT_DAYS_AHEAD = 28;

const RangeQuery = z.object({
  date_from: isoDate.optional(),
  date_to: isoDate.optional(),
  staff_id: id.optional(),
});

function defaultRange(from: string | undefined, to: string | undefined, today: string) {
  const span = DEFAULT_DAYS_BACK + DEFAULT_DAYS_AHEAD;
  if (!from && !to) return [addDays(today, -DEFAULT_DAYS_BACK), addDays(today, DEFAULT_DAYS_AHEAD)];
  if (!from) return [addDays(to!, -span), to!];
  if (!to) return [from, addDays(from, span)];
  return [from, to];
}

function validateRange(from: string, to: string) {
  if (to < from) {
    throw new ValidationError('The end of the range is before its start.', {
      date_from: from,
      date_to: to,
    });
  }
  const span = daysBetween(from, to) + 1;
  if (span > MAX_RANGE_DAYS) {
    throw new ValidationError(`Range covers ${span} days; the maximum is ${MAX_RANGE_DAYS}.`, {
      days: span,
    });
  }
}

export const reportRoutes: FastifyPluginAsync<{ db: DB }> = async (app, { db }) => {
  async function rangeArgs(req: FastifyRequest) {
    const q = parse(RangeQuery, req.query);
    const zone = await getClinicZone(db);
    const [from, to] = defaultRange(q.date_from, q.date_to, clinicToday(zone));
    validateRange(from!, to!);
    if (q.staff_id) await getStaff(db, q.staff_id);
    return { from: from!, to: to!, zone, staffId: q.staff_id };
  }

  app.get('/daily-summary', async (req) => {
    const q = parse(z.object({ date: isoDate.optional(), staff_id: id.optional() }), req.query);
    const zone = await getClinicZone(db);
    if (q.staff_id) await getStaff(db, q.staff_id);
    return reports.dailySummary(db, q.date ?? clinicToday(zone), zone, q.staff_id);
  });

  const utilisation = async (req: FastifyRequest) => {
    const a = await rangeArgs(req);
    return reports.utilisation(db, a.from, a.to, a.zone, a.staffId);
  };
  app.get('/utilisation', utilisation);
  app.get('/utilization', utilisation); // US spelling alias

  app.get('/cancellations', async (req) => {
    const a = await rangeArgs(req);
    return reports.cancellations(db, a.from, a.to, a.zone, a.staffId);
  });
};
