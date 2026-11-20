import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { env } from './env.js';
import { healthRoutes } from './routes/health.js';

export async function buildApp() {
  const app = Fastify({ logger: env.NODE_ENV !== 'test', trustProxy: true });

  // In production Vercel rewrites /api/* to this service, so requests are
  // same-origin from the browser's view; CORS covers direct calls in dev.
  await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true });
  await app.register(cookie);

  await app.register(healthRoutes, { prefix: '/api' });

  return app;
}
