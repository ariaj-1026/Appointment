import { describe, expect, it } from 'vitest';
import {
  MONDAY,
  MON_FRI_9_TO_5_WITH_LUNCH,
  SATURDAY,
  basics,
  book,
  call,
  makePortalPatient,
  ok,
  outbox,
  setupTestApp,
} from './helpers.js';
import { setNow } from '../src/lib/time.js';
import { patients } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

const ctx = setupTestApp();

async function setup() {
  const ids = await basics(ctx);
  await ok(ctx, 'PUT', `/api/staff/${ids.staff.id}/business-hours`, MON_FRI_9_TO_5_WITH_LUNCH);
  const pia = await makePortalPatient(ctx);
  const request = (startsAt: string, extra: object = {}) =>
    call(ctx, 'POST', '/api/portal/appointments', {
      service_id: ids.service.id,
      staff_id: ids.staff.id,
      starts_at: startsAt,
      ...extra,
    }, pia.as);
  return { ...ids, pia, request };
}

describe('availability', () => {
  it('lists free 15-minute-grid slots inside business hours', async () => {
    const s = await setup();
    await book(ctx, s, `${MONDAY}T09:30`);
    const r = await ok(ctx, 'GET', `/api/portal/availability?service_id=${s.service.id}&staff_id=${s.staff.id}&date=${MONDAY}`, undefined, s.pia.as);
    const times = r.slots.map((x: any) => x.starts_at.slice(11, 16));
    expect(times.slice(0, 4)).toEqual(['09:00', '10:00', '10:15', '10:30']); // 09:15 would overlap 09:30
    expect(times).not.toContain('11:45'); // would run into lunch
    expect(times).toContain('11:30');
    expect(times.at(-1)).toBe('16:30');
  });

  it('is empty on a closed day and respects the lead time today', async () => {
    const s = await setup();
    const sat = await ok(ctx, 'GET', `/api/portal/availability?service_id=${s.service.id}&staff_id=${s.staff.id}&date=${SATURDAY}`, undefined, s.pia.as);
    expect(sat.slots).toEqual([]);
    // NOW is Fri 10:00 → earliest is 11:00.
    const today = await ok(ctx, 'GET', `/api/portal/availability?service_id=${s.service.id}&staff_id=${s.staff.id}&date=2026-11-20`, undefined, s.pia.as);
    expect(today.slots[0].starts_at.slice(11, 16)).toBe('11:00');
  });

  it('only shows public staff and service fields', async () => {
    const s = await setup();
    const staff = await ok(ctx, 'GET', '/api/portal/staff', undefined, s.pia.as);
    expect(Object.keys(staff[0]).sort()).toEqual(['full_name', 'id', 'role']);
  });
});

describe('booking requests', () => {
  it('creates a pending request, holds the slot, emails the patient and alerts employees', async () => {
    const s = await setup();
    const res = await s.request(`${MONDAY}T10:00`, { reason: 'Cough' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'pending', booked_via: 'patient', can_change: true, change_deadline: null });

    expect(outbox.at(-1)).toMatchObject({ to: { email: 'pia@example.com' }, subject: 'We received your appointment request' });
    const inbox = await ok(ctx, 'GET', '/api/notifications');
    expect(inbox.items[0]).toMatchObject({ type: 'booking_request', appointment_id: res.body.id });

    // The slot is held: employees can't double-book it either.
    expect((await book(ctx, s, `${MONDAY}T10:00`)).status).toBe(409);
  });

  it('refuses a slot not on offer (off-grid, outside hours, too soon)', async () => {
    const s = await setup();
    expect((await s.request(`${MONDAY}T10:05`)).status).toBe(422);
    expect((await s.request(`${MONDAY}T12:30`)).status).toBe(422);
    expect((await s.request('2026-11-20T10:30')).status).toBe(422);
  });

  it('limits open requests per patient', async () => {
    const s = await setup();
    for (const t of ['09:00', '10:00', '11:00']) expect((await s.request(`${MONDAY}T${t}`)).status).toBe(201);
    const res = await s.request(`${MONDAY}T13:00`);
    expect(res.body.message).toMatch(/already have 3 requests/);
  });

  it('asks Google-only patients for a phone before booking', async () => {
    const s = await setup();
    await ctx.db.update(patients).set({ phone: '' }).where(eq(patients.id, s.pia.patient.id));
    const res = await s.request(`${MONDAY}T10:00`);
    expect(res.body.code_hint).toBe('profile_incomplete');
  });
});

describe('my appointments', () => {
  it('lists only my own appointments; others are 404', async () => {
    const s = await setup();
    const mine = (await s.request(`${MONDAY}T10:00`)).body;
    const theirs = (await book(ctx, s, `${MONDAY}T14:00`)).body;
    const list = await ok(ctx, 'GET', '/api/portal/appointments', undefined, s.pia.as);
    expect(list.map((a: any) => a.id)).toEqual([mine.id]);
    expect((await call(ctx, 'GET', `/api/portal/appointments/${theirs.id}`, undefined, s.pia.as)).status).toBe(404);
    expect((await call(ctx, 'POST', `/api/portal/appointments/${theirs.id}/cancel`, {}, s.pia.as)).status).toBe(404);
  });

  it('a pending request can be withdrawn; employees are told', async () => {
    const s = await setup();
    const a = (await s.request(`${MONDAY}T10:00`)).body;
    const res = await ok(ctx, 'POST', `/api/portal/appointments/${a.id}/cancel`, { reason: 'Feeling better' }, s.pia.as);
    expect(res.status).toBe('cancelled');
    const inbox = await ok(ctx, 'GET', '/api/notifications');
    expect(inbox.items[0].title).toBe('Request withdrawn: Pia Portal');
  });

  it('a confirmed visit can be cancelled until 24h before, not after', async () => {
    const s = await setup();
    const a = (await s.request(`${MONDAY}T10:00`)).body;
    await ok(ctx, 'POST', `/api/appointments/${a.id}/approve`, {});

    setNow(new Date('2026-11-22T10:30:00+08:00')); // 23.5h before
    const late = await call(ctx, 'POST', `/api/portal/appointments/${a.id}/cancel`, {}, s.pia.as);
    expect(late.status).toBe(422);
    expect(late.body.code_hint).toBe('cutoff');
    expect((await ok(ctx, 'GET', `/api/portal/appointments/${a.id}`, undefined, s.pia.as)).can_change).toBe(false);

    setNow(new Date('2026-11-22T09:30:00+08:00')); // 24.5h before
    expect((await call(ctx, 'POST', `/api/portal/appointments/${a.id}/cancel`, {}, s.pia.as)).status).toBe(200);
  });

  it('rescheduling moves the slot and goes back to pending', async () => {
    const s = await setup();
    const a = (await s.request(`${MONDAY}T10:00`)).body;
    await ok(ctx, 'POST', `/api/appointments/${a.id}/approve`, {});
    const moved = await ok(ctx, 'POST', `/api/portal/appointments/${a.id}/reschedule`, { starts_at: `${MONDAY}T15:00` }, s.pia.as);
    expect(moved).toMatchObject({ status: 'pending', starts_at: `${MONDAY}T15:00:00+08:00` });
    // Old slot is free again.
    expect((await book(ctx, s, `${MONDAY}T10:00`)).status).toBe(201);
    const history = await ok(ctx, 'GET', `/api/appointments/${a.id}/history`);
    expect(history.at(-1)).toMatchObject({ action: 'rescheduled', from_status: 'scheduled', to_status: 'pending' });
  });

  it('profile edits are limited to safe fields', async () => {
    const s = await setup();
    const p = await ok(ctx, 'PATCH', '/api/portal/profile', { phone: '0999', notes: 'hack', user_id: 1 }, s.pia.as);
    expect(p.phone).toBe('0999');
    expect(p.notes).toBeNull();
    expect(p.user_id).toBe(s.pia.user.id);
  });
});
