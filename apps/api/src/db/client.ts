import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { sql } from 'drizzle-orm';
import { env } from '../env.js';
import * as schema from './schema.js';

export const db = env.DATABASE_URL ? drizzle(neon(env.DATABASE_URL), { schema }) : null;

export async function pingDb(): Promise<'up' | 'down' | 'unconfigured'> {
  if (!db) return 'unconfigured';
  try {
    await db.execute(sql`select 1`);
    return 'up';
  } catch {
    return 'down';
  }
}
