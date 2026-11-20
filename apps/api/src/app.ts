import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { env } from './env.js';
import type { DB } from './db/client.js';
import type { Actor } from './domain/activity.js';
import { DomainError, isOverlapViolation } from './lib/errors.js';
import { healthRoutes } from './routes/health.js';
import { patientRoutes } from './routes/patients.js';
import { staffRoutes } from './routes/staff.js';
import { serviceRoutes } from './routes/services.js';
import { appointmentRoutes } from './routes/appointments.js';
import { reportRoutes } from './routes/reports.js';
import { reminderRoutes, type ReminderSender } from './routes/reminders.js';
import { settingsRoutes } from './routes/settings.js';

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor;
  }
}

export interface AppOptions {
  /** null = no database configured; only /api/health is served. */
  db: DB | null;
  /** Test hook: replaces the email sender used by reminder dispatch. */
  reminderSender?: ReminderSender;
  logger?: boolean;
}

export async function buildApp({ db, reminderSender, logger }: AppOptions) {
  const app = Fastify({ logger: logger ?? env.NODE_ENV !== 'test', trustProxy: true });

  // In production Vercel rewrites /api/* to this service, so requests are
  // same-origin from the browser's view; CORS covers direct calls in dev.
  await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true });
  await app.register(cookie);

  // Phase 2 replaces this with the authenticated user from the session cookie.
  app.decorateRequest('actor', null as unknown as Actor);
  app.addHook('onRequest', async (req) => {
    req.actor = {
      user_id: null,
      role: null,
      ip: req.ip,
      user_agent: req.headers['user-agent'] ?? null,
    };
  });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof DomainError) {
      return reply.status(err.statusCode).send(err.toPayload());
    }
    if (isOverlapViolation(err)) {
      return reply.status(409).send({
        code: 'slot_conflict',
        message: 'That slot was just taken by another booking. Pick another time.',
      });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply
        .status(err.statusCode)
        .send({ code: err.code ?? 'bad_request', message: err.message });
    }
    req.log.error(err);
    return reply.status(500).send({ code: 'internal_error', message: 'Something went wrong.' });
  });

  await app.register(healthRoutes, { prefix: '/api', db });

  if (db) {
    await app.register(patientRoutes, { prefix: '/api/patients', db });
    await app.register(staffRoutes, { prefix: '/api/staff', db });
    await app.register(serviceRoutes, { prefix: '/api/services', db });
    await app.register(appointmentRoutes, { prefix: '/api/appointments', db });
    await app.register(reportRoutes, { prefix: '/api/reports', db });
    await app.register(reminderRoutes, { prefix: '/api/reminders', db, sender: reminderSender });
    await app.register(settingsRoutes, { prefix: '/api/settings', db });
  } else {
    app.all('/api/*', async (_req, reply) =>
      reply.status(503).send({
        code: 'database_unconfigured',
        message: 'DATABASE_URL is not set on the API server.',
      }),
    );
  }

  return app;
}
