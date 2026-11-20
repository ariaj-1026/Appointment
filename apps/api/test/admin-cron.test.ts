import { describe, expect, it } from 'vitest';
import { MONDAY, PASSWORD, basics, book, call, makePortalPatient, ok, setupTestApp } from './helpers.js';
import { setNow } from '../src/lib/time.js';
import { env } from '../src/env.js';

const ctx = setupTestApp();

describe('admin: accounts', () => {
  it('creates an employee login linked to a staff member', async () => {
    const { staff } = await basics(ctx);
    const u = await ok(ctx, 'POST', '/api/admin/users', {
      email: 'Nurse@Clinic.test', full_name: 'Nurse Joy', role: 'employee', password: 'Temp1234', staff_id: staff.id,
    }, 'admin');
    expect(u).toMatchObject({ email: 'nurse@clinic.test', role: 'employee', staff: { id: staff.id } });
    const login = await call(ctx, 'POST', '/api/auth/login', { email: 'nurse@clinic.test', password: 'Temp1234', portal: 'staff' }, null);
    expect(login.body.staff.id).toBe(staff.id);
  });

  it('cannot create patients this way, or demote/deactivate itself, or remove the last admin', async () => {
    expect((await call(ctx, 'POST', '/api/admin/users', { email: 'p@x.com', full_name: 'P', role: 'patient', password: 'Temp1234' }, 'admin')).status).toBe(422);
    expect((await call(ctx, 'PATCH', `/api/admin/users/${ctx.ids.admin}`, { is_active: false }, 'admin')).status).toBe(422);
    expect((await call(ctx, 'DELETE', `/api/admin/users/${ctx.ids.admin}`, undefined, 'admin')).status).toBe(422);
  });

  it('deleting a patient login keeps their clinical record as a walk-in', async () => {
    const p = await makePortalPatient(ctx);
    await ok(ctx, 'DELETE', `/api/admin/users/${p.user.id}`, undefined, 'admin');
    const record = await ok(ctx, 'GET', `/api/patients/${p.patient.id}`, undefined, 'admin');
    expect(record.user_id).toBeNull();
  });

  it('admin can set a password', async () => {
    await ok(ctx, 'POST', `/api/admin/users/${ctx.ids.employee}/password`, { password: 'Reset999' }, 'admin');
    expect((await call(ctx, 'POST', '/api/auth/login', { email: 'employee@test.local', password: PASSWORD, portal: 'staff' }, null)).status).toBe(401);
  });
});

describe('admin: deletion and activity log', () => {
  it('hard-deletes an appointment with a reason; the snapshot survives in the log', async () => {
    const ids = await basics(ctx);
    const a = (await book(ctx, ids, `${MONDAY}T09:00`)).body;
    expect((await call(ctx, 'DELETE', `/api/admin/appointments/${a.id}`, {}, 'admin')).status).toBe(422);
    await ok(ctx, 'DELETE', `/api/admin/appointments/${a.id}`, { reason: 'Duplicate entry' }, 'admin');
    expect((await call(ctx, 'GET', `/api/appointments/${a.id}`)).status).toBe(404);

    const log = await ok(ctx, 'GET', `/api/admin/activity?action=delete&entity=appointment`, undefined, 'admin');
    expect(log.items[0]).toMatchObject({
      entity_id: a.id,
      note: 'Duplicate entry',
      user_email: 'admin@test.local',
      actor_role: 'admin',
    });
    expect(log.items[0].before).toMatchObject({ patient_name: 'Ana Cruz', staff_name: 'Dr. Ilagan' });
  });

  it('deleting a patient cascades to their appointments', async () => {
    const ids = await basics(ctx);
    await book(ctx, ids, `${MONDAY}T09:00`);
    const r = await ok(ctx, 'DELETE', `/api/admin/patients/${ids.patient.id}`, { reason: 'Requested erasure' }, 'admin');
    expect(r.deleted_appointments).toBe(1);
  });

  it('employees cannot delete', async () => {
    const ids = await basics(ctx);
    const a = (await book(ctx, ids, `${MONDAY}T09:00`)).body;
    expect((await call(ctx, 'DELETE', `/api/admin/appointments/${a.id}`, { reason: 'x' })).status).toBe(403);
    expect((await call(ctx, 'DELETE', `/api/appointments/${a.id}`, { reason: 'x' })).status).toBe(404);
  });

  it('filters the log by user and text, with totals for paging', async () => {
    await basics(ctx);
    const byEmployee = await ok(ctx, 'GET', `/api/admin/activity?user_id=${ctx.ids.employee}&limit=2`, undefined, 'admin');
    expect(byEmployee.total).toBe(3); // staff, service, patient created
    expect(byEmployee.items).toHaveLength(2);
    const search = await ok(ctx, 'GET', '/api/admin/activity?q=employee@test', undefined, 'admin');
    expect(search.total).toBe(3);
  });
});

describe('admin: time zone', () => {
  it('validates and applies the clinic time zone everywhere', async () => {
    expect((await call(ctx, 'PUT', '/api/admin/settings', { timezone: 'Mars/Olympus' }, 'admin')).status).toBe(422);
    const ids = await basics(ctx);
    const a = (await book(ctx, ids, `${MONDAY}T09:00`)).body; // 09:00 Manila
    await ok(ctx, 'PUT', '/api/admin/settings', { timezone: 'Asia/Tokyo' }, 'admin');
    expect((await ok(ctx, 'GET', `/api/appointments/${a.id}`)).starts_at).toBe(`${MONDAY}T10:00:00+09:00`);
    expect((await ok(ctx, 'GET', '/api/settings')).timezone).toBe('Asia/Tokyo');
    expect((await call(ctx, 'PUT', '/api/admin/settings', { timezone: 'UTC' })).status).toBe(403);
  });
});

describe('cron reminders', () => {
  const cron = (secret?: string) =>
    ctx.app.inject({ method: 'POST', url: '/api/cron/reminders', headers: secret ? { authorization: `Bearer ${secret}` } : {} });

  it('needs the secret', async () => {
    (env as { CRON_SECRET?: string }).CRON_SECRET = 'cron-secret-123';
    expect((await cron()).statusCode).toBe(401);
    expect((await cron('wrong')).statusCode).toBe(401);
  });

  it('sends 24h reminders for 2–24h out and 2h reminders inside 2h, once each', async () => {
    (env as { CRON_SECRET?: string }).CRON_SECRET = 'cron-secret-123';
    const ids = await basics(ctx);
    await book(ctx, ids, '2026-11-20T11:00'); // 1h away
    await book(ctx, ids, '2026-11-21T09:00'); // 23h away
    const first = (await cron('cron-secret-123')).json();
    expect(first.reminder_24h.sent).toBe(1);
    expect(first.reminder_2h.sent).toBe(1);
    const again = (await cron('cron-secret-123')).json();
    expect(again.reminder_24h.considered + again.reminder_2h.considered).toBe(0);

    setNow(new Date('2026-11-21T07:30:00+08:00')); // tomorrow's visit now 1.5h away
    expect((await cron('cron-secret-123')).json().reminder_2h.sent).toBe(1);
  });
});
