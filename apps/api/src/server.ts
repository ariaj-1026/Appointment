import { buildApp } from './app.js';
import { createDb } from './db/client.js';
import { env } from './env.js';

const conn = env.DATABASE_URL ? createDb(env.DATABASE_URL) : null;
if (!conn) console.warn('DATABASE_URL is not set — serving /api/health only.');

const app = await buildApp({ db: conn?.db ?? null });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    await conn?.close();
    process.exit(0);
  });
}

await app.listen({ port: env.PORT, host: '0.0.0.0' });
