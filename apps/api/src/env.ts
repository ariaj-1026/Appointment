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
  DEFAULT_CLINIC_TIMEZONE: z.string().default(DEFAULT_TIMEZONE),
});

export const env = EnvSchema.parse(process.env);
export type Env = typeof env;
