import type { FastifyPluginAsync } from 'fastify';
import type { DB } from '../db/client.js';
import { getClinicZone } from '../lib/settings.js';
import { clinicToday } from '../lib/time.js';

/** Read-only for now; the admin console (Phase 6) adds changing the time zone. */
export const settingsRoutes: FastifyPluginAsync<{ db: DB }> = async (app, { db }) => {
  app.get('/', async () => {
    const timezone = await getClinicZone(db);
    return { timezone, today: clinicToday(timezone) };
  });
};
