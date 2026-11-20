import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { isOverlapViolation } from '../src/lib/errors.js';
import { MONDAY, basics, book, call, makePatient, makeService, makeStaff, ok, setupTestApp } from './helpers.js';

const ctx = setupTestApp();

describe('booking and conflicts', () => {
  it('books an appointment with the end derived from the service', async () => {
    const ids = await basics(ctx);
    const res = await book(ctx, ids, `${MONDAY}T09:00`);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('scheduled');
    expect(res.body.starts_at).toBe(`${MONDAY}T09:00:00+08:00`);
    expect(res.body.ends_at).toBe(`${MONDAY}T09:30:00+08:00`);
    expect(res.body.duration_minutes).toBe(30);
    expect(res.body.patient.full_name).toBe('Ana Cruz');
    expect(res.body.booked_via).toBe('employee');
  });

  it.each([
    ['exact double booking', '09:00'],
    ['partial overlap', '09:15'],
    ['overlap from the other side', '08:45'],
  ])('refuses %s', async (_label, time) => {
    const ids = await basics(ctx);
    expect((await book(ctx, ids, `${MONDAY}T09:00`)).status).toBe(201);
    const res = await book(ctx, ids, `${MONDAY}T${time}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('slot_conflict');
  });

  it('refuses an enclosing appointment', async () => {
    const ids = await basics(ctx);
    await book(ctx, ids, `${MONDAY}T09:15`);
    const long = await makeService(ctx, 'Procedure', 60);
    expect((await book(ctx, { ...ids, service: long }, `${MONDAY}T09:00`)).status).toBe(409);
  });

  it('allows back-to-back', async () => {
    const ids = await basics(ctx);
    await book(ctx, ids, `${MONDAY}T09:00`);
    expect((await book(ctx, ids, `${MONDAY}T09:30`)).status).toBe(201);
    expect((await book(ctx, ids, `${MONDAY}T08:30`)).status).toBe(201);
  });

  it('allows the same time with a different staff member', async () => {
    const ids = await basics(ctx);
    await book(ctx, ids, `${MONDAY}T09:00`);
    const other = await makeStaff(ctx, 'Dr. Santos');
    expect((await book(ctx, { ...ids, staff: other }, `${MONDAY}T09:00`)).status).toBe(201);
  });

  it.each(['cancelled', 'no_show'])('lets a %s slot be rebooked', async (status) => {
    const ids = await basics(ctx);
    const first = (await book(ctx, ids, `${MONDAY}T09:00`)).body;
    await ok(ctx, 'PATCH', `/api/appointments/${first.id}/status`, { status });
    expect((await book(ctx, ids, `${MONDAY}T09:00`)).status).toBe(201);
  });

  it('keeps a completed slot blocked', async () => {
    const ids = await basics(ctx);
    const first = (await book(ctx, ids, `${MONDAY}T09:00`)).body;
    await ok(ctx, 'PATCH', `/api/appointments/${first.id}/status`, { status: 'completed' });
    expect((await book(ctx, ids, `${MONDAY}T09:00`)).status).toBe(409);
  });

  it('names the clash in the conflict response', async () => {
    const ids = await basics(ctx);
    const first = (await book(ctx, ids, `${MONDAY}T09:00`)).body;
    const res = await book(ctx, ids, `${MONDAY}T09:10`);
    expect(res.body.message).toBe('Dr. Ilagan is already booked from 09:00 to 09:30 on 23 Nov 2026.');
    expect(res.body.conflicting_appointment_ids).toEqual([first.id]);
    expect(res.body.conflicting_appointments[0].patient_name).toBe('Ana Cruz');
  });

  it('rejects an unknown patient with 404', async () => {
    const ids = await basics(ctx);
    const res = await book(ctx, { ...ids, patient: { id: 999 } }, `${MONDAY}T09:00`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it('the database itself refuses an overlap that skips the API check', async () => {
    const ids = await basics(ctx);
    await book(ctx, ids, `${MONDAY}T09:00`);
    const err = await ctx.db
      .execute(sql`
        INSERT INTO appointments (patient_id, staff_id, service_id, starts_at, ends_at, status)
        VALUES (${ids.patient.id}, ${ids.staff.id}, ${ids.service.id},
                '2026-11-23T09:10:00+08:00', '2026-11-23T09:40:00+08:00', 'pending')`)
      .then(() => null, (e: unknown) => e);
    expect(isOverlapViolation(err)).toBe(true);
  });
});

describe('booking horizon', () => {
  it('rejects a booking in the past', async () => {
    const ids = await basics(ctx);
    const res = await book(ctx, ids, '2026-11-19T09:00');
    expect(res.status).toBe(422);
    expect(res.body.message).toBe('Appointments cannot be booked in the past.');
  });

  it('rejects earlier today', async () => {
    const ids = await basics(ctx);
    expect((await book(ctx, ids, '2026-11-20T09:00')).status).toBe(422);
  });

  it('allows a slot that began within the grace window', async () => {
    const ids = await basics(ctx);
    expect((await book(ctx, ids, '2026-11-20T09:50')).status).toBe(201);
  });

  it('rejects rescheduling into the past', async () => {
    const ids = await basics(ctx);
    const a = (await book(ctx, ids, `${MONDAY}T09:00`)).body;
    const res = await call(ctx, 'PATCH', `/api/appointments/${a.id}/reschedule`, { starts_at: '2026-11-19T09:00' });
    expect(res.status).toBe(422);
  });

  it('rejects more than a year ahead', async () => {
    const ids = await basics(ctx);
    expect((await book(ctx, ids, '2028-01-10T09:00')).status).toBe(422);
  });
});

describe('deactivation', () => {
  it('refuses deactivated staff and services', async () => {
    const ids = await basics(ctx);
    await ok(ctx, 'PATCH', `/api/staff/${ids.staff.id}`, { is_active: false });
    expect((await book(ctx, ids, `${MONDAY}T09:00`)).body.message).toMatch(/deactivated/);

    const staff2 = await makeStaff(ctx, 'Dr. Reyes');
    const svc = await makeService(ctx, 'Old Service', 30, { is_active: false });
    const res = await book(ctx, { ...ids, staff: staff2, service: svc }, `${MONDAY}T09:00`);
    expect(res.status).toBe(422);
    expect(res.body.message).toBe('Old Service is deactivated and cannot be booked.');
  });

  it('preserves existing appointments, which can still move', async () => {
    const ids = await basics(ctx);
    const a = (await book(ctx, ids, `${MONDAY}T09:00`)).body;
    await ok(ctx, 'PATCH', `/api/staff/${ids.staff.id}`, { is_active: false });
    expect((await ok(ctx, 'GET', `/api/appointments/${a.id}`)).staff.is_active).toBe(false);
    const moved = await call(ctx, 'PATCH', `/api/appointments/${a.id}/reschedule`, { starts_at: `${MONDAY}T10:00` });
    expect(moved.status).toBe(200);
  });

  it('cannot reschedule onto deactivated staff', async () => {
    const ids = await basics(ctx);
    const a = (await book(ctx, ids, `${MONDAY}T09:00`)).body;
    const gone = await makeStaff(ctx, 'Dr. Gone', { is_active: false });
    const res = await call(ctx, 'PATCH', `/api/appointments/${a.id}/reschedule`, {
      starts_at: `${MONDAY}T09:00`,
      staff_id: gone.id,
    });
    expect(res.status).toBe(422);
  });

  it('lists only active staff unless asked', async () => {
    await makeStaff(ctx, 'Active');
    await makeStaff(ctx, 'Inactive', { is_active: false });
    expect((await ok(ctx, 'GET', '/api/staff')).map((s: any) => s.full_name)).toEqual(['Active']);
    expect(await ok(ctx, 'GET', '/api/staff?include_inactive=true')).toHaveLength(2);
  });

  it('rejects a duplicate service name', async () => {
    await makeService(ctx, 'Consultation');
    const res = await call(ctx, 'POST', '/api/services', { name: 'Consultation', duration_minutes: 15 });
    expect(res.status).toBe(422);
  });

  it('validates patient input', async () => {
    const res = await call(ctx, 'POST', '/api/patients', { first_name: '', last_name: 'X', phone: '1' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('validation_error');
    expect(await makePatient(ctx)).toMatchObject({ full_name: 'Ana Cruz' });
  });
});
