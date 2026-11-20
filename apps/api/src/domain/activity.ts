/**
 * The activity log: who did what, when. Callers write the log row inside the
 * same transaction as the change it describes, so a failed change can never
 * leave an entry claiming it happened.
 */
import { and, asc, eq } from 'drizzle-orm';
import type { Role } from '@clinic/shared';
import type { Conn } from '../db/client.js';
import { activity_log } from '../db/schema.js';
import { toClinicIso, toClinicIsoOrNull } from '../lib/time.js';

/** Who is acting. Anonymous until Phase 2 wires authentication. */
export interface Actor {
  user_id: number | null;
  role: Role | null;
  ip?: string | null;
  user_agent?: string | null;
}

export const SYSTEM_ACTOR: Actor = { user_id: null, role: null };

export interface ActivityEntry {
  action: string;
  entity?: string;
  entity_id?: number;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  note?: string | null;
}

export async function logActivity(conn: Conn, actor: Actor, entry: ActivityEntry): Promise<void> {
  await conn.insert(activity_log).values({
    user_id: actor.user_id,
    actor_role: actor.role,
    ip: actor.ip ?? null,
    user_agent: actor.user_agent ?? null,
    action: entry.action,
    entity: entry.entity ?? null,
    entity_id: entry.entity_id ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    note: entry.note ?? null,
  });
}

// ---------------------------------------------------------------------------
// Appointment history (v1 AuditLogRead shape, derived from activity_log)
// ---------------------------------------------------------------------------

export const APPOINTMENT_ACTIONS = {
  created: 'created',
  statusChanged: 'status_changed',
  rescheduled: 'rescheduled',
} as const;

type Snap = { status?: string; starts_at?: string; staff_id?: number } | null;

export async function appointmentHistory(conn: Conn, appointmentId: number, zone: string) {
  const rows = await conn
    .select()
    .from(activity_log)
    .where(and(eq(activity_log.entity, 'appointment'), eq(activity_log.entity_id, appointmentId)))
    .orderBy(asc(activity_log.created_at), asc(activity_log.id));

  const iso = (v: string | undefined) => toClinicIsoOrNull(v ? new Date(v) : null, zone);

  return rows.map((r) => {
    const before = r.before as Snap;
    const after = r.after as Snap;
    return {
      id: r.id,
      appointment_id: appointmentId,
      action: r.action,
      from_status: before?.status ?? null,
      to_status: after?.status ?? null,
      from_starts_at: iso(before?.starts_at),
      to_starts_at: iso(after?.starts_at),
      from_staff_id: before?.staff_id ?? null,
      to_staff_id: after?.staff_id ?? null,
      note: r.note,
      user_id: r.user_id,
      actor_role: r.actor_role,
      changed_at: toClinicIso(r.created_at, zone),
    };
  });
}
