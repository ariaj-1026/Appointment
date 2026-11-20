/**
 * Applies pending migrations from ./drizzle. Run on every deploy before the
 * server starts (see render.yaml). Safe to re-run: applied migrations are
 * tracked in drizzle.__drizzle_migrations.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client.js';

export const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../drizzle',
);

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const { db, close } = createDb(url);
try {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await migrate(db as any, { migrationsFolder: MIGRATIONS_DIR });
  console.info('Migrations applied.');
} finally {
  await close();
}
