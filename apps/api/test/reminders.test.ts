import { describe, expect, it } from 'vitest';
import { basics, book, call, makePatient, ok, setupTestApp } from './helpers.js';

const ctx = setupTestApp();
// NOW is Fri 2026-11-20 10:00 Manila.
const TOMORROW_9 = '2026-11-21T09:00';
const dueIds = async (q = '') => (await ok(ctx, 'GET', `/api/reminders/due${q}`)).map((a: any) => a.id);
const dispatch = (q = '') => ok(ctx, 'POST', `/api/reminders/dispatch${q}`);

describe('reminders', () => {
  it('an upcoming appointment is due; one beyond the window is not', async () => {
    const ids = await basics(ctx);
    const soon = (await book(ctx, ids, TOMORROW_9)).body;
    await book(ctx, ids, '2026-11-23T09:00');
    expect(await dueIds()).toEqual([soon.id]);
    expect(await dueIds('?within_hours=2')).toEqual([]);
  });

  it.each([
    ['cancelled', false],
    ['completed', false],
    ['confirmed', true],
  ])('a %s appointment due = %s', async (status, due) => {
    const ids = await basics(ctx);
    const a = (await book(ctx, ids, TOMORROW_9)).body;
    await ok(ctx, 'PATCH', `/api/appointments/${a.id}/status`, { status });
    expect(await dueIds()).toEqual(due ? [a.id] : []);
  });

  it('a past appointment is not due', async () => {
    const ids = await basics(ctx);
    await book(ctx, ids, '2026-11-20T09:50'); // within grace, already started
    expect(await dueIds()).toEqual([]);
  });

  it('dispatch sends, logs, and does not repeat itself', async () => {
    const ids = await basics(ctx);
    const a = (await book(ctx, ids, TOMORROW_9)).body;
    const first = await dispatch();
    expect(first).toMatchObject({ considered: 1, sent: 1, failed: 0 });
    expect(ctx.sender.sent).toEqual([
      'Reminder for Ana Cruz (0917-555-0101): Consultation with Dr. Ilagan on Sat 21 Nov at 09:00.',
    ]);
    expect(await dueIds()).toEqual([]);
    expect(await dispatch()).toMatchObject({ considered: 0, sent: 0 });

    const log = await ok(ctx, 'GET', `/api/reminders/log/${a.id}`);
    expect(log).toEqual([
      expect.objectContaining({ status: 'sent', recipient: 'ana@example.com', type: 'reminder_24h' }),
    ]);
  });

  it('24h and 2h reminders are tracked separately', async () => {
    const ids = await basics(ctx);
    await book(ctx, ids, '2026-11-20T11:00');
    await dispatch();
    expect(await dueIds('?within_hours=2&type=reminder_2h')).toHaveLength(1);
  });

  it('a failed send is logged and stays due; one failure does not abort the sweep', async () => {
    const ids = await basics(ctx);
    const bad = (await book(ctx, ids, TOMORROW_9)).body;
    const ben = await makePatient(ctx, 'Ben', 'Reyes', '0917-555-0202', { email: 'ben@example.com' });
    await book(ctx, { ...ids, patient: ben }, '2026-11-21T10:00');
    ctx.sender.failFor.add(bad.id);

    const r = await dispatch();
    expect(r).toMatchObject({ considered: 2, sent: 1, failed: 1 });
    expect(await dueIds()).toEqual([bad.id]);
    const log = await ok(ctx, 'GET', `/api/reminders/log/${bad.id}`);
    expect(log[0]).toMatchObject({ status: 'failed', detail: 'Error: mailbox unavailable' });
  });

  it('a patient without an email is skipped once, not retried forever', async () => {
    const ids = await basics(ctx);
    const noEmail = await makePatient(ctx, 'Carla', 'Mendoza', '0917-555-0303');
    await book(ctx, { ...ids, patient: noEmail }, TOMORROW_9);
    expect(await dispatch()).toMatchObject({ considered: 1, skipped: 1 });
    expect(await dueIds()).toEqual([]);
  });

  it('rejects an unknown sender', async () => {
    const res = await call(ctx, 'POST', '/api/reminders/dispatch?sender=pigeon');
    expect(res.status).toBe(422);
    expect(res.body.message).toBe("Unknown reminder sender 'pigeon'. Available: email, log.");
  });
});
