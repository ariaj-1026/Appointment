import { useState, type FormEvent } from 'react';

import { api } from '../api/client';
import type { Appointment, AppointmentStatus, Service, Staff } from '../api/types';
import { ALLOWED_TRANSITIONS, STATUS_LABELS, formatDateShort, formatTimeRange, nowInput, toLocalInput } from '../lib/datetime';
import ErrorAlert from './ErrorAlert';
import HistoryTimeline from './HistoryTimeline';
import Modal from './Modal';
import StatusBadge from './StatusBadge';

// Ending an appointment early is worth a reason; routine progress is not.
const NEEDS_REASON: AppointmentStatus[] = ['cancelled', 'no_show'];

/**
 * Appointment detail: status changes, rescheduling, and — for patient
 * requests — approve / decline.
 *
 * Only legal next statuses are offered, mirroring the backend's status
 * machine. When the patient booked online they get an email about any change
 * the clinic forces, so a reason is required for cancelling or moving.
 */
export default function AppointmentDetail({
  appointment,
  staff,
  services,
  onClose,
  onChanged,
  readOnly = false,
}: {
  appointment: Appointment;
  staff: Staff[];
  services: Service[];
  onClose: () => void;
  onChanged: (a: Appointment) => void;
  readOnly?: boolean;
}) {
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [pending, setPending] = useState<AppointmentStatus | 'decline' | null>(null); // awaiting a reason
  const [note, setNote] = useState('');
  // Bumped after every change so the timeline refetches.
  const [historyKey, setHistoryKey] = useState(0);
  const [move, setMove] = useState({
    starts_at: toLocalInput(appointment.starts_at),
    staff_id: String(appointment.staff_id),
    service_id: String(appointment.service_id),
    note: '',
  });

  const isRequest = appointment.status === 'pending';
  const hasAccount = appointment.patient.user_id !== null;
  const allowed = isRequest ? [] : ALLOWED_TRANSITIONS[appointment.status] ?? [];
  const isTerminal = !isRequest && allowed.length === 0;

  const minStart = nowInput();
  const movesToPast = Boolean(move.starts_at) && move.starts_at < minStart;

  // Deactivated staff/services are dropped from the move dialog (the API
  // refuses them), except the appointment's own current ones — otherwise the
  // dropdown would silently show someone else and quietly reassign it.
  const keepCurrent = <T extends { id: number; is_active: boolean }>(rows: T[], currentId: number) =>
    rows.filter((r) => r.is_active || r.id === currentId);
  const bookableStaff = keepCurrent(staff, appointment.staff_id);
  const bookableServices = keepCurrent(services, appointment.service_id);

  const reasonRequired = (target: AppointmentStatus | 'decline') =>
    target === 'decline' || (hasAccount && target === 'cancelled');

  function requestStatus(status: AppointmentStatus | 'decline') {
    if (status === 'decline' || NEEDS_REASON.includes(status)) {
      setPending(status);
      setNote('');
      return;
    }
    void applyStatus(status);
  }

  async function run(action: () => Promise<Appointment>) {
    setError(null);
    setBusy(true);
    try {
      const updated = await action();
      setPending(null);
      setNote('');
      setRescheduling(false);
      setHistoryKey((k) => k + 1);
      onChanged(updated);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const applyStatus = (status: AppointmentStatus | 'decline', reason: string | null = null) =>
    run(() =>
      status === 'decline'
        ? api.decline(appointment.id, reason ?? '')
        : status === 'scheduled' && isRequest
          ? api.approve(appointment.id, reason)
          : api.updateStatus(appointment.id, status, reason),
    );

  function submitReschedule(e: FormEvent) {
    e.preventDefault();
    void run(() =>
      api.reschedule(appointment.id, {
        starts_at: move.starts_at,
        staff_id: Number(move.staff_id),
        service_id: Number(move.service_id),
        note: move.note.trim() || null,
      }),
    );
  }

  const pendingLabel = pending === 'decline' ? 'decline' : pending ? STATUS_LABELS[pending].toLowerCase() : '';

  return (
    <Modal
      title={`${appointment.patient.full_name} · ${formatTimeRange(appointment.starts_at, appointment.ends_at)}`}
      onClose={onClose}
      footer={
        <>
          {!readOnly && !isTerminal && !rescheduling && (
            <button className="btn btn-secondary" onClick={() => setRescheduling(true)} disabled={busy}>
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

        {isRequest && (
          <div className="alert alert-info">
            Requested online by the patient. It holds this slot until you approve or decline it; the patient is
            emailed either way.
          </div>
        )}

        <dl className="detail-list">
          <dt>Status</dt>
          <dd>
            <StatusBadge status={appointment.status} />
            {appointment.booked_via === 'patient' && <span className="tag">Booked online</span>}
          </dd>

          <dt>When</dt>
          <dd>
            {formatDateShort(appointment.starts_at)}, {formatTimeRange(appointment.starts_at, appointment.ends_at)} (
            {appointment.duration_minutes} min)
          </dd>

          <dt>Patient</dt>
          <dd>
            {appointment.patient.full_name}
            <div className="cell-muted">
              {appointment.patient.phone || 'no phone'}
              {appointment.patient.email ? ` · ${appointment.patient.email}` : ''}
              {hasAccount ? ' · has online account' : ''}
            </div>
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
          {appointment.decision_reason && (
            <>
              <dt>Decision note</dt>
              <dd>{appointment.decision_reason}</dd>
            </>
          )}
        </dl>

        {readOnly ? null : rescheduling ? (
          <form onSubmit={submitReschedule} className="stack">
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
                <span className="hint hint-warn">That time has already passed. An appointment can only be moved forward.</span>
              )}
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="new-staff">Staff member</label>
                <select id="new-staff" value={move.staff_id} onChange={(e) => setMove((m) => ({ ...m, staff_id: e.target.value }))}>
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
                <select id="new-service" value={move.service_id} onChange={(e) => setMove((m) => ({ ...m, service_id: e.target.value }))}>
                  {bookableServices.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.duration_minutes} min)
                      {s.is_active ? '' : ' — deactivated'}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="move-note">Reason {hasAccount ? '(sent to the patient)' : '(optional)'}</label>
              <textarea
                id="move-note"
                value={move.note}
                onChange={(e) => setMove((m) => ({ ...m, note: e.target.value }))}
                placeholder="e.g. Doctor called away for an emergency"
                required={hasAccount}
              />
            </div>
            <div className="row-end">
              <button type="button" className="btn btn-ghost" onClick={() => setRescheduling(false)}>
                Back
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy || movesToPast}>
                {busy ? 'Moving…' : 'Confirm move'}
              </button>
            </div>
          </form>
        ) : (
          <div className="field">
            <label>{isRequest ? 'Decision' : 'Change status'}</label>
            {isTerminal ? (
              <div className="alert alert-info">
                This appointment is {STATUS_LABELS[appointment.status].toLowerCase()} and can no longer be changed. Book a
                new appointment instead.
              </div>
            ) : pending ? (
              <div className="stack-sm">
                <span className="hint">
                  {pending === 'decline'
                    ? 'Tell the patient why — this is included in the email they receive.'
                    : reasonRequired(pending)
                      ? 'This patient booked online and will be emailed. A reason is required.'
                      : `Mark this appointment ${pendingLabel}. A reason is optional but shows up in the history and the cancellation report.`}
                </span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={pending === 'decline' ? 'e.g. Doctor is on leave that day' : 'e.g. Patient called to cancel'}
                  aria-label="Reason"
                />
                <div className="row-end">
                  <button className="btn btn-ghost btn-sm" onClick={() => setPending(null)} disabled={busy}>
                    Back
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => applyStatus(pending, note.trim() || null)}
                    disabled={busy || (reasonRequired(pending) && !note.trim())}
                  >
                    {busy ? 'Saving…' : `Confirm ${pendingLabel}`}
                  </button>
                </div>
              </div>
            ) : isRequest ? (
              <div className="row-wrap">
                <button className="btn btn-primary btn-sm" onClick={() => applyStatus('scheduled')} disabled={busy}>
                  Approve
                </button>
                <button className="btn btn-danger btn-sm" onClick={() => requestStatus('decline')} disabled={busy}>
                  Decline
                </button>
              </div>
            ) : (
              <div className="row-wrap">
                {allowed.map((status) => (
                  <button
                    key={status}
                    className={`btn btn-sm ${NEEDS_REASON.includes(status) ? 'btn-danger' : 'btn-secondary'}`}
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
          <HistoryTimeline key={historyKey} appointmentId={appointment.id} staff={staff} />
        </div>
      </div>
    </Modal>
  );
}
