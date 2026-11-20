import type { FastifyPluginAsync } from 'fastify';
import type { HealthResponse } from '@clinic/shared';
import { pingDb } from '../db/client.js';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async (): Promise<HealthResponse> => {
    const db = await pingDb();
    return { ok: db !== 'down', db, time: new Date().toISOString() };
  });
};
