import { useEffect, useState } from 'react'

import { api } from '../api/client.js'
import {
  STATUS_LABELS,
  formatDateShort,
  formatTime,
  parseNaive,
} from '../lib/datetime.js'

const pad = (n) => String(n).padStart(2, '0')

function when(iso) {
  const d = parseNaive(iso)
  return `${formatDateShort(iso)} at ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function describe(entry, staffById) {
  const name = (id) => staffById[id]?.full_name || `staff #${id}`

  switch (entry.action) {
    case 'created':
      return (
        <>
          Booked for <strong>{when(entry.to_starts_at)}</strong>
          {entry.to_staff_id ? <> with {name(entry.to_staff_id)}</> : null}
        </>
      )
    case 'status_changed':
      return (
        <>
          Status changed from{' '}
          <strong>{STATUS_LABELS[entry.from_status] || entry.from_status}</strong> to{' '}
          <strong>{STATUS_LABELS[entry.to_status] || entry.to_status}</strong>
        </>
      )
    case 'rescheduled': {
      const movedStaff = entry.from_staff_id !== entry.to_staff_id
      return (
        <>
          Moved from <strong>{when(entry.from_starts_at)}</strong> to{' '}
          <strong>{when(entry.to_starts_at)}</strong>
          {movedStaff && (
            <>
              , reassigned from {name(entry.from_staff_id)} to{' '}
              {name(entry.to_staff_id)}
            </>
          )}
        </>
      )
    }
    default:
      return entry.action
  }
}

/** The appointment's full history, oldest first. */
export default function HistoryTimeline({ appointmentId, staff }) {
  const [entries, setEntries] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let active = true
    api
      .getHistory(appointmentId)
      .then((rows) => active && setEntries(rows))
      .catch((err) => active && setError(err))
    return () => {
      active = false
    }
  }, [appointmentId])

  const staffById = Object.fromEntries((staff || []).map((s) => [s.id, s]))

  if (error) return <p className="hint">History unavailable: {error.message}</p>
  if (!entries) return <p className="hint">Loading history…</p>
  if (entries.length === 0) {
    return (
      <p className="hint">
        No history recorded. Appointments booked before history was added have
        none.
      </p>
    )
  }

  return (
    <ul className="timeline">
      {entries.map((entry) => (
        <li key={entry.id}>
          <span className="timeline-dot" aria-hidden="true" />
          <div className="timeline-body">
            {describe(entry, staffById)}
            <span className="timeline-when">
              {formatDateShort(entry.changed_at)} · {formatTime(entry.changed_at)}
            </span>
            {entry.note && <span className="timeline-note">“{entry.note}”</span>}
          </div>
        </li>
      ))}
    </ul>
  )
}
