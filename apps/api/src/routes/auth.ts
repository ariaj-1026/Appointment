/**
 * Authentication.
 *
 *  POST /register         patient self-signup (open to anyone)
 *  POST /login            { portal: 'patient' | 'staff' } — patients sign in on the
 *                         patient page only; employees and admins on the staff page only
 *  POST /logout
 *  GET  /me
 *  POST /forgot-password  always 200 (doesn't reveal whether an account exists)
 *  POST /reset-password
 *  POST /change-password
 *  GET  /google/start     patients only
 *  GET  /google/callback
 */
import crypto from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../db/client.js';
import { password_resets, patients, staff, users, type User } from '../db/schema.js';
import { logActivity } from '../domain/activity.js';
import { notifyEmployees, sendAccountEmail } from '../domain/notify.js';
import { serializePatient } from '../domain/serialize.js';
import { env } from '../env.js';
import { UnauthorizedError, clearSession, currentUser, publicUser, setSession } from '../lib/auth.js';
import { ValidationError, isUniqueViolation } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { getClinicZone } from '../lib/settings.js';
import { templates } from '../lib/templates.js';
import { addMinutes, now } from '../lib/time.js';
import { isoDate, parse } from '../lib/validate.js';

export const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(200)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password must contain a letter and a number');
const email = z.string().trim().toLowerCase().email().max(254);

const Register = z.object({
  email,
  password,
  first_name: z.string().trim().min(1).max(80),
  last_name: z.string().trim().min(1).max(80),
  phone: z.string().trim().min(3).max(32),
  date_of_birth: isoDate.nullable().optional(),
});

const Login = z.object({
  email,
  password: z.string().min(1).max(200),
  portal: z.enum(['patient', 'staff']),
});

const RESET_TTL_MINUTES = 60;
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

// Same work whether or not the account exists, so response timing does not
// reveal which emails are registered.
const DUMMY_HASH = await hashPassword('timing-equaliser-not-a-real-password-1');

export const authRoutes: FastifyPluginAsync<{ db: DB }> = async (app, { db }) => {
  async function me(user: User) {
    const zone = await getClinicZone(db);
    const [patient] = await db.select().from(patients).where(eq(patients.user_id, user.id));
    const [member] = await db.select().from(staff).where(eq(staff.user_id, user.id));
    return {
      user: publicUser(user),
      patient: patient ? serializePatient(patient, zone) : null,
      staff: member ?? null,
      timezone: zone,
    };
  }

  async function startSession(req: FastifyRequest, reply: FastifyReply, user: User, action = 'login') {
    const [fresh] = await db
      .update(users)
      .set({ last_login_at: now() })
      .where(eq(users.id, user.id))
      .returning();
    setSession(app, reply, fresh!);
    await logActivity(db, { ...req.actor, user_id: user.id, role: user.role }, {
      action,
      entity: 'user',
      entity_id: user.id,
    });
    return fresh!;
  }

  // ---- Patient signup ----
  app.post('/register', async (req, reply) => {
    const body = parse(Register, req.body);
    const { email: addr, password: pw, ...profile } = body;
    const hash = await hashPassword(pw);
    let created: User;
    try {
      created = await db.transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({ email: addr, password_hash: hash, role: 'patient', full_name: `${profile.first_name} ${profile.last_name}` })
          .returning();
        // A new patient record, never an existing walk-in with the same email:
        // without email verification, linking would hand that record's history
        // to whoever typed the address. Employees can merge duplicates.
        const [patient] = await tx.insert(patients).values({ ...profile, email: addr, user_id: user!.id }).returning();
        await logActivity(tx, { ...req.actor, user_id: user!.id, role: 'patient' }, {
          action: 'register',
          entity: 'patient',
          entity_id: patient!.id,
          after: { email: addr, ...profile },
        });
        await notifyEmployees(tx, {
          type: 'new_patient',
          title: `New patient registered: ${profile.first_name} ${profile.last_name}`,
          detail: `${addr} · ${profile.phone}`,
        });
        return user!;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ValidationError('An account with this email already exists. Try signing in.', { field: 'email' });
      }
      throw err;
    }
    setSession(app, reply, created);
    return reply.status(201).send(await me(created));
  });

  // ---- Login / logout ----
  app.post('/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(Login, req.body);
    const [user] = await db.select().from(users).where(eq(users.email, body.email));
    const valid = await verifyPassword(user?.password_hash ?? DUMMY_HASH, body.password);
    const portalOk = user && (body.portal === 'patient' ? user.role === 'patient' : user.role !== 'patient');

    if (!user || !valid || !user.is_active || !portalOk) {
      await logActivity(db, req.actor, {
        action: 'login_failed',
        entity: 'user',
        entity_id: user?.id,
        note: `${body.email} (${body.portal} portal)${user && valid && !user.is_active ? ' — account deactivated' : ''}${user && valid && !portalOk ? ' — wrong login page' : ''}`,
      });
      if (user && valid && !portalOk) {
        throw new UnauthorizedError(
          body.portal === 'patient'
            ? 'This is a staff account. Please use the staff sign-in page.'
            : 'This is a patient account. Please use the patient sign-in page.',
          { code_hint: 'wrong_portal' },
        );
      }
      if (user && valid && !user.is_active) throw new UnauthorizedError('This account has been deactivated.');
      throw new UnauthorizedError('Incorrect email or password.');
    }
    const fresh = await startSession(req, reply, user);
    return me(fresh);
  });

  app.post('/logout', async (req, reply) => {
    if (req.auth) {
      await logActivity(db, req.actor, { action: 'logout', entity: 'user', entity_id: req.auth.id });
    }
    clearSession(reply);
    return { ok: true };
  });

  app.get('/me', async (req) => me(currentUser(req)));

  // ---- Passwords ----
  app.post('/forgot-password', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (req) => {
    const body = parse(z.object({ email }), req.body);
    const [user] = await db.select().from(users).where(eq(users.email, body.email));
    if (user?.is_active) {
      const token = crypto.randomBytes(32).toString('base64url');
      await db.insert(password_resets).values({
        user_id: user.id,
        token_hash: sha256(token),
        expires_at: addMinutes(now(), RESET_TTL_MINUTES),
      });
      await logActivity(db, req.actor, { action: 'password_reset_requested', entity: 'user', entity_id: user.id });
      await sendAccountEmail(
        { email: user.email, name: user.full_name },
        templates.passwordReset(user.full_name, `${env.WEB_ORIGIN}/reset-password?token=${token}`),
      );
    }
    return { ok: true, message: 'If an account exists for that email, a reset link is on its way.' };
  });

  app.post('/reset-password', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req) => {
    const body = parse(z.object({ token: z.string().min(10), password }), req.body);
    const [reset] = await db
      .select()
      .from(password_resets)
      .where(
        and(
          eq(password_resets.token_hash, sha256(body.token)),
          isNull(password_resets.used_at),
          gt(password_resets.expires_at, now()),
        ),
      );
    if (!reset) throw new ValidationError('This reset link is invalid or has expired. Request a new one.');
    const hash = await hashPassword(body.password);
    await db.transaction(async (tx) => {
      await tx.update(users).set({ password_hash: hash }).where(eq(users.id, reset.user_id));
      // Invalidate every outstanding link for this user, not just this one.
      await tx
        .update(password_resets)
        .set({ used_at: now() })
        .where(and(eq(password_resets.user_id, reset.user_id), isNull(password_resets.used_at)));
      await logActivity(tx, { ...req.actor, user_id: reset.user_id }, {
        action: 'password_reset',
        entity: 'user',
        entity_id: reset.user_id,
      });
    });
    return { ok: true };
  });

  app.post('/change-password', async (req) => {
    const user = currentUser(req);
    const body = parse(z.object({ current_password: z.string().optional(), new_password: password }), req.body);
    if (user.password_hash && !(await verifyPassword(user.password_hash, body.current_password ?? ''))) {
      throw new ValidationError('Your current password is incorrect.', { field: 'current_password' });
    }
    await db.update(users).set({ password_hash: await hashPassword(body.new_password) }).where(eq(users.id, user.id));
    await logActivity(db, req.actor, { action: 'password_changed', entity: 'user', entity_id: user.id });
    return { ok: true };
  });

  // ---- Google (patients only) ----
  const googleRedirect = `${env.WEB_ORIGIN}/api/auth/google/callback`;
  const googleConfigured = () => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  const backToLogin = (reply: FastifyReply, error: string) =>
    reply.redirect(`${env.WEB_ORIGIN}/login?error=${encodeURIComponent(error)}`);

  app.get('/google/enabled', async () => ({ enabled: googleConfigured() }));

  app.get('/google/start', async (_req, reply) => {
    if (!googleConfigured()) return backToLogin(reply, 'Google sign-in is not configured.');
    const state = crypto.randomBytes(16).toString('base64url');
    reply.setCookie('g_state', state, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/auth/google',
      maxAge: 600,
    });
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!,
      redirect_uri: googleRedirect,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    });
    return reply.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  app.get('/google/callback', async (req, reply) => {
    const q = req.query as { code?: string; state?: string; error?: string };
    const expected = req.cookies.g_state;
    reply.clearCookie('g_state', { path: '/api/auth/google' });
    if (q.error) return backToLogin(reply, 'Google sign-in was cancelled.');
    if (!q.code || !q.state || !expected || q.state !== expected) {
      return backToLogin(reply, 'Google sign-in failed. Please try again.');
    }

    let profile: { sub: string; email: string; email_verified: boolean; given_name?: string; family_name?: string; name?: string };
    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: q.code,
          client_id: env.GOOGLE_CLIENT_ID!,
          client_secret: env.GOOGLE_CLIENT_SECRET!,
          redirect_uri: googleRedirect,
          grant_type: 'authorization_code',
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!tokenRes.ok) throw new Error(`token ${tokenRes.status}`);
      const { access_token } = (await tokenRes.json()) as { access_token: string };
      const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { authorization: `Bearer ${access_token}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!infoRes.ok) throw new Error(`userinfo ${infoRes.status}`);
      profile = (await infoRes.json()) as typeof profile;
    } catch (err) {
      req.log.error(err, 'google oauth failed');
      return backToLogin(reply, 'Google sign-in failed. Please try again.');
    }
    if (!profile.email_verified) return backToLogin(reply, 'Your Google email address is not verified.');

    const addr = profile.email.toLowerCase();
    let [user] = await db.select().from(users).where(eq(users.google_id, profile.sub));
    if (!user) {
      const [byEmail] = await db.select().from(users).where(eq(users.email, addr));
      if (byEmail && byEmail.role !== 'patient') {
        return backToLogin(reply, 'This email belongs to a staff account. Use the staff sign-in page.');
      }
      if (byEmail) {
        // Google has verified ownership of the address, so linking is safe.
        [user] = await db.update(users).set({ google_id: profile.sub }).where(eq(users.id, byEmail.id)).returning();
      } else {
        const first = profile.given_name ?? profile.name?.split(' ')[0] ?? 'Patient';
        const last = profile.family_name ?? profile.name?.split(' ').slice(1).join(' ') ?? '';
        user = await db.transaction(async (tx) => {
          const [u] = await tx
            .insert(users)
            .values({ email: addr, google_id: profile.sub, role: 'patient', full_name: `${first} ${last}`.trim() })
            .returning();
          // Phone is unknown from Google; the portal asks for it before booking.
          const [p] = await tx
            .insert(patients)
            .values({ first_name: first, last_name: last || '-', phone: '', email: addr, user_id: u!.id })
            .returning();
          await logActivity(tx, { ...req.actor, user_id: u!.id, role: 'patient' }, {
            action: 'register',
            entity: 'patient',
            entity_id: p!.id,
            after: { email: addr, via: 'google' },
          });
          await notifyEmployees(tx, {
            type: 'new_patient',
            title: `New patient registered: ${first} ${last}`.trim(),
            detail: `${addr} · via Google`,
          });
          return u!;
        });
      }
    }
    if (!user!.is_active) return backToLogin(reply, 'This account has been deactivated.');
    await startSession(req, reply, user!, 'login_google');
    return reply.redirect(`${env.WEB_ORIGIN}/portal`);
  });
};
