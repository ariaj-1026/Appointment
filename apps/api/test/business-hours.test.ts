import { describe, expect, it } from 'vitest';
import {
  MONDAY,
  MON_FRI_9_TO_5_WITH_LUNCH,
  SATURDAY,
  basics,
  book,
  call,
  makeService,
  makeStaff,
  ok,
  setupTestApp,
} from './helpers.js';

const ctx = setupTestApp();

async function withHours(minutes = 30) {
  const ids = await basics(ctx, minutes);
  await ok(ctx, 'PUT', `/api/staff/${ids.staff.id}/business-hours`, MON_FRI_9_TO_5_WITH_LUNCH);
  return ids;
}

describe('business hours', () => {
  it('no hours configured means unrestricted', async () => {
    const ids = await basics(ctx);
    expect((await book(ctx, ids, `${SATURDAY}T22:00`)).status).toBe(201);
  });

  it('allows inside hours', async () => {
    const ids = await withHours();
    expect((await book(ctx, ids, `${MONDAY}T09:00`)).status).toBe(201);
  });

  it('refuses before opening', async () => {
    const ids = await withHours();
    const res = await book(ctx, ids, `${MONDAY}T08:30`);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('outside_business_hours');
    expect(res.body.message).toBe(
      "08:30-09:00 falls outside this staff member's Monday hours (09:00-12:00, 13:00-17:00).",
    );
  });

  it('refuses ending after close, allows ending exactly at close', async () => {
    const ids = await withHours();
    expect((await book(ctx, ids, `${MONDAY}T16:45`)).status).toBe(422);
    expect((await book(ctx, ids, `${MONDAY}T16:30`)).status).toBe(201);
  });

  it('refuses a closed weekday', async () => {
    const ids = await withHours();
    const res = await book(ctx, ids, `${SATURDAY}T10:00`);
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/^Saturday is not a working day/);
    expect(res.body.open_weekdays).toEqual([0, 1, 2, 3, 4]);
  });

  it('rejects the lunch gap and a booking straddling two windows', async () => {
    const ids = await withHours();
    expect((await book(ctx, ids, `${MONDAY}T12:15`)).status).toBe(422);
    expect((await book(ctx, ids, `${MONDAY}T11:45`)).status).toBe(422);
  });

  it('hours are per staff member', async () => {
    const ids = await withHours();
    const other = await makeStaff(ctx, 'Dr. Night');
    expect((await book(ctx, { ...ids, staff: other }, `${SATURDAY}T10:00`)).status).toBe(201);
  });

  it('is evaluated in the clinic time zone, whatever offset the client sends', async () => {
    const ids = await withHours();
    // 01:00Z = 09:00 Manila → inside hours.
    expect((await book(ctx, ids, `${MONDAY}T01:00:00Z`)).status).toBe(201);
    // 08:00+08:00 → before opening.
    expect((await book(ctx, ids, `${MONDAY}T08:00:00+08:00`)).status).toBe(422);
  });

  it('rejects overlapping and backwards windows', async () => {
    const { staff } = await basics(ctx);
    const overlap = await call(ctx, 'PUT', `/api/staff/${staff.id}/business-hours`, [
      { weekday: 0, opens_at: '09:00', closes_at: '12:00' },
      { weekday: 0, opens_at: '11:00', closes_at: '14:00' },
    ]);
    expect(overlap.status).toBe(422);
    expect(overlap.body.message).toBe('Overlapping hours on weekday 0: 09:00-12:00 and 11:00-14:00.');

    const backwards = await call(ctx, 'PUT', `/api/staff/${staff.id}/business-hours`, [
      { weekday: 0, opens_at: '12:00', closes_at: '09:00' },
    ]);
    expect(backwards.status).toBe(422);
  });

  it('can be replaced and cleared', async () => {
    const { staff } = await withHours();
    expect(await ok(ctx, 'GET', `/api/staff/${staff.id}/business-hours`)).toHaveLength(10);
    const replaced = await ok(ctx, 'PUT', `/api/staff/${staff.id}/business-hours`, [
      { weekday: 5, opens_at: '08:00', closes_at: '12:00' },
    ]);
    expect(replaced).toEqual([
      expect.objectContaining({ weekday: 5, opens_at: '08:00:00', closes_at: '12:00:00' }),
    ]);
    expect(await ok(ctx, 'PUT', `/api/staff/${staff.id}/business-hours`, [])).toEqual([]);
  });

  it('a long service cannot run past close', async () => {
    const ids = await withHours();
    const long = await makeService(ctx, 'Long', 120);
    expect((await book(ctx, { ...ids, service: long }, `${MONDAY}T15:30`)).status).toBe(422);
  });
});
