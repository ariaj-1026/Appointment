/**
 * Create (or reset) an admin login — for bootstrapping production, where the
 * demo seed is not wanted.
 *
 *   ADMIN_EMAIL=you@clinic.ph ADMIN_PASSWORD='…' ADMIN_NAME='Clinic Admin' \
 *     DATABASE_URL=… npm run db:create-admin -w @clinic/api
 *
 * If the email already exists as an admin, its password is reset and the
 * account reactivated. Refuses to turn a patient or employee into an admin.
 */
import { eq } from 'drizzle-orm';
import { createDb } from './client.js';
import { users } from './schema.js';
import { hashPassword } from '../lib/password.js';
import { logActivity, SYSTEM_ACTOR } from '../domain/activity.js';

const url = process.env.DATABASE_URL;
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
const name = process.env.ADMIN_NAME?.trim() || 'Clinic Admin';

if (!url || !email || !password) {
  console.error('Set DATABASE_URL, ADMIN_EMAIL and ADMIN_PASSWORD.');
  process.exit(1);
}
if (password.length < 12) {
  console.error('Use an admin password of at least 12 characters.');
  process.exit(1);
}

const { db, close } = createDb(url);
try {
  const hash = await hashPassword(password);
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  if (existing && existing.role !== 'admin') {
    console.error(`${email} is a ${existing.role} account; refusing to change it.`);
    process.exit(1);
  }
  if (existing) {
    await db.update(users).set({ password_hash: hash, is_active: true }).where(eq(users.id, existing.id));
    await logActivity(db, SYSTEM_ACTOR, { action: 'password_set_by_admin', entity: 'user', entity_id: existing.id, note: 'create-admin script' });
    console.info(`Reset password for admin ${email}.`);
  } else {
    const [u] = await db.insert(users).values({ email, full_name: name, role: 'admin', password_hash: hash }).returning();
    await logActivity(db, SYSTEM_ACTOR, { action: 'create', entity: 'user', entity_id: u!.id, after: { email, role: 'admin' }, note: 'create-admin script' });
    console.info(`Created admin ${email}. Sign in at /staff/login.`);
  }
} finally {
  await close();
}
