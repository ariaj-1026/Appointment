import { z } from 'zod';
import { DEFAULT_TIMEZONE } from '@clinic/shared';

/** Optional in Phase 0 so the API boots before every service is provisioned. */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(8000),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().url().optional(),
  JWT_SECRET: z.string().min(32).optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  BREVO_API_KEY: z.string().optional(),
  BREVO_SENDER_EMAIL: z.string().email().optional(),
  BREVO_SENDER_NAME: z.string().default('Clinic Appointments'),
  CRON_SECRET: z.string().optional(),
  /** Enables the one-time /setup page that creates the first admin. */
  SETUP_TOKEN: z.string().min(16).optional(),
  DEFAULT_CLINIC_TIMEZONE: z.string().default(DEFAULT_TIMEZONE),
  /** How far into the past a new booking may start (a slot just begun). */
  BOOKING_GRACE_MINUTES: z.coerce.number().int().min(0).default(15),
  MAX_BOOKING_DAYS_AHEAD: z.coerce.number().int().positive().default(365),
});

// `KEY=` in a .env file means "not set", not "set to an empty string".
const cleaned = Object.fromEntries(
  Object.entries(process.env).filter(([, v]) => v !== undefined && v.trim() !== ''),
);

const parsed = EnvSchema.safeParse(cleaned);
if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
  console.error(`Invalid environment (check apps/api/.env):\n${lines.join('\n')}`);
  process.exit(1);
}
export const env = parsed.data;
export type Env = typeof env;
