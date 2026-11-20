import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { MONDAY, TUESDAY, basics, book, call, makeStaff, ok, setupTestApp } from './helpers.js';

const ctx = setupTestApp();
const history = (id: number) => ok(ctx, 'GET', `/api/appointments/${id}/history`);

describe('appointment history (activity log)', () => {
  it('records the booking', async () => {
    const ids = await basics(ctx);
    const a = (await book(ctx, ids, `${MONDAY}T09:00`)).body;
    const [entry] = await history(a.id);
    expect(entry).toMatchObject({
      action: 'created',
      to_status: 'scheduled',
      to_starts_at: `${MONDAY}T09:00:00+08:00`,
      to_staff_id: ids.staff.id,
    });
    expect(entry.changed_at).toMatch(/\+08:00$/);
  });

  it('records status changes with notes', async () => {
    const ids = await basics(ctx);
    const a = (await book(ctx, ids, `${MONDAY}T09:00`)).body;
    await ok(ctx, 'PATCH', `/api/appointments/${a.id}/status`, { status: 'cancelled', note: 'Patient called' });
    const entries = await history(a.id);
    expect(entries[1]).toMatchObject({
      action: 'status_changed',
      from_status: 'scheduled',
      to_status: 'cancelled',
      note: 'Patient called',
    });
  });

  it('records reschedules with both times and the staff move', async () => {
    const ids = await basics(ctx);
    const a = (await book(ctx, ids, `${MONDAY}T09:00`)).body;
    const other = await makeStaff(ctx, 'Dr. Santos');
    await ok(ctx, 'PATCH', `/api/appointments/${a.id}/reschedule`, { starts_at: `${TUESDAY}T10:00`, staff_id: other.id });
    const entries = await history(a.id);
    expect(entries[1]).toMatchObject({
      action: 'rescheduled',
      from_starts_at: `${MONDAY}T09:00:00+08:00`,
      to_starts_at: `${TUESDAY}T10:00:00+08:00`,
      from_staff_id: ids.staff.id,
      to_staff_id: other.id,
    });
  });

  it('reconstructs a full lifecycle, oldest first', async () => {
    const ids = await basics(ctx);
    const a = (await book(ctx, ids, `${MONDAY}T09:00`)).body;
    await ok(ctx, 'PATCH', `/api/appointments/${a.id}/status`, { status: 'confirmed' });
    await ok(ctx, 'PATCH', `/api/appointments/${a.id}/reschedule`, { starts_at: `${MONDAY}T10:00` });
    await ok(ctx, 'PATCH', `/api/appointments/${a.id}/status`, { status: 'completed' });
    expect((await history(a.id)).map((e: any) => e.action)).toEqual([
      'created',
      'status_changed',
      'rescheduled',
      'status_changed',
    ]);
  });

  it('rejected changes leave no trace', async () => {
    const ids = await basics(ctx);
    const a = (await book(ctx, ids, `${MONDAY}T09:00`)).body;
    await book(ctx, ids, `${MONDAY}T10:00`);
    await call(ctx, 'PATCH', `/api/appointments/${a.id}/reschedule`, { starts_at: `${MONDAY}T10:00` });
    await call(ctx, 'PATCH', `/api/appointments/${a.id}/status`, { status: 'scheduled' });
    expect(await history(a.id)).toHaveLength(1);
    // A refused booking writes nothing either.
    expect((await book(ctx, ids, `${MONDAY}T09:00`)).status).toBe(409);
    const res: any = await ctx.db.execute(
      sql`select count(*)::int as n from activity_log where entity = 'appointment'`,
    );
    expect((res.rows ?? res)[0].n).toBe(2);
  });

  it('history of an unknown appointment is 404', async () => {
    expect((await call(ctx, 'GET', '/api/appointments/999/history')).status).toBe(404);
  });

  it('logs creates and edits of other records too', async () => {
    const ids = await basics(ctx);
    await ok(ctx, 'PATCH', `/api/patients/${ids.patient.id}`, { phone: '0918-000-0000' });
    const res: any = await ctx.db.execute(
      sql`select action, entity, before, after from activity_log where entity = 'patient' order by id`,
    );
    const rows = res.rows ?? res;
    expect(rows.map((r: any) => r.action)).toEqual(['create', 'update']);
    expect(rows[1].before).toEqual({ phone: '0917-555-0101' });
    expect(rows[1].after).toEqual({ phone: '0918-000-0000' });
  });
});
