import { useEffect, useState, type ReactNode } from 'react';

import { api } from '../api/client';
import type { HistoryEntry, Staff } from '../api/types';
import { STATUS_LABELS, formatDateShort, formatTime } from '../lib/datetime';

const when = (iso: string) => `${formatDateShort(iso)} at ${formatTime(iso)}`;
const statusLabel = (s: string | null) => (s ? STATUS_LABELS[s as keyof typeof STATUS_LABELS] || s : '—');
const WHO: Record<string, string> = { patient: 'by the patient', employee: 'by staff', admin: 'by an admin' };

function describe(entry: HistoryEntry, staffById: Record<number, Staff>): ReactNode {
  const name = (id: number | null) => (id ? staffById[id]?.full_name || `staff #${id}` : 'unknown');

  switch (entry.action) {
    case 'created':
      return (
        <>
          {entry.to_status === 'pending' ? 'Requested' : 'Booked'} for <strong>{when(entry.to_starts_at!)}</strong>
          {entry.to_staff_id ? <> with {name(entry.to_staff_id)}</> : null}
        </>
      );
    case 'status_changed':
      return (
        <>
          Status changed from <strong>{statusLabel(entry.from_status)}</strong> to{' '}
          <strong>{statusLabel(entry.to_status)}</strong>
        </>
      );
    case 'rescheduled': {
      const movedStaff = entry.from_staff_id !== entry.to_staff_id;
      return (
        <>
          Moved from <strong>{when(entry.from_starts_at!)}</strong> to <strong>{when(entry.to_starts_at!)}</strong>
          {movedStaff && (
            <>
              , reassigned from {name(entry.from_staff_id)} to {name(entry.to_staff_id)}
            </>
          )}
          {entry.to_status && entry.to_status !== entry.from_status && (
            <> — now <strong>{statusLabel(entry.to_status)}</strong></>
          )}
        </>
      );
    }
    default:
      return entry.action;
  }
}

/** The appointment's full history, oldest first. */
export default function HistoryTimeline({ appointmentId, staff }: { appointmentId: number; staff: Staff[] }) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;
    api
      .getHistory(appointmentId)
      .then((rows) => active && setEntries(rows))
      .catch((err: Error) => active && setError(err));
    return () => {
      active = false;
    };
  }, [appointmentId]);

  const staffById = Object.fromEntries(staff.map((s) => [s.id, s]));

  if (error) return <p className="hint">History unavailable: {error.message}</p>;
  if (!entries) return <p className="hint">Loading history…</p>;
  if (entries.length === 0) return <p className="hint">No history recorded.</p>;

  return (
    <ul className="timeline">
      {entries.map((entry) => (
        <li key={entry.id}>
          <span className="timeline-dot" aria-hidden="true" />
          <div className="timeline-body">
            {describe(entry, staffById)}
            <span className="timeline-when">
              {formatDateShort(entry.changed_at)} · {formatTime(entry.changed_at)}
              {entry.actor_role ? ` · ${WHO[entry.actor_role] ?? entry.actor_role}` : ''}
            </span>
            {entry.note && <span className="timeline-note">“{entry.note}”</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}
