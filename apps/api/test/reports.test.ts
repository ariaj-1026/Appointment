import { describe, expect, it } from 'vitest';
import {
  MONDAY,
  MON_FRI_9_TO_5_WITH_LUNCH,
  TUESDAY,
  basics,
  book,
  call,
  makeService,
  makeStaff,
  ok,
  setupTestApp,
} from './helpers.js';

const ctx = setupTestApp();
const setStatus = (id: number, status: string) =>
  ok(ctx, 'PATCH', `/api/appointments/${id}/status`, { status });

describe('daily summary', () => {
  it('counts by status and excludes released slots from booked minutes', async () => {
    const ids = await basics(ctx);
    const a = (await book(ctx, ids, `${MONDAY}T09:00`)).body;
    const b = (await book(ctx, ids, `${MONDAY}T10:00`)).body;
    const c = (await book(ctx, ids, `${MONDAY}T11:00`)).body;
    await setStatus(a.id, 'completed');
    await setStatus(b.id, 'cancelled');
    await setStatus(c.id, 'no_show');
    await book(ctx, ids, `${MONDAY}T14:00`);

    const r = await ok(ctx, 'GET', `/api/reports/daily-summary?date=${MONDAY}`);
    const row = r.staff[0];
    expect(row.total).toBe(4);
    expect(row.counts).toMatchObject({ completed: 1, cancelled: 1, no_show: 1, scheduled: 1 });
    expect(row.booked_minutes).toBe(60); // completed + scheduled
    expect(row.first_start).toBe(`${MONDAY}T09:00:00+08:00`);
    expect(row.last_end).toBe(`${MONDAY}T14:30:00+08:00`);
  });

  it('utilisation uses configured hours, null without them, and flags partial capacity', async () => {
    const ids = await basics(ctx);
    await ok(ctx, 'PUT', `/api/staff/${ids.staff.id}/business-hours`, MON_FRI_9_TO_5_WITH_LUNCH);
    await makeStaff(ctx, 'Dr. Unconfigured');
    await book(ctx, ids, `${MONDAY}T09:00`);

    const r = await ok(ctx, 'GET', `/api/reports/daily-summary?date=${MONDAY}`);
    const configured = r.staff.find((s: any) => s.staff_id === ids.staff.id);
    const unconfigured = r.staff.find((s: any) => s.staff_id !== ids.staff.id);
    expect(configured.available_minutes).toBe(420);
    expect(configured.utilisation_pct).toBe(7.1);
    expect(configured.free_minutes).toBe(390);
    expect(unconfigured.utilisation_pct).toBeNull();
    expect(r.totals.partial_capacity).toBe(true);
  });

  it('a closed day has no capacity', async () => {
    const ids = await basics(ctx);
    await ok(ctx, 'PUT', `/api/staff/${ids.staff.id}/business-hours`, MON_FRI_9_TO_5_WITH_LUNCH);
    const r = await ok(ctx, 'GET', '/api/reports/daily-summary?date=2026-11-28');
    expect(r.staff[0].available_minutes).toBe(0);
    expect(r.staff[0].utilisation_pct).toBeNull();
  });

  it('can filter to one staff member', async () => {
    const ids = await basics(ctx);
    await makeStaff(ctx, 'Dr. Other');
    const r = await ok(ctx, 'GET', `/api/reports/daily-summary?date=${MONDAY}&staff_id=${ids.staff.id}`);
    expect(r.staff).toHaveLength(1);
    expect((await call(ctx, 'GET', '/api/reports/daily-summary?staff_id=999')).status).toBe(404);
  });
});

describe('utilisation over a range', () => {
  it('sums working days and skips closed weekends', async () => {
    const ids = await basics(ctx);
    await ok(ctx, 'PUT', `/api/staff/${ids.staff.id}/business-hours`, MON_FRI_9_TO_5_WITH_LUNCH);
    await book(ctx, ids, `${MONDAY}T09:00`);
    await book(ctx, ids, `${TUESDAY}T09:00`);
    const r = await ok(ctx, 'GET', `/api/reports/utilisation?date_from=${MONDAY}&date_to=2026-11-29`);
    expect(r.days).toBe(7);
    expect(r.staff[0].available_minutes).toBe(5 * 420);
    expect(r.staff[0].booked_minutes).toBe(60);
  });

  it('rejects a backwards range; US spelling alias works', async () => {
    expect((await call(ctx, 'GET', `/api/reports/utilisation?date_from=${TUESDAY}&date_to=${MONDAY}`)).status).toBe(422);
    expect((await call(ctx, 'GET', '/api/reports/utilization')).status).toBe(200);
  });

  it('defaults to last week through the next four weeks, filling only the missing end', async () => {
    const ids = await basics(ctx);
    await book(ctx, ids, `${MONDAY}T09:00`);
    const r = await ok(ctx, 'GET', '/api/reports/utilisation');
    expect(r.date_from).toBe('2026-11-13');
    expect(r.date_to).toBe('2026-12-18');
    expect(r.totals.appointments).toBe(1);
    const fromOnly = await ok(ctx, 'GET', '/api/reports/utilisation?date_from=2026-12-01');
    expect(fromOnly.date_to).toBe('2027-01-05');
  });
});

describe('cancellations', () => {
  it('reports rates, breakdowns and recent losses with reasons', async () => {
    const ids = await basics(ctx);
    const dental = await makeService(ctx, 'Dental', 45);
    const a = (await book(ctx, ids, `${MONDAY}T09:00`, { reason: 'Fever' })).body;
    const b = (await book(ctx, { ...ids, service: dental }, `${MONDAY}T10:00`)).body;
    await book(ctx, ids, `${MONDAY}T11:00`);
    await book(ctx, ids, `${MONDAY}T13:00`);
    await setStatus(a.id, 'cancelled');
    await setStatus(b.id, 'no_show');

    const r = await ok(ctx, 'GET', `/api/reports/cancellations?date_from=${MONDAY}&date_to=${MONDAY}`);
    expect(r.totals).toMatchObject({
      total: 4,
      cancelled: 1,
      no_show: 1,
      cancellation_rate_pct: 25,
      no_show_rate_pct: 25,
      combined_rate_pct: 50,
      lost_minutes: 75,
    });
    expect(r.by_staff[0]).toMatchObject({ total: 4, lost_minutes: 75, rate_pct: 50 });
    expect(r.by_service.map((s: any) => s.service_name)).toEqual(['Consultation', 'Dental']);
    expect(r.recent[0]).toMatchObject({ id: b.id, status: 'no_show' });
    expect(r.recent[1]).toMatchObject({ id: a.id, reason: 'Fever', patient_name: 'Ana Cruz' });
  });

  it('an empty range has a null rate', async () => {
    const r = await ok(ctx, 'GET', `/api/reports/cancellations?date_from=${MONDAY}&date_to=${MONDAY}`);
    expect(r.totals.combined_rate_pct).toBeNull();
  });
});
