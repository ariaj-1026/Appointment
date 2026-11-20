import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { PASSWORD, call, makePortalPatient, ok, outbox, setupTestApp } from './helpers.js';

const ctx = setupTestApp();
const cookieFrom = (headers: Record<string, unknown>) =>
  String(headers['set-cookie']).split(';')[0]!;
const register = (overrides: object = {}) =>
  call(ctx, 'POST', '/api/auth/register', {
    email: 'New.Patient@Example.com',
    password: 'Passw0rd!',
    first_name: 'Nina',
    last_name: 'Santos',
    phone: '0917-000-1111',
    ...overrides,
  }, null);
const login = (email: string, portal: 'patient' | 'staff', password = PASSWORD) =>
  call(ctx, 'POST', '/api/auth/login', { email, password, portal }, null);
const actions = async () => {
  const res: any = await ctx.db.execute(sql`select action, note from activity_log order by id`);
  return (res.rows ?? res) as { action: string; note: string | null }[];
};

describe('patient registration', () => {
  it('creates a patient account + record, signs in, and tells employees', async () => {
    const res = await register();
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'new.patient@example.com', role: 'patient' });
    expect(res.body.patient).toMatchObject({ full_name: 'Nina Santos', phone: '0917-000-1111' });
    expect(res.body.user.password_hash).toBeUndefined();

    const me = await call(ctx, 'GET', '/api/auth/me', undefined, { cookie: cookieFrom(res.headers) });
    expect(me.body.user.email).toBe('new.patient@example.com');

    const inbox = await ok(ctx, 'GET', '/api/notifications');
    expect(inbox.items[0]).toMatchObject({ type: 'new_patient', title: 'New patient registered: Nina Santos' });
    expect(inbox.unread).toBe(1);
  });

  it('rejects a duplicate email and a weak password', async () => {
    await register();
    expect((await register()).body.message).toMatch(/already exists/);
    const weak = await register({ email: 'x@example.com', password: 'short' });
    expect(weak.status).toBe(422);
  });

  it('never links to an existing walk-in record with the same email', async () => {
    await ok(ctx, 'POST', '/api/patients', { first_name: 'Nina', last_name: 'Walkin', phone: '123', email: 'new.patient@example.com' });
    const res = await register();
    expect(res.body.patient.last_name).toBe('Santos');
  });
});

describe('login', () => {
  it('signs in on the right page and logs it', async () => {
    const res = await login('employee@test.local', 'staff');
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toMatch(/session=.*HttpOnly/i);
    expect(res.body.user.role).toBe('employee');
    expect((await actions()).at(-1)!.action).toBe('login');
  });

  it('admins sign in on the staff page too', async () => {
    expect((await login('admin@test.local', 'staff')).status).toBe(200);
  });

  it('refuses the wrong page with a helpful message', async () => {
    const p = await makePortalPatient(ctx);
    const staffPage = await login(p.user.email, 'staff');
    expect(staffPage.status).toBe(401);
    expect(staffPage.body.message).toBe('This is a patient account. Please use the patient sign-in page.');
    const patientPage = await login('employee@test.local', 'patient');
    expect(patientPage.body.message).toMatch(/staff sign-in page/);
  });

  it('a wrong password is a generic 401 and is logged as a failure', async () => {
    const res = await login('employee@test.local', 'staff', 'nope');
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Incorrect email or password.');
    expect((await login('nobody@test.local', 'staff')).body.message).toBe('Incorrect email or password.');
    const failures = (await actions()).filter((a) => a.action === 'login_failed');
    expect(failures.map((f) => f.note)).toEqual(['employee@test.local (staff portal)', 'nobody@test.local (staff portal)']);
  });

  it('a deactivated account cannot sign in, and its existing session stops working', async () => {
    await ok(ctx, 'PATCH', `/api/admin/users/${ctx.ids.employee}`, { is_active: false }, 'admin');
    expect((await login('employee@test.local', 'staff')).body.message).toBe('This account has been deactivated.');
    expect((await call(ctx, 'GET', '/api/patients')).status).toBe(401);
  });

  it('logout clears the cookie and is logged', async () => {
    const res = await call(ctx, 'POST', '/api/auth/logout');
    expect(res.headers['set-cookie']).toMatch(/session=;/);
    expect((await actions()).at(-1)!.action).toBe('logout');
  });

  it('a tampered token is treated as signed out', async () => {
    expect((await call(ctx, 'GET', '/api/auth/me', undefined, { cookie: 'session=abc.def.ghi' })).status).toBe(401);
  });
});

describe('password reset', () => {
  async function requestReset(email = 'employee@test.local') {
    outbox.length = 0;
    const res = await call(ctx, 'POST', '/api/auth/forgot-password', { email }, null);
    expect(res.status).toBe(200);
    return outbox.at(-1);
  }

  it('emails a one-time link that sets a new password', async () => {
    const mail = await requestReset();
    expect(mail?.subject).toBe('Reset your password');
    const token = /token=([\w-]+)/.exec(mail!.html)![1]!;

    expect((await call(ctx, 'POST', '/api/auth/reset-password', { token, password: 'Brand9new' }, null)).status).toBe(200);
    expect((await login('employee@test.local', 'staff', 'Brand9new')).status).toBe(200);
    // Single use.
    expect((await call(ctx, 'POST', '/api/auth/reset-password', { token, password: 'Again9new' }, null)).status).toBe(422);
  });

  it('does not reveal whether an account exists', async () => {
    expect(await requestReset('nobody@test.local')).toBeUndefined();
  });

  it('change-password requires the current password', async () => {
    const bad = await call(ctx, 'POST', '/api/auth/change-password', { current_password: 'wrong', new_password: 'Newpass99' });
    expect(bad.status).toBe(422);
    await ok(ctx, 'POST', '/api/auth/change-password', { current_password: PASSWORD, new_password: 'Newpass99' });
    expect((await login('employee@test.local', 'staff', 'Newpass99')).status).toBe(200);
  });
});

describe('role guards', () => {
  it('anonymous requests are refused', async () => {
    expect((await call(ctx, 'GET', '/api/appointments', undefined, null)).status).toBe(401);
    expect((await call(ctx, 'GET', '/api/health', undefined, null)).status).toBe(200);
  });

  it('patients cannot reach employee or admin APIs', async () => {
    const p = await makePortalPatient(ctx);
    for (const url of ['/api/patients', '/api/appointments', '/api/reports/utilisation', '/api/admin/users']) {
      expect((await call(ctx, 'GET', url, undefined, p.as)).status).toBe(403);
    }
  });

  it('employees cannot reach the admin console or the portal', async () => {
    expect((await call(ctx, 'GET', '/api/admin/activity')).status).toBe(403);
    expect((await call(ctx, 'GET', '/api/portal/appointments')).status).toBe(403);
  });

  it('admins can read records but not edit services, staff or hours', async () => {
    expect((await call(ctx, 'GET', '/api/patients', undefined, 'admin')).status).toBe(200);
    expect((await call(ctx, 'GET', '/api/staff', undefined, 'admin')).status).toBe(200);
    expect((await call(ctx, 'POST', '/api/services', { name: 'X', duration_minutes: 10 }, 'admin')).status).toBe(403);
    expect((await call(ctx, 'POST', '/api/staff', { full_name: 'X', role: 'Y' }, 'admin')).status).toBe(403);
    expect((await call(ctx, 'GET', '/api/reports/utilisation', undefined, 'admin')).status).toBe(403);
  });
});
