import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyPluginAsync,
  type preHandlerAsyncHookHandler,
} from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { env } from './env.js';
import type { DB } from './db/client.js';
import type { Actor } from './domain/activity.js';
import type { ReminderSender } from './domain/reminders.js';
import { employeeWritesAdminReads, registerAuth, requireRole } from './lib/auth.js';
import { DomainError, isOverlapViolation } from './lib/errors.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { patientRoutes } from './routes/patients.js';
import { staffRoutes } from './routes/staff.js';
import { serviceRoutes } from './routes/services.js';
import { appointmentRoutes } from './routes/appointments.js';
import { reportRoutes } from './routes/reports.js';
import { reminderRoutes } from './routes/reminders.js';
import { settingsRoutes } from './routes/settings.js';
import { notificationRoutes } from './routes/notifications.js';
import { portalRoutes } from './routes/portal.js';
import { adminRoutes } from './routes/admin.js';
import { cronRoutes } from './routes/cron.js';

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor;
  }
}

export interface AppOptions {
  /** null = no database configured; only /api/health is served. */
  db: DB | null;
  /** Test hook: replaces the email sender used for reminders. */
  reminderSender?: ReminderSender;
  logger?: boolean;
  /** Defaults to on outside tests. */
  rateLimit?: boolean;
}

/**
 * Who may call what:
 *   /api/auth, /api/health, /api/cron     public (cron needs its secret)
 *   /api/portal                            patient
 *   /api/patients, appointments            employee; admin read-only
 *   /api/staff, services                   employee; admin read-only (no edits — decision #5)
 *   /api/reports, reminders                employee
 *   /api/admin                             admin
 *   /api/notifications, settings           any signed-in user
 */
export async function buildApp({ db, reminderSender, logger, rateLimit: limit }: AppOptions) {
  const app = Fastify({
    logger: logger ?? env.NODE_ENV !== 'test',
    trustProxy: true, // Render/Vercel proxies: req.ip is the real client
    bodyLimit: 256 * 1024,
  });

  await app.register(helmet, { contentSecurityPolicy: false }); // JSON API; the SPA sets its own CSP
  await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true });
  await app.register(cookie);
  if (limit ?? env.NODE_ENV !== 'test') {
    // Opt-in per route via `config.rateLimit` (login, password reset, booking).
    await app.register(rateLimit, { global: false });
  }

  app.decorateRequest('actor', null as unknown as Actor);
  app.addHook('onRequest', async (req) => {
    req.actor = { user_id: null, role: null, ip: req.ip, user_agent: req.headers['user-agent'] ?? null };
  });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof DomainError) return reply.status(err.statusCode).send(err.toPayload());
    if (isOverlapViolation(err)) {
      return reply.status(409).send({
        code: 'slot_conflict',
        message: 'That slot was just taken by another booking. Pick another time.',
      });
    }
    if (err.statusCode === 429) {
      return reply.status(429).send({ code: 'rate_limited', message: 'Too many attempts. Please wait a moment and try again.' });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.status(err.statusCode).send({ code: err.code ?? 'bad_request', message: err.message });
    }
    req.log.error(err);
    return reply.status(500).send({ code: 'internal_error', message: 'Something went wrong.' });
  });

  await app.register(healthRoutes, { prefix: '/api', db });

  if (!db) {
    app.all('/api/*', async (_req, reply) =>
      reply.status(503).send({ code: 'database_unconfigured', message: 'DATABASE_URL is not set on the API server.' }),
    );
    return app;
  }

  await registerAuth(app, db);

  const guarded = async <O extends object>(
    prefix: string,
    guard: preHandlerAsyncHookHandler | null,
    plugin: FastifyPluginAsync<O & { db: DB }>,
    opts?: O,
  ) =>
    app.register(async (scope: FastifyInstance) => {
      if (guard) scope.addHook('preHandler', guard);
      await scope.register(plugin as FastifyPluginAsync<{ db: DB }>, { prefix, db, ...(opts ?? {}) });
    });

  const signedIn = requireRole('patient', 'employee', 'admin');
  const employee = requireRole('employee');

  await guarded('/api/auth', null, authRoutes);
  await guarded('/api/cron', null, cronRoutes, { sender: reminderSender });
  await guarded('/api/portal', requireRole('patient'), portalRoutes);
  await guarded('/api/patients', employeeWritesAdminReads(), patientRoutes);
  await guarded('/api/appointments', employeeWritesAdminReads(), appointmentRoutes);
  await guarded('/api/staff', employeeWritesAdminReads(), staffRoutes);
  await guarded('/api/services', employeeWritesAdminReads(), serviceRoutes);
  await guarded('/api/reports', employee, reportRoutes);
  await guarded('/api/reminders', employee, reminderRoutes, { sender: reminderSender });
  await guarded('/api/notifications', signedIn, notificationRoutes);
  await guarded('/api/settings', signedIn, settingsRoutes);
  await guarded('/api/admin', requireRole('admin'), adminRoutes);

  return app;
}
