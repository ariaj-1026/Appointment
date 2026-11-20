/**
 * Sessions: a signed JWT in an httpOnly cookie. The token carries only the
 * user id; the user row is loaded on every request, so deactivating an
 * account or changing a role takes effect immediately rather than at expiry.
 *
 * The browser only ever talks to the Vercel origin (which rewrites /api/* to
 * Render), so the cookie is first-party and SameSite=Lax is enough to stop
 * cross-site form posts from carrying it.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import fjwt from '@fastify/jwt';
import { eq } from 'drizzle-orm';
import type { Role } from '@clinic/shared';
import type { DB } from '../db/client.js';
import { users, type User } from '../db/schema.js';
import { env } from '../env.js';
import { DomainError } from './errors.js';

export const SESSION_COOKIE = 'session';
const SESSION_DAYS = 7;

export class UnauthorizedError extends DomainError {
  override readonly statusCode = 401;
  override readonly code = 'unauthorized';
}

export class ForbiddenError extends DomainError {
  override readonly statusCode = 403;
  override readonly code = 'forbidden';
}

declare module 'fastify' {
  interface FastifyRequest {
    /** The signed-in, active user, or null. */
    auth: User | null;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: number };
  }
}

export function jwtSecret(): string {
  if (env.JWT_SECRET) return env.JWT_SECRET;
  if (env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be set in production.');
  return 'dev-only-insecure-secret-change-me-0123456789';
}

export async function registerAuth(app: FastifyInstance, db: DB) {
  await app.register(fjwt, { secret: jwtSecret(), sign: { expiresIn: `${SESSION_DAYS}d` } });

  app.decorateRequest('auth', null);
  app.addHook('onRequest', async (req) => {
    req.auth = null;
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    let sub: number;
    try {
      sub = app.jwt.verify<{ sub: number }>(token).sub;
    } catch {
      return; // expired or tampered: treat as signed out
    }
    const [user] = await db.select().from(users).where(eq(users.id, sub));
    if (user?.is_active) {
      req.auth = user;
      req.actor = { ...req.actor, user_id: user.id, role: user.role };
    }
  });
}

/** Short session when "Remember me" is off: cookie dies with the browser, token after 12h. */
const SHORT_SESSION_HOURS = 12;

export function setSession(app: FastifyInstance, reply: FastifyReply, user: User, { remember = true } = {}) {
  const token = remember
    ? app.jwt.sign({ sub: user.id })
    : app.jwt.sign({ sub: user.id }, { expiresIn: `${SHORT_SESSION_HOURS}h` });
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    // No maxAge = browser-session cookie, cleared when the browser closes.
    ...(remember ? { maxAge: SESSION_DAYS * 24 * 60 * 60 } : {}),
  });
}

export function clearSession(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** preHandler: signed in with one of these roles. */
export function requireRole(...roles: Role[]): preHandlerAsyncHookHandler {
  return async (req: FastifyRequest) => {
    if (!req.auth) throw new UnauthorizedError('Please sign in.');
    if (!roles.includes(req.auth.role)) {
      throw new ForbiddenError('You do not have access to this.');
    }
  };
}

/** Writes are employee-only; reads are open to admins too (they delete records). */
export function employeeWritesAdminReads(): preHandlerAsyncHookHandler {
  const read = requireRole('employee', 'admin');
  const write = requireRole('employee');
  return async function (this: unknown, req, reply) {
    const fn = req.method === 'GET' ? read : write;
    return fn.call(this as never, req, reply);
  };
}

export function currentUser(req: FastifyRequest): User {
  if (!req.auth) throw new UnauthorizedError('Please sign in.');
  return req.auth;
}

/** The public shape of a user. */
export function publicUser(u: User) {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    full_name: u.full_name,
    is_active: u.is_active,
    has_password: u.password_hash !== null,
    has_google: u.google_id !== null,
    created_at: u.created_at,
    last_login_at: u.last_login_at,
  };
}
