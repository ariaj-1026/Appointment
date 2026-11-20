import { useEffect, useMemo, useState, type FormEvent } from 'react'

import { api } from '../../api/client'
import type { Service, Staff } from '../../api/types'
import EmptyState from '../../components/EmptyState'
import ErrorAlert from '../../components/ErrorAlert'
import { WEEKDAYS } from '../../lib/datetime'

type Reload = () => Promise<void> | void
type Win = { opens_at: string; closes_at: string }

export default function Settings({ staff, services, reload }: { staff: Staff[]; services: Service[]; reload: Reload }) {
  const [tab, setTab] = useState('staff')

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <div className="sub">Staff, services and working hours</div>
        </div>
        <div className="spacer" />
        <div className="tabs">
          {[
            ['staff', 'Staff'],
            ['services', 'Services'],
            ['hours', 'Business hours'],
          ].map(([key, label]) => (
            <button
              key={key}
              className="tab"
              aria-current={tab === key ? 'page' : undefined}
              onClick={() => setTab(key!)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'staff' && <StaffPanel staff={staff} reload={reload} />}
      {tab === 'services' && <ServicesPanel services={services} reload={reload} />}
      {tab === 'hours' && <HoursPanel staff={staff} reload={reload} />}
    </div>
  )
}

/* ------------------------------------------------------------------ Staff */

function StaffPanel({ staff, reload }: { staff: Staff[]; reload: Reload }) {
  const [form, setForm] = useState({ full_name: '', role: '' })
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  async function add(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await api.createStaff({
        full_name: form.full_name.trim(),
        role: form.role.trim(),
      })
      setForm({ full_name: '', role: '' })
      await reload()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  async function toggle(member: Staff) {
    setError(null)
    try {
      await api.updateStaff(member.id, { is_active: !member.is_active })
      await reload()
    } catch (err) {
      setError(err)
    }
  }

  return (
    <>
      <ErrorAlert error={error} />
      <form className="toolbar" onSubmit={add}>
        <div className="field" style={{ flex: '1 1 200px' }}>
          <label htmlFor="s-name">Full name</label>
          <input
            id="s-name"
            value={form.full_name}
            onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
            placeholder="Dr. Maria Ilagan"
            required
          />
        </div>
        <div className="field" style={{ flex: '1 1 180px' }}>
          <label htmlFor="s-role">Role</label>
          <input
            id="s-role"
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
            placeholder="General Physician"
            required
          />
        </div>
        <button className="btn btn-primary" disabled={busy}>
          Add staff
        </button>
      </form>

      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {staff.length === 0 && (
              <tr>
                <td colSpan={4} className="cell-muted">
                  No staff yet.
                </td>
              </tr>
            )}
            {staff.map((m) => (
              <tr key={m.id}>
                <td className="cell-strong">{m.full_name}</td>
                <td>{m.role}</td>
                <td>
                  <span className={`badge badge-${m.is_active ? 'confirmed' : 'completed'}`}>
                    {m.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td>
                  <div className="row-actions">
                    <button className="btn btn-secondary btn-sm" onClick={() => toggle(m)}>
                      {m.is_active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ marginTop: 12 }}>
        Deactivating hides a staff member from new bookings. Their existing
        appointments are left untouched.
      </p>
    </>
  )
}

/* --------------------------------------------------------------- Services */

function ServicesPanel({ services, reload }: { services: Service[]; reload: Reload }) {
  const [form, setForm] = useState<{ name: string; duration_minutes: number | string; description: string }>({ name: '', duration_minutes: 30, description: '' })
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  async function add(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await api.createService({
        name: form.name.trim(),
        duration_minutes: Number(form.duration_minutes),
        description: form.description.trim() || null,
      })
      setForm({ name: '', duration_minutes: 30, description: '' })
      await reload()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  async function toggle(service: Service) {
    setError(null)
    try {
      await api.updateService(service.id, { is_active: !service.is_active })
      await reload()
    } catch (err) {
      setError(err)
    }
  }

  return (
    <>
      <ErrorAlert error={error} />
      <form className="toolbar" onSubmit={add}>
        <div className="field" style={{ flex: '1 1 180px' }}>
          <label htmlFor="sv-name">Service name</label>
          <input
            id="sv-name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="General Consultation"
            required
          />
        </div>
        <div className="field" style={{ maxWidth: 130 }}>
          <label htmlFor="sv-dur">Minutes</label>
          <input
            id="sv-dur"
            type="number"
            min={5}
            max={600}
            step={5}
            value={form.duration_minutes}
            onChange={(e) =>
              setForm((f) => ({ ...f, duration_minutes: e.target.value }))
            }
            required
          />
        </div>
        <div className="field" style={{ flex: '1 1 200px' }}>
          <label htmlFor="sv-desc">Description</label>
          <input
            id="sv-desc"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </div>
        <button className="btn btn-primary" disabled={busy}>
          Add service
        </button>
      </form>

      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Service</th>
              <th>Duration</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {services.length === 0 && (
              <tr>
                <td colSpan={4} className="cell-muted">
                  No services yet.
                </td>
              </tr>
            )}
            {services.map((s) => (
              <tr key={s.id}>
                <td>
                  <div className="cell-strong">{s.name}</div>
                  {s.description && <div className="cell-muted">{s.description}</div>}
                </td>
                <td>{s.duration_minutes} min</td>
                <td>
                  <span className={`badge badge-${s.is_active ? 'confirmed' : 'completed'}`}>
                    {s.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td>
                  <div className="row-actions">
                    <button className="btn btn-secondary btn-sm" onClick={() => toggle(s)}>
                      {s.is_active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ marginTop: 12 }}>
        Changing a duration affects future bookings only — appointments already
        booked keep the end time they were given.
      </p>
    </>
  )
}

/* ---------------------------------------------------------- Business hours */

const DEFAULT_WINDOW = { opens_at: '09:00', closes_at: '17:00' }
const DEFAULT_SECOND_WINDOW = { opens_at: '13:00', closes_at: '17:00' }

/**
 * Weekly hours editor.
 *
 * Each day holds a list of windows rather than a single pair, so a split
 * shift — morning, lunch break, afternoon — round-trips instead of being
 * flattened to its outer bounds. An empty list means the day is closed.
 */
function HoursPanel({ staff, reload }: { staff: Staff[]; reload: Reload }) {
  const [staffId, setStaffId] = useState(staff[0]?.id ? String(staff[0].id) : '')
  const [days, setDays] = useState<Win[][]>(() => WEEKDAYS.map(() => []))
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!staffId) return
    setLoading(true)
    setError(null)
    setSaved(false)
    api
      .getBusinessHours(Number(staffId))
      .then((windows) => {
        const next: Win[][] = WEEKDAYS.map(() => [])
        for (const w of windows) {
          next[w.weekday]!.push({
            opens_at: w.opens_at.slice(0, 5),
            closes_at: w.closes_at.slice(0, 5),
          })
        }
        for (const list of next) list.sort((a, b) => a.opens_at.localeCompare(b.opens_at))
        setDays(next)
      })
      .catch(setError)
      .finally(() => setLoading(false))
  }, [staffId])

  /** Overlaps within a day, flagged before the server has to reject them. */
  const problems = useMemo(() => {
    const out: Record<number, string> = {}
    days.forEach((list, weekday) => {
      const sorted = [...list].sort((a, b) => a.opens_at.localeCompare(b.opens_at))
      for (const w of sorted) {
        if (w.opens_at >= w.closes_at) {
          out[weekday] = 'A window must open before it closes.'
          return
        }
      }
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i]!.opens_at < sorted[i - 1]!.closes_at) {
          out[weekday] = 'Windows on the same day cannot overlap.'
          return
        }
      }
    })
    return out
  }, [days])

  const hasProblems = Object.keys(problems).length > 0

  function setDay(weekday: number, next: Win[]) {
    setDays((ds) => ds.map((d, i) => (i === weekday ? next : d)))
    setSaved(false)
  }

  function toggleDay(weekday: number, on: boolean) {
    setDay(weekday, on ? [{ ...DEFAULT_WINDOW }] : [])
  }

  function addWindow(weekday: number) {
    const list = days[weekday]!
    const last = list[list.length - 1]
    // Start the new window after the previous one so the default is valid.
    const seed = last
      ? { opens_at: last.closes_at, closes_at: DEFAULT_SECOND_WINDOW.closes_at }
      : { ...DEFAULT_WINDOW }
    setDay(weekday, [...list, seed])
  }

  function updateWindow(weekday: number, index: number, patch: Partial<Win>) {
    setDay(
      weekday,
      days[weekday]!.map((w, i) => (i === index ? { ...w, ...patch } : w)),
    )
  }

  function removeWindow(weekday: number, index: number) {
    setDay(
      weekday,
      days[weekday]!.filter((_, i) => i !== index),
    )
  }

  async function save() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const payload: { weekday: number; opens_at: string; closes_at: string }[] = []
      days.forEach((list, weekday) => {
        for (const w of list) {
          payload.push({
            weekday,
            opens_at: `${w.opens_at}:00`,
            closes_at: `${w.closes_at}:00`,
          })
        }
      })
      await api.putBusinessHours(Number(staffId), payload)
      setSaved(true)
      await reload()
    } catch (err) {
      setError(err)
    } finally {
      setSaving(false)
    }
  }

  if (staff.length === 0) {
    return (
      <div className="card">
        <EmptyState mark="👩‍⚕️" title="No staff yet">
          Add a staff member before setting working hours.
        </EmptyState>
      </div>
    )
  }

  return (
    <>
      <ErrorAlert error={error} />

      <div className="toolbar">
        <div className="field" style={{ flex: '1 1 240px' }}>
          <label htmlFor="h-staff">Staff member</label>
          <select id="h-staff" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name} — {s.role}
              </option>
            ))}
          </select>
        </div>
        <button
          className="btn btn-primary"
          onClick={save}
          disabled={saving || loading || hasProblems}
        >
          {saving ? 'Saving…' : 'Save hours'}
        </button>
        {saved && (
          <span className="hint" style={{ color: 'var(--color-success)' }}>
            Hours saved.
          </span>
        )}
        {hasProblems && (
          <span className="hint" style={{ color: 'var(--color-danger)' }}>
            Fix the highlighted days first.
          </span>
        )}
      </div>

      <div className="card card-pad">
        {loading ? (
          <div className="loading">Loading hours…</div>
        ) : (
          <div className="hours-grid">
            {WEEKDAYS.map((day, weekday) => {
              const list = days[weekday]!
              const open = list.length > 0
              return (
                <div
                  className={`hours-day-block ${open ? '' : 'off'}`}
                  key={day}
                  style={{ background: weekday % 2 ? 'var(--color-surface)' : undefined }}
                >
                  <div className="hours-day">
                    <input
                      type="checkbox"
                      id={`day-${weekday}`}
                      checked={open}
                      onChange={(e) => toggleDay(weekday, e.target.checked)}
                      style={{ width: 16, minHeight: 16 }}
                    />
                    <label
                      htmlFor={`day-${weekday}`}
                      style={{ textTransform: 'none', fontSize: 14, letterSpacing: 0 }}
                    >
                      {day}
                    </label>
                    {!open && <span className="hint">Closed</span>}
                  </div>

                  {open && (
                    <div className="hours-windows">
                      {list.map((w, index) => (
                        <div className="hours-window" key={index}>
                          <input
                            type="time"
                            value={w.opens_at}
                            onChange={(e) =>
                              updateWindow(weekday, index, { opens_at: e.target.value })
                            }
                            aria-label={`${day} window ${index + 1} opening time`}
                          />
                          <span className="hours-dash">–</span>
                          <input
                            type="time"
                            value={w.closes_at}
                            onChange={(e) =>
                              updateWindow(weekday, index, { closes_at: e.target.value })
                            }
                            aria-label={`${day} window ${index + 1} closing time`}
                          />
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => removeWindow(weekday, index)}
                            aria-label={`Remove ${day} window ${index + 1}`}
                            disabled={list.length === 1}
                            title={
                              list.length === 1
                                ? 'Untick the day to close it'
                                : 'Remove this window'
                            }
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => addWindow(weekday)}
                      >
                        + Add window
                      </button>
                      {problems[weekday] && (
                        <span className="hours-problem">{problems[weekday]}</span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <p className="hint" style={{ marginTop: 12 }}>
        A staff member with no days ticked is unrestricted and can be booked at
        any time. Add a second window to a day to express a split shift — the
        gap between windows is closed, so a 12:00–13:00 lunch break is two
        windows, not one. Saving replaces their whole week; existing
        appointments are never moved.
      </p>
    </>
  )
}
