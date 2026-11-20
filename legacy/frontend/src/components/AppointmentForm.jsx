import { useEffect, useMemo, useState } from 'react'

import { api, ApiError } from '../api/client.js'
import { nowInput } from '../lib/datetime.js'
import ErrorAlert from './ErrorAlert.jsx'
import Modal from './Modal.jsx'

const BLANK_PATIENT = { first_name: '', last_name: '', phone: '', email: '' }

/**
 * Book an appointment. Supports registering a new patient inline, since the
 * front desk usually meets the patient and the booking at the same moment.
 */
export default function AppointmentForm({
  staff,
  services,
  initialStart = '',
  initialStaffId = '',
  onClose,
  onCreated,
}) {
  const [patients, setPatients] = useState([])
  const [mode, setMode] = useState('existing') // existing | new
  const [newPatient, setNewPatient] = useState(BLANK_PATIENT)
  const [form, setForm] = useState({
    patient_id: '',
    staff_id: initialStaffId || '',
    service_id: '',
    starts_at: initialStart,
    reason: '',
  })
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.listPatients({ limit: 500 }).then(setPatients).catch(setError)
  }, [])

  useEffect(() => {
    // Preselect the only sensible defaults so the form is one click shorter.
    setForm((f) => ({
      ...f,
      staff_id: f.staff_id || staff[0]?.id || '',
      service_id: f.service_id || services[0]?.id || '',
    }))
  }, [staff, services])

  const selectedService = useMemo(
    () => services.find((s) => String(s.id) === String(form.service_id)),
    [services, form.service_id],
  )

  const endPreview = useMemo(() => {
    if (!form.starts_at || !selectedService) return null
    const [datePart, timePart] = form.starts_at.split('T')
    if (!timePart) return null
    const [h, m] = timePart.split(':').map(Number)
    const total = h * 60 + m + selectedService.duration_minutes
    const hh = String(Math.floor(total / 60) % 24).padStart(2, '0')
    const mm = String(total % 60).padStart(2, '0')
    return { time: `${hh}:${mm}`, crossesMidnight: total >= 1440, datePart }
  }, [form.starts_at, selectedService])

  // Computed once per mount: a form held open for an hour is not worth
  // re-rendering over, and the server makes the real decision on submit.
  const minStart = useMemo(() => nowInput(), [])
  const isPastStart = Boolean(form.starts_at) && form.starts_at < minStart

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const setPatientField = (key) => (e) =>
    setNewPatient((p) => ({ ...p, [key]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      let patientId = form.patient_id

      if (mode === 'new') {
        const created = await api.createPatient({
          first_name: newPatient.first_name.trim(),
          last_name: newPatient.last_name.trim(),
          phone: newPatient.phone.trim(),
          email: newPatient.email.trim() || null,
        })
        patientId = created.id
      }

      if (!patientId) {
        throw new ApiError(422, {
          code: 'validation_error',
          message: 'Choose a patient, or register a new one.',
        })
      }

      const appointment = await api.createAppointment({
        patient_id: Number(patientId),
        staff_id: Number(form.staff_id),
        service_id: Number(form.service_id),
        // datetime-local gives "YYYY-MM-DDTHH:MM"; the API wants seconds too.
        starts_at: `${form.starts_at}:00`,
        reason: form.reason.trim() || null,
      })
      onCreated(appointment)
    } catch (err) {
      setError(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="New appointment"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="appointment-form"
            className="btn btn-primary"
            disabled={saving || isPastStart}
          >
            {saving ? 'Booking…' : 'Book appointment'}
          </button>
        </>
      }
    >
      <form id="appointment-form" className="modal-body" onSubmit={submit}>
        <ErrorAlert error={error} />

        <div className="field">
          <label htmlFor="patient-mode">Patient</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              id="patient-mode"
              className={`btn btn-sm ${mode === 'existing' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setMode('existing')}
            >
              Existing
            </button>
            <button
              type="button"
              className={`btn btn-sm ${mode === 'new' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setMode('new')}
            >
              New patient
            </button>
          </div>
        </div>

        {mode === 'existing' ? (
          <div className="field">
            <label htmlFor="patient">Select patient</label>
            <select
              id="patient"
              value={form.patient_id}
              onChange={set('patient_id')}
              required
            >
              <option value="">Choose…</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.last_name}, {p.first_name} — {p.phone}
                </option>
              ))}
            </select>
            {patients.length === 0 && (
              <span className="hint">
                No patients yet — switch to “New patient”.
              </span>
            )}
          </div>
        ) : (
          <>
            <div className="field-row">
              <div className="field">
                <label htmlFor="fn">First name</label>
                <input
                  id="fn"
                  value={newPatient.first_name}
                  onChange={setPatientField('first_name')}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="ln">Last name</label>
                <input
                  id="ln"
                  value={newPatient.last_name}
                  onChange={setPatientField('last_name')}
                  required
                />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="ph">Phone</label>
                <input
                  id="ph"
                  value={newPatient.phone}
                  onChange={setPatientField('phone')}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="em">Email (optional)</label>
                <input
                  id="em"
                  type="email"
                  value={newPatient.email}
                  onChange={setPatientField('email')}
                />
              </div>
            </div>
          </>
        )}

        <div className="field-row">
          <div className="field">
            <label htmlFor="staff">Staff member</label>
            <select id="staff" value={form.staff_id} onChange={set('staff_id')} required>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="service">Service</label>
            <select
              id="service"
              value={form.service_id}
              onChange={set('service_id')}
              required
            >
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.duration_minutes} min)
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="starts">Starts at</label>
          <input
            id="starts"
            type="datetime-local"
            value={form.starts_at}
            onChange={set('starts_at')}
            // The browser's own floor on the picker, matching the rule the API
            // enforces. It is a convenience, not the guard: `min` is trivially
            // bypassed, so the server still refuses a past start.
            min={minStart}
            required
          />
          {isPastStart && (
            <span className="hint hint-warn">
              That time has already passed. Pick a later one — a visit that
              already happened is booked and then marked completed.
            </span>
          )}
          {endPreview && !isPastStart && (
            <span className="hint">
              Ends at {endPreview.time}
              {endPreview.crossesMidnight && ' the next day'} ·{' '}
              {selectedService.duration_minutes} minutes
            </span>
          )}
        </div>

        <div className="field">
          <label htmlFor="reason">Reason (optional)</label>
          <textarea id="reason" value={form.reason} onChange={set('reason')} />
        </div>
      </form>
    </Modal>
  )
}
