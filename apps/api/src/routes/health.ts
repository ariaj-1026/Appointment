import type { FastifyPluginAsync } from 'fastify';
import type { HealthResponse } from '@clinic/shared';
import { pingDb, type DB } from '../db/client.js';

export const healthRoutes: FastifyPluginAsync<{ db: DB | null }> = async (app, { db }) => {
  app.get('/health', async (): Promise<HealthResponse> => {
    const status = await pingDb(db);
    return { ok: status !== 'down', db: status, time: new Date().toISOString() };
  });
};
