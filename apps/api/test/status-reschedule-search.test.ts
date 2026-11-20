import { describe, expect, it } from 'vitest';
import {
  MONDAY,
  MON_FRI_9_TO_5_WITH_LUNCH,
  TUESDAY,
  basics,
  book,
  call,
  makePatient,
  makeService,
  makeStaff,
  ok,
  setupTestApp,
} from './helpers.js';

const ctx = setupTestApp();
const setStatus = (id: number, status: string, note?: string) =>
  call(ctx, 'PATCH', `/api/appointments/${id}/status`, { status, note });

describe('status machine', () => {
  it('scheduled can move to any non-pending status', async () => {
    const ids = await basics(ctx);
    for (const [i, s] of ['confirmed', 'completed', 'cancelled', 'no_show'].entries()) {
      const a = (await book(ctx, ids, `${MONDAY}T${String(9 + i).padStart(2, '0')}:00`)).body;
      expect((await setStatus(a.id, s)).status).toBe(200);
    }
  });

  it('confirmed cannot go back to scheduled', async () => {
    const ids = await basics(ctx);
    const a = (await book(ctx, ids, `${MONDAY}T09:00`)).body;
    await setStatus(a.id, 'confirmed');
    expect((await setStatus(a.id, 'scheduled')).status).toBe(422);
  });

  it('terminal statuses are final', async () => {
    const ids = await basics(ctx);
    const a = (await book(ctx, ids, `${MONDAY}T09:00`)).body;
    await setStatus(a.id, 'cancelled');
    const res = await setStatus(a.id, 'confirmed');
    expect(res.status).toBe(422);
    expect(res.body.message).toBe(
      'Cannot change a cancelled appointment to confirmed. Allowed from cancelled: none.',
    );
  });

  it('setting the same status is rejected', async () => {
    const ids = await basics(ctx);
    const a = (await book(ctx, ids, `${MONDAY}T09:00`)).body;
    expect((await setStatus(a.id, 'scheduled')).body.message).toBe('Appointment is already scheduled.');
  });

  it('the error lists the legal moves', async () => {
    const ids = await basics(ctx);
    const a = (await book(ctx, ids, `${MONDAY}T09:00`)).body;
    const res = await setStatus(a.id, 'declined');
    expect(res.body.allowed).toEqual(['cancelled', 'completed', 'confirmed', 'no_show']);
  });

  it('an unknown status is rejected by validation', async () => {
    const ids = await basics(ctx);
    const a = (await book(ctx, ids, `${MONDAY}T09:00`)).body;
    const res = await setStatus(a.id, 'teleported');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('validation_error');
  });
});

describe('reschedule', () => {
  it('moves the appointment', async () => {
    const ids = await basics(ctx);
    const a = (await book(ctx, ids, `${MONDAY}T09:00`)).body;
    const moved = await ok(ctx, 'PATCH', `/api/appointments/${a.id}/reschedule`, { starts_at: `${TUESDAY}T10:00` });
    expect(moved.starts_at).toBe(`${TUESDAY}T10:00:00+08:00`);
    expect(moved.ends_at).toBe(`${TUESDAY}T10:30:00+08:00`);
  });

  it('can overlap its own old slot', async () => {
    const ids = await basics(ctx);
    const a = (await book(ctx, ids, `${MONDAY}T09:00`)).body;
    expect((await call(ctx, 'PATCH', `/api/appointments/${a.id}/reschedule`, { starts_at: `${MONDAY}T09:15` })).status).toBe(200);
  });

  it('refuses a taken slot', async () => {
    const ids = await basics(ctx);
    const a = (await book(ctx, ids, `${MONDAY}T09:00`)).body;
    await book(ctx, ids, `${MONDAY}T10:00`);
    expect((await call(ctx, 'PATCH', `/api/appointments/${a.id}/reschedule`, { starts_at: `${MONDAY}T10:00` })).status).toBe(409);
  });

  it('revalidates business hours', async () => {
    const ids = await basics(ctx);
    await ok(ctx, 'PUT', `/api/staff/${ids.staff.id}/business-hours`, MON_FRI_9_TO_5_WITH_LUNCH);
    const a = (await book(ctx, ids, `${MONDAY}T09:00`)).body;
    expect((await call(ctx, 'PATCH', `/api/appointments/${a.id}/reschedule`, { starts_at: `${MONDAY}T12:30` })).status).toBe(422);
  });

  it('can change staff, and a new service recomputes the end', async () => {
    const ids = await basics(ctx);
    const a = (await book(ctx, ids, `${MONDAY}T09:00`)).body;
    const other = await makeStaff(ctx, 'Dr. Santos');
    const long = await makeService(ctx, 'Procedure', 60);
    const moved = await ok(ctx, 'PATCH', `/api/appointments/${a.id}/reschedule`, {
      starts_at: `${MONDAY}T09:00`,
      staff_id: other.id,
      service_id: long.id,
    });
    expect(moved.staff.id).toBe(other.id);
    expect(moved.ends_at).toBe(`${MONDAY}T10:00:00+08:00`);
  });

  it('cancelled appointments cannot be rescheduled', async () => {
    const ids = await basics(ctx);
    const a = (await book(ctx, ids, `${MONDAY}T09:00`)).body;
    await setStatus(a.id, 'cancelled');
    const res = await call(ctx, 'PATCH', `/api/appointments/${a.id}/reschedule`, { starts_at: `${MONDAY}T10:00` });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('invalid_status_transition');
  });
});

describe('list and search', () => {
  async function seed() {
    const ids = await basics(ctx);
    const ben = await makePatient(ctx, 'Ben', 'Reyes', '0917-555-0202');
    const other = await makeStaff(ctx, 'Dr. Santos');
    const dental = await makeService(ctx, 'Dental', 45);
    const a1 = (await book(ctx, ids, `${MONDAY}T09:00`)).body;
    const a2 = (await book(ctx, { ...ids, patient: ben, staff: other, service: dental }, `${MONDAY}T09:00`)).body;
    const a3 = (await book(ctx, { ...ids, patient: ben }, `${TUESDAY}T09:00`)).body;
    await setStatus(a3.id, 'cancelled');
    return { ids, ben, other, dental, a1, a2, a3 };
  }
  const idsOf = (rows: { id: number }[]) => rows.map((r) => r.id).sort();

  it('lists by day (clinic-local) and by staff', async () => {
    const s = await seed();
    expect(idsOf(await ok(ctx, 'GET', `/api/appointments?on=${MONDAY}`))).toEqual([s.a1.id, s.a2.id]);
    expect(idsOf(await ok(ctx, 'GET', `/api/appointments?staff_id=${s.other.id}`))).toEqual([s.a2.id]);
  });

  it('searches by name, phone, status, inclusive date range and combinations', async () => {
    const s = await seed();
    expect(idsOf(await ok(ctx, 'GET', '/api/appointments/search?q=reyes'))).toEqual([s.a2.id, s.a3.id]);
    expect(idsOf(await ok(ctx, 'GET', '/api/appointments/search?q=0101'))).toEqual([s.a1.id]);
    expect(idsOf(await ok(ctx, 'GET', '/api/appointments/search?status=cancelled'))).toEqual([s.a3.id]);
    expect(idsOf(await ok(ctx, 'GET', `/api/appointments/search?date_from=${TUESDAY}&date_to=${TUESDAY}`))).toEqual([s.a3.id]);
    expect(idsOf(await ok(ctx, 'GET', `/api/appointments/search?q=ben&service_id=${s.dental.id}`))).toEqual([s.a2.id]);
  });

  it('detail includes the joined records', async () => {
    const s = await seed();
    const d = await ok(ctx, 'GET', `/api/appointments/${s.a2.id}`);
    expect(d.patient.full_name).toBe('Ben Reyes');
    expect(d.staff.full_name).toBe('Dr. Santos');
    expect(d.service.name).toBe('Dental');
    expect((await call(ctx, 'GET', '/api/appointments/9999')).status).toBe(404);
  });
});
