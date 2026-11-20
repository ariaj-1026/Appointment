import { useState } from 'react'

import { api } from '../api/client.js'
import {
  ALLOWED_TRANSITIONS,
  STATUS_LABELS,
  formatDateShort,
  formatTimeRange,
  nowInput,
} from '../lib/datetime.js'
import ErrorAlert from './ErrorAlert.jsx'
import HistoryTimeline from './HistoryTimeline.jsx'
import Modal from './Modal.jsx'
import StatusBadge from './StatusBadge.jsx'

// Ending an appointment early is worth a reason; routine progress is not.
const NEEDS_REASON = ['cancelled', 'no_show']

/**
 * Appointment detail: status changes and rescheduling.
 *
 * Only legal next statuses are offered, mirroring the backend's status
 * machine, so the UI does not invite a request that will be rejected.
 */
export default function AppointmentDetail({
  appointment,
  staff,
  services,
  onClose,
  onChanged,
}) {
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [rescheduling, setRescheduling] = useState(false)
  const [pending, setPending] = useState(null) // status awaiting a reason
  const [note, setNote] = useState('')
  // Bumped after every change so the timeline refetches.
  const [historyKey, setHistoryKey] = useState(0)
  const [move, setMove] = useState({
    starts_at: appointment.starts_at.slice(0, 16),
    staff_id: String(appointment.staff_id),
    service_id: String(appointment.service_id),
  })

  const allowed = ALLOWED_TRANSITIONS[appointment.status] || []
  const isTerminal = allowed.length === 0

  // Opening an old appointment to read its history is fine; moving it into a
  // slot that has already gone is not. Only the proposed new time is checked,
  // never the appointment's current one.
  const minStart = nowInput()
  const movesToPast = Boolean(move.starts_at) && move.starts_at < minStart

  // Deactivated staff and services are dropped from the move dialog, since the
  // API refuses them — offering one would promise a move it cannot make. The
  // exception is the appointment's *own* current staff member or service: if
  // they were deactivated after it was booked, they must stay in the list, or
  // the dropdown would silently show someone else as the selection and a
  // reschedule meant only to change the time would quietly reassign it.
  const keepCurrent = (rows, currentId) =>
    rows.filter((r) => r.is_active || r.id === currentId)

  const bookableStaff = keepCurrent(staff, appointment.staff_id)
  const bookableServices = keepCurrent(services, appointment.service_id)

  function requestStatus(status) {
    if (NEEDS_REASON.includes(status)) {
      setPending(status)
      setNote('')
      return
    }
    applyStatus(status)
  }

  async function applyStatus(status, reason = null) {
    setError(null)
    setBusy(true)
    try {
      const updated = await api.updateStatus(appointment.id, status, reason)
      setPending(null)
      setNote('')
      setHistoryKey((k) => k + 1)
      onChanged(updated)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  async function submitReschedule(e) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const updated = await api.reschedule(appointment.id, {
        starts_at: `${move.starts_at}:00`,
        staff_id: Number(move.staff_id),
        service_id: Number(move.service_id),
      })
      setRescheduling(false)
      setHistoryKey((k) => k + 1)
      onChanged(updated)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`${appointment.patient.full_name} · ${formatTimeRange(
        appointment.starts_at,
        appointment.ends_at,
      )}`}
      onClose={onClose}
      footer={
        <>
          {!isTerminal && !rescheduling && (
            <button
              className="btn btn-secondary"
              onClick={() => setRescheduling(true)}
              disabled={busy}
            >
              Reschedule
            </button>
          )}
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="modal-body">
        <ErrorAlert error={error} />

        <dl className="detail-list">
          <dt>Status</dt>
          <dd>
            <StatusBadge status={appointment.status} />
          </dd>

          <dt>When</dt>
          <dd>
            {formatDateShort(appointment.starts_at)},{' '}
            {formatTimeRange(appointment.starts_at, appointment.ends_at)} (
            {appointment.duration_minutes} min)
          </dd>

          <dt>Patient</dt>
          <dd>
            {appointment.patient.full_name}
            <div className="cell-muted">{appointment.patient.phone}</div>
          </dd>

          <dt>Staff</dt>
          <dd>
            {appointment.staff.full_name}
            <div className="cell-muted">{appointment.staff.role}</div>
          </dd>

          <dt>Service</dt>
          <dd>{appointment.service.name}</dd>

          {appointment.reason && (
            <>
              <dt>Reason</dt>
              <dd>{appointment.reason}</dd>
            </>
          )}
        </dl>

        {rescheduling ? (
          <form
            onSubmit={submitReschedule}
            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
          >
            <h3>Move this appointment</h3>
            <div className="field">
              <label htmlFor="new-start">New start time</label>
              <input
                id="new-start"
                type="datetime-local"
                value={move.starts_at}
                onChange={(e) => setMove((m) => ({ ...m, starts_at: e.target.value }))}
                min={minStart}
                required
              />
              {movesToPast && (
                <span className="hint hint-warn">
                  That time has already passed. An appointment can only be
                  moved forward.
                </span>
              )}
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="new-staff">Staff member</label>
                <select
                  id="new-staff"
                  value={move.staff_id}
                  onChange={(e) => setMove((m) => ({ ...m, staff_id: e.target.value }))}
                >
                  {bookableStaff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name}
                      {s.is_active ? '' : ' (deactivated)'}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="new-service">Service</label>
                <select
                  id="new-service"
                  value={move.service_id}
                  onChange={(e) =>
                    setMove((m) => ({ ...m, service_id: e.target.value }))
                  }
                >
                  {bookableServices.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.duration_minutes} min)
                      {s.is_active ? '' : ' — deactivated'}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setRescheduling(false)}
              >
                Back
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={busy || movesToPast}
              >
                {busy ? 'Moving…' : 'Confirm move'}
              </button>
            </div>
          </form>
        ) : (
          <div className="field">
            <label>Change status</label>
            {isTerminal ? (
              <div className="alert alert-info">
                This appointment is {STATUS_LABELS[appointment.status].toLowerCase()} and
                can no longer be changed. Book a new appointment instead.
              </div>
            ) : pending ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span className="hint">
                  Mark this appointment {STATUS_LABELS[pending].toLowerCase()}. A
                  reason is optional but shows up in the history and the
                  cancellation report.
                </span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Patient called to cancel"
                  aria-label="Reason"
                />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setPending(null)}
                    disabled={busy}
                  >
                    Back
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => applyStatus(pending, note.trim() || null)}
                    disabled={busy}
                  >
                    {busy ? 'Saving…' : `Confirm ${STATUS_LABELS[pending].toLowerCase()}`}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {allowed.map((status) => (
                  <button
                    key={status}
                    className={`btn btn-sm ${
                      NEEDS_REASON.includes(status) ? 'btn-danger' : 'btn-secondary'
                    }`}
                    onClick={() => requestStatus(status)}
                    disabled={busy}
                  >
                    Mark {STATUS_LABELS[status].toLowerCase()}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div>
          <h3 style={{ marginBottom: 12 }}>History</h3>
          <HistoryTimeline
            key={historyKey}
            appointmentId={appointment.id}
            staff={staff}
          />
        </div>
      </div>
    </Modal>
  )
}
