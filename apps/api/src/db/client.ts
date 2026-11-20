import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema.js';

/**
 * Any Postgres-backed Drizzle instance with our schema: node-postgres in
 * production (Neon), PGlite in tests.
 */
export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
/** Something you can run queries on: the db itself or an open transaction. */
export type Conn = DB | Tx;

export function createDb(databaseUrl: string): { db: DB; close: () => Promise<void> } {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
  return { db: drizzle(pool, { schema }) as unknown as DB, close: () => pool.end() };
}

export async function pingDb(db: DB | null): Promise<'up' | 'down' | 'unconfigured'> {
  if (!db) return 'unconfigured';
  try {
    await db.execute(sql`select 1`);
    return 'up';
  } catch {
    return 'down';
  }
}
