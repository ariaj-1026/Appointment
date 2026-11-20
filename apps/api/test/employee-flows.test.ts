import { describe, expect, it } from 'vitest';
import {
  MONDAY,
  TUESDAY,
  basics,
  book,
  call,
  makePortalPatient,
  ok,
  outbox,
  setupTestApp,
} from './helpers.js';

const ctx = setupTestApp();

async function pendingRequest() {
  const ids = await basics(ctx);
  const pia = await makePortalPatient(ctx);
  const req = await ok(ctx, 'POST', '/api/portal/appointments', {
    service_id: ids.service.id,
    staff_id: ids.staff.id,
    starts_at: `${MONDAY}T10:00`,
  }, pia.as);
  return { ...ids, pia, req };
}

describe('approval queue', () => {
  it('approve → scheduled, records who decided, emails the patient', async () => {
    const s = await pendingRequest();
    const pending = await ok(ctx, 'GET', '/api/appointments/search?status=pending');
    expect(pending.map((a: any) => a.id)).toEqual([s.req.id]);

    const res = await ok(ctx, 'POST', `/api/appointments/${s.req.id}/approve`, {});
    expect(res).toMatchObject({ status: 'scheduled', decision_by: ctx.ids.employee });
    expect(outbox.at(-1)?.subject).toBe('Your appointment is confirmed');

    const portal = await ok(ctx, 'GET', '/api/notifications', undefined, s.pia.as);
    expect(portal.items[0].title).toBe('Your appointment is confirmed');
  });

  it('decline needs a reason, frees the slot, and tells the patient why', async () => {
    const s = await pendingRequest();
    expect((await call(ctx, 'POST', `/api/appointments/${s.req.id}/decline`, {})).status).toBe(422);
    const res = await ok(ctx, 'POST', `/api/appointments/${s.req.id}/decline`, { reason: 'Doctor on leave' });
    expect(res).toMatchObject({ status: 'declined', decision_reason: 'Doctor on leave' });
    expect(outbox.at(-1)?.html).toContain('Doctor on leave');
    expect((await book(ctx, s, `${MONDAY}T10:00`)).status).toBe(201);
  });

  it('pending requests cannot be pushed through the generic status endpoint', async () => {
    const s = await pendingRequest();
    const res = await call(ctx, 'PATCH', `/api/appointments/${s.req.id}/status`, { status: 'confirmed' });
    expect(res.body.message).toMatch(/Approve or decline/);
  });
});

describe('override with notification', () => {
  it('cancelling a portal patient needs a reason, which is emailed', async () => {
    const s = await pendingRequest();
    await ok(ctx, 'POST', `/api/appointments/${s.req.id}/approve`, {});
    const noReason = await call(ctx, 'PATCH', `/api/appointments/${s.req.id}/status`, { status: 'cancelled' });
    expect(noReason.status).toBe(422);
    expect(noReason.body.field).toBe('note');

    await ok(ctx, 'PATCH', `/api/appointments/${s.req.id}/status`, { status: 'cancelled', note: 'Clinic closed for typhoon' });
    expect(outbox.at(-1)).toMatchObject({ subject: 'Your appointment was cancelled' });
    expect(outbox.at(-1)?.html).toContain('Clinic closed for typhoon');
  });

  it('moving a portal patient needs a reason and emails old + new time', async () => {
    const s = await pendingRequest();
    await ok(ctx, 'POST', `/api/appointments/${s.req.id}/approve`, {});
    expect((await call(ctx, 'PATCH', `/api/appointments/${s.req.id}/reschedule`, { starts_at: `${TUESDAY}T11:00` })).status).toBe(422);
    await ok(ctx, 'PATCH', `/api/appointments/${s.req.id}/reschedule`, { starts_at: `${TUESDAY}T11:00`, note: 'Doctor running a clinic outreach' });
    const mail = outbox.at(-1)!;
    expect(mail.subject).toBe('Your appointment was changed');
    expect(mail.text).toContain('previously Mon 23 Nov 2026 at 10:00');
    expect(mail.text).toContain('Tue 24 Nov 2026');
  });

  it('walk-in patients need no reason; employee bookings email a confirmation if possible', async () => {
    const ids = await basics(ctx);
    const a = (await book(ctx, ids, `${MONDAY}T09:00`)).body;
    expect(outbox.at(-1)).toMatchObject({ to: { email: 'ana@example.com' }, subject: 'An appointment was booked for you' });
    expect((await call(ctx, 'PATCH', `/api/appointments/${a.id}/status`, { status: 'cancelled' })).status).toBe(200);
  });

  it('notification inbox: read one, read all', async () => {
    await pendingRequest();
    const inbox = await ok(ctx, 'GET', '/api/notifications');
    expect(inbox.unread).toBe(1);
    await ok(ctx, 'POST', `/api/notifications/${inbox.items[0].id}/read`);
    expect((await ok(ctx, 'GET', '/api/notifications')).unread).toBe(0);
  });
});
