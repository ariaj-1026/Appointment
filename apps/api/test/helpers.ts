/**
 * Test harness: an in-process Postgres (PGlite) with the real migrations
 * applied — including the btree_gist exclusion constraint — so tests exercise
 * the same SQL production runs on Neon.
 *
 * One database per test file; tables are truncated before each test.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as schema from '../src/db/schema.js';
import type { DB } from '../src/db/client.js';
import { buildApp } from '../src/app.js';
import { setNow } from '../src/lib/time.js';
import type { ReminderSender } from '../src/domain/reminders.js';

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drizzle');

/** Friday 20 Nov 2026, 10:00 Manila. Next Monday is 2026-11-23. */
export const NOW = new Date('2026-11-20T10:00:00+08:00');
export const MONDAY = '2026-11-23';
export const TUESDAY = '2026-11-24';
export const SATURDAY = '2026-11-28';

export interface Ctx {
  db: DB;
  app: FastifyInstance;
  sender: RecordingSender;
}

export class RecordingSender implements ReminderSender {
  channel = 'email' as const;
  name = 'test';
  sent: string[] = [];
  failFor = new Set<number>();
  async send(appt: Parameters<ReminderSender['send']>[0], message: string) {
    if (this.failFor.has(appt.id)) throw new Error('mailbox unavailable');
    this.sent.push(message);
    return 'recorded';
  }
}

export function setupTestApp(): Ctx {
  const ctx = {} as Ctx;
  let pg: PGlite;

  beforeAll(async () => {
    pg = new PGlite({ extensions: { btree_gist } });
    const db = drizzle(pg, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    ctx.db = db as unknown as DB;
    ctx.sender = new RecordingSender();
    ctx.app = await buildApp({ db: ctx.db, reminderSender: ctx.sender, logger: false });
  });

  beforeEach(async () => {
    setNow(NOW);
    ctx.sender.sent = [];
    ctx.sender.failFor.clear();
    await ctx.db.execute(sql`
      TRUNCATE notifications, activity_log, appointments, business_hours, patients,
               services, staff, password_resets, clinic_settings, users
      RESTART IDENTITY CASCADE`);
    await ctx.db.execute(sql`INSERT INTO clinic_settings (id) VALUES (1)`);
  });

  afterAll(async () => {
    setNow(null);
    await ctx.app?.close();
    await pg?.close();
  });

  return ctx;
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT';

export async function call(ctx: Ctx, method: Method, url: string, payload?: unknown) {
  const res = await ctx.app.inject({ method, url, payload: payload as object });
  return { status: res.statusCode, body: res.json() as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export async function ok(ctx: Ctx, method: Method, url: string, payload?: unknown) {
  const res = await call(ctx, method, url, payload);
  if (res.status >= 300) throw new Error(`${method} ${url} → ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}

export async function makeStaff(ctx: Ctx, name = 'Dr. Ilagan', extra: object = {}) {
  return ok(ctx, 'POST', '/api/staff', { full_name: name, role: 'Physician', ...extra });
}

export async function makeService(ctx: Ctx, name = 'Consultation', minutes = 30, extra: object = {}) {
  return ok(ctx, 'POST', '/api/services', { name, duration_minutes: minutes, ...extra });
}

export async function makePatient(ctx: Ctx, first = 'Ana', last = 'Cruz', phone = '0917-555-0101', extra: object = {}) {
  return ok(ctx, 'POST', '/api/patients', { first_name: first, last_name: last, phone, ...extra });
}

/** Staff + service + patient, ready to book. */
export async function basics(ctx: Ctx, minutes = 30) {
  const staff = await makeStaff(ctx);
  const service = await makeService(ctx, 'Consultation', minutes);
  const patient = await makePatient(ctx, 'Ana', 'Cruz', '0917-555-0101', { email: 'ana@example.com' });
  return { staff, service, patient };
}

export function book(
  ctx: Ctx,
  ids: { staff: { id: number }; service: { id: number }; patient: { id: number } },
  startsAt: string,
  extra: object = {},
) {
  return call(ctx, 'POST', '/api/appointments', {
    patient_id: ids.patient.id,
    staff_id: ids.staff.id,
    service_id: ids.service.id,
    starts_at: startsAt,
    ...extra,
  });
}

export const MON_FRI_9_TO_5_WITH_LUNCH = [0, 1, 2, 3, 4].flatMap((weekday) => [
  { weekday, opens_at: '09:00', closes_at: '12:00' },
  { weekday, opens_at: '13:00', closes_at: '17:00' },
]);
