import React, { useCallback, useEffect, useState } from 'react'

import { api } from '../../api/client'
import type { Appointment, ReminderLogEntry, Report, Staff } from '../../api/types'
import { Bars, Meter } from '../../components/Bars'
import EmptyState from '../../components/EmptyState'
import ErrorAlert from '../../components/ErrorAlert'
import StatusBadge from '../../components/StatusBadge'
import { downloadCsv } from '../../lib/csv'
import {
  STATUS_LABELS,
  addDays,
  formatDate,
  formatDateShort,
  formatTime,
  todayInput,
} from '../../lib/datetime'

const TABS = [
  ['summary', 'Daily summary'],
  ['utilisation', 'Utilisation'],
  ['cancellations', 'Cancellations'],
  ['reminders', 'Reminders'],
]

/**
 * True while the two date inputs disagree.
 *
 * Editing "From" to a date after "To" is a normal intermediate state — the
 * user is halfway through choosing a range. Firing the request then would
 * bounce a 422 off the server and flash an error at someone who has done
 * nothing wrong, so the fetch waits until the range makes sense.
 */
type Range = { date_from: string; date_to: string; staff_id: string }

function rangeIsBackwards(range: Range) {
  return Boolean(range.date_from && range.date_to && range.date_from > range.date_to)
}

/**
 * The range the reports open on: last week through the next four weeks.
 *
 * A purely retrospective window (today-29 → today) is the wrong default for a
 * scheduler. A clinic's appointments are mostly *ahead* of today, so that
 * window reported 0 for every doctor while Find — which has no date filter —
 * listed them all, which reads as the two screens disagreeing rather than as a
 * date range excluding the data.
 */
function defaultRange() {
  const today = todayInput()
  return { date_from: addDays(today, -7), date_to: addDays(today, 28), staff_id: '' }
}

function hm(minutes: number) {
  if (minutes === null || minutes === undefined) return '—'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h ? `${h}h ${m}m` : `${m}m`
}

export default function Reports({ staff }: { staff: Staff[] }) {
  const [tab, setTab] = useState('summary')

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <div className="sub">Schedule summaries, utilisation and cancellations</div>
        </div>
      </div>

      <div className="report-tabs">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            className="tab"
            aria-current={tab === key ? 'page' : undefined}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'summary' && <DailySummary staff={staff} />}
      {tab === 'utilisation' && <Utilisation staff={staff} />}
      {tab === 'cancellations' && <Cancellations staff={staff} />}
      {tab === 'reminders' && <Reminders />}
    </div>
  )
}

/* --------------------------------------------------------- Daily summary */

function DailySummary({ staff }: { staff: Staff[] }) {
  const [date, setDate] = useState(todayInput())
  const [data, setData] = useState<Report | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await api.dailySummary({ date }))
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => {
    load()
  }, [load])

  function exportCsv() {
    downloadCsv(
      `daily-summary-${date}.csv`,
      [
        { label: 'Staff', get: (r: Report) => r.staff_name },
        { label: 'Role', get: (r: Report) => r.role },
        { label: 'Appointments', get: (r: Report) => r.total },
        ...Object.keys(STATUS_LABELS).map((s) => ({
          label: (STATUS_LABELS as Record<string, string>)[s],
          get: (r: Report) => r.counts[s],
        })),
        { label: 'Booked minutes', get: (r: Report) => r.booked_minutes },
        { label: 'Available minutes', get: (r: Report) => r.available_minutes ?? '' },
        { label: 'Utilisation %', get: (r: Report) => r.utilisation_pct ?? '' },
      ],
      data!.staff,
    )
  }

  return (
    <>
      <div className="toolbar">
        <div className="field">
          <label htmlFor="ds-date">Date</label>
          <input
            id="ds-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <button className="btn btn-secondary" onClick={() => setDate(addDays(date, -1))}>
          ‹ Previous
        </button>
        <button className="btn btn-secondary" onClick={() => setDate(addDays(date, 1))}>
          Next ›
        </button>
        <button className="btn btn-ghost" onClick={() => setDate(todayInput())}>
          Today
        </button>
        <div className="spacer" />
        <button
          className="btn btn-secondary"
          onClick={exportCsv}
          disabled={!data || data.staff.length === 0}
        >
          Export CSV
        </button>
      </div>

      <ErrorAlert error={error} />
      {loading && <div className="card loading">Loading…</div>}

      {data && !loading && (
        <>
          <p className="hint" style={{ marginTop: -8, marginBottom: 16 }}>
            {formatDate(date)}
          </p>

          <div className="stats">
            <Stat value={data.totals.total} label="Appointments" />
            <Stat value={hm(data.totals.booked_minutes)} label="Booked time" />
            <Stat
              value={
                data.totals.utilisation_pct === null
                  ? '—'
                  : `${data.totals.utilisation_pct}%`
              }
              label="Utilisation"
            />
            <Stat
              value={data.totals.counts.cancelled + data.totals.counts.no_show}
              label="Cancelled / no-show"
            />
          </div>

          {data.totals.partial_capacity && (
            <div className="alert alert-info" style={{ marginBottom: 16 }}>
              <div>
                Clinic-wide utilisation covers only staff with business hours set.
                Anyone without hours is unrestricted, so they have no capacity to
                measure against — set their hours under Settings to include them.
              </div>
            </div>
          )}

          <div className="section">
            <div className="section-head">
              <h2>Utilisation by staff member</h2>
            </div>
            {data.staff.length === 0 ? (
              <div className="card">
                <EmptyState mark="⚙️" title="No staff yet" />
              </div>
            ) : (
              <div className="card card-pad">
                <Bars
                  rows={data.staff.map((r: Report) => ({
                    key: r.staff_id,
                    label: r.staff_name,
                    sub: r.role,
                    value: r.utilisation_pct,
                    over: r.utilisation_pct > 100,
                    display:
                      r.utilisation_pct === null ? '' : `${r.utilisation_pct}%`,
                    valueSub: `${hm(r.booked_minutes)} of ${hm(r.available_minutes)}`,
                  }))}
                />
              </div>
            )}
          </div>

          <div className="section">
            <div className="section-head">
              <h2>Breakdown</h2>
            </div>
            <div className="card table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Staff</th>
                    <th>Total</th>
                    {Object.entries(STATUS_LABELS).map(([k, label]) => (
                      <th key={k}>{label}</th>
                    ))}
                    <th>Booked</th>
                    <th>Free</th>
                  </tr>
                </thead>
                <tbody>
                  {data.staff.map((r: Report) => (
                    <tr key={r.staff_id}>
                      <td>
                        <div className="cell-strong">{r.staff_name}</div>
                        <div className="cell-muted">{r.role}</div>
                      </td>
                      <td>{r.total}</td>
                      {Object.keys(STATUS_LABELS).map((k) => (
                        <td key={k} className={r.counts[k] ? '' : 'cell-muted'}>
                          {r.counts[k]}
                        </td>
                      ))}
                      <td>{hm(r.booked_minutes)}</td>
                      <td>
                        {r.free_minutes === null ? (
                          <span className="na">—</span>
                        ) : (
                          hm(r.free_minutes)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  )
}

/* ----------------------------------------------------------- Utilisation */

function Utilisation({ staff }: { staff: Staff[] }) {
  const [range, setRange] = useState<Range>(defaultRange)
  const [data, setData] = useState<Report | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)

  const backwards = rangeIsBackwards(range)

  const load = useCallback(async () => {
    if (rangeIsBackwards(range)) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      setData(await api.utilisation(range))
    } catch (err) {
      setError(err)
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => {
    load()
  }, [load])

  return (
    <>
      <RangeBar
        range={range}
        setRange={setRange}
        staff={staff}
        onExport={
          (data || undefined) &&
          (() =>
            downloadCsv(
              `utilisation-${range.date_from}-to-${range.date_to}.csv`,
              [
                { label: 'Staff', get: (r: Report) => r.staff_name },
                { label: 'Role', get: (r: Report) => r.role },
                { label: 'Appointments', get: (r: Report) => r.appointments },
                { label: 'Booked minutes', get: (r: Report) => r.booked_minutes },
                { label: 'Available minutes', get: (r: Report) => r.available_minutes ?? '' },
                { label: 'Free minutes', get: (r: Report) => r.free_minutes ?? '' },
                { label: 'Utilisation %', get: (r: Report) => r.utilisation_pct ?? '' },
              ],
              data!.staff,
            ))
        }
      />

      {backwards && <RangeHint />}
      <ErrorAlert error={error} />
      {loading && <div className="card loading">Loading…</div>}

      {data && !loading && !backwards && data.staff.length === 0 && (
        <div className="card">
          <EmptyState mark="⚙️" title="No staff yet">
            Add a staff member under Settings, then set their working hours to
            measure utilisation against.
          </EmptyState>
        </div>
      )}

      {data && !loading && !backwards && data.staff.length > 0 && (
        <>
          <div className="stats">
            <Stat value={data.days} label="Days" />
            <Stat value={data.totals.appointments} label="Appointments" />
            <Stat value={hm(data.totals.booked_minutes)} label="Booked time" />
            <Stat
              value={
                data.totals.utilisation_pct === null
                  ? '—'
                  : `${data.totals.utilisation_pct}%`
              }
              label="Utilisation"
            />
          </div>

          <div className="section">
            <div className="section-head">
              <h2>Utilisation by staff member</h2>
              <span className="hint">Booked time ÷ available hours</span>
            </div>
            <div className="card card-pad">
              <Bars
                rows={data.staff.map((r: Report) => ({
                  key: r.staff_id,
                  label: r.staff_name,
                  sub: r.role,
                  value: r.utilisation_pct,
                  over: r.utilisation_pct > 100,
                  display: r.utilisation_pct === null ? '' : `${r.utilisation_pct}%`,
                  valueSub: `${hm(r.booked_minutes)} of ${hm(r.available_minutes)}`,
                }))}
              />
            </div>
          </div>

          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Appointments</th>
                  <th>Booked</th>
                  <th>Available</th>
                  <th>Free</th>
                  <th style={{ minWidth: 150 }}>Utilisation</th>
                </tr>
              </thead>
              <tbody>
                {data.staff.map((r: Report) => (
                  <tr key={r.staff_id}>
                    <td>
                      <div className="cell-strong">{r.staff_name}</div>
                      <div className="cell-muted">{r.role}</div>
                    </td>
                    <td>{r.appointments}</td>
                    <td>{hm(r.booked_minutes)}</td>
                    <td>
                      {r.available_minutes === null ? (
                        <span className="na">not set</span>
                      ) : (
                        hm(r.available_minutes)
                      )}
                    </td>
                    <td>
                      {r.free_minutes === null ? (
                        <span className="na">—</span>
                      ) : (
                        hm(r.free_minutes)
                      )}
                    </td>
                    <td>
                      <Meter pct={r.utilisation_pct} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}

/* ---------------------------------------------------------- Cancellations */

function Cancellations({ staff }: { staff: Staff[] }) {
  const [range, setRange] = useState<Range>(defaultRange)
  const [data, setData] = useState<Report | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)

  const backwards = rangeIsBackwards(range)

  const load = useCallback(async () => {
    if (rangeIsBackwards(range)) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      setData(await api.cancellations(range))
    } catch (err) {
      setError(err)
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => {
    load()
  }, [load])

  return (
    <>
      <RangeBar
        range={range}
        setRange={setRange}
        staff={staff}
        onExport={
          (data || undefined) &&
          (() =>
            downloadCsv(
              `cancellations-${range.date_from}-to-${range.date_to}.csv`,
              [
                { label: 'Date', get: (r: Report) => r.starts_at.slice(0, 10) },
                { label: 'Time', get: (r: Report) => formatTime(r.starts_at) },
                { label: 'Patient', get: (r: Report) => r.patient_name },
                { label: 'Staff', get: (r: Report) => r.staff_name },
                { label: 'Service', get: (r: Report) => r.service_name },
                { label: 'Status', get: (r: Report) => (STATUS_LABELS as Record<string, string>)[r.status] },
                { label: 'Minutes lost', get: (r: Report) => r.duration_minutes },
              ],
              data!.recent,
            ))
        }
      />

      {backwards && <RangeHint />}
      <ErrorAlert error={error} />
      {loading && <div className="card loading">Loading…</div>}

      {data && !loading && !backwards && (
        <>
          <div className="stats">
            <Stat value={data.totals.total} label="Appointments" />
            <Stat value={data.totals.cancelled} label="Cancelled" />
            <Stat value={data.totals.no_show} label="No-shows" />
            <Stat
              value={
                data.totals.combined_rate_pct === null
                  ? '—'
                  : `${data.totals.combined_rate_pct}%`
              }
              label="Lost rate"
            />
            <Stat value={hm(data.totals.lost_minutes)} label="Time lost" />
          </div>

          {data.totals.total === 0 ? (
            <div className="card">
              <EmptyState mark="📭" title="No appointments in this range">
                Widen the dates to see cancellation figures.
              </EmptyState>
            </div>
          ) : (
            <>
              <div className="section">
                <div className="section-head">
                  <h2>By staff member</h2>
                  <span className="hint">Cancelled and no-show counted separately</span>
                </div>
                <div className="card table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Staff</th>
                        <th>Total</th>
                        <th>Cancelled</th>
                        <th>No-show</th>
                        <th>Lost rate</th>
                        <th>Time lost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.by_staff.map((r: Report) => (
                        <tr key={r.staff_id}>
                          <td className="cell-strong">{r.staff_name}</td>
                          <td>{r.total}</td>
                          <td>{r.cancelled}</td>
                          <td>{r.no_show}</td>
                          <td>{r.rate_pct === null ? '—' : `${r.rate_pct}%`}</td>
                          <td>{hm(r.lost_minutes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="section">
                <div className="section-head">
                  <h2>By service</h2>
                </div>
                <div className="card table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Service</th>
                        <th>Total</th>
                        <th>Cancelled</th>
                        <th>No-show</th>
                        <th>Lost rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.by_service.map((r: Report) => (
                        <tr key={r.service_id}>
                          <td className="cell-strong">{r.service_name}</td>
                          <td>{r.total}</td>
                          <td>{r.cancelled}</td>
                          <td>{r.no_show}</td>
                          <td>{r.rate_pct === null ? '—' : `${r.rate_pct}%`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {data.recent.length > 0 && (
                <div className="section">
                  <div className="section-head">
                    <h2>Recent cancellations and no-shows</h2>
                  </div>
                  <div className="card table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Time</th>
                          <th>Patient</th>
                          <th>Staff</th>
                          <th>Service</th>
                          <th>Status</th>
                          <th>Lost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.recent.map((r: Report) => (
                          <tr key={r.id}>
                            <td>{formatDateShort(r.starts_at)}</td>
                            <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                              {formatTime(r.starts_at)}
                            </td>
                            <td className="cell-strong">{r.patient_name}</td>
                            <td>{r.staff_name}</td>
                            <td>{r.service_name}</td>
                            <td>
                              <StatusBadge status={r.status} />
                            </td>
                            <td>{hm(r.duration_minutes)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </>
  )
}

/* --------------------------------------------------------------- Reminders */

const HOURS_MIN = 1
const HOURS_MAX = 720

/** Pull a typed number into the range the API accepts. */
function clampHours(n: number) {
  return Math.min(HOURS_MAX, Math.max(HOURS_MIN, Math.round(n)))
}

function Reminders() {
  // Two pieces of state, deliberately. `hoursText` is what the box shows and
  // may be mid-edit — including empty, which is what you get the instant you
  // select-all and start retyping. `withinHours` is the committed value the
  // API is asked about.
  //
  // Holding only the number broke the field: `Number('') || 1` turned an empty
  // box into 1, so clearing it to type "48" snapped it to 1 and the control
  // was stuck there. It also refetched on every keystroke, so typing "720"
  // queried 7, then 72, then 720.
  const [hoursText, setHoursText] = useState('24')
  const [withinHours, setWithinHours] = useState(24)
  const [due, setDue] = useState<Appointment[]>([])
  const [log, setLog] = useState<ReminderLogEntry[]>([])
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<Report | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [dueRows, logRows] = await Promise.all([
        api.dueReminders({ within_hours: withinHours }),
        api.reminderLog({ limit: 50 }),
      ])
      setDue(dueRows)
      setLog(logRows)
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [withinHours])

  useEffect(() => {
    load()
  }, [load])

  // Commit the typed value once it stops changing, so a half-typed "7" on the
  // way to "720" never reaches the API. An unparseable or empty box commits
  // nothing and leaves the last good value in force.
  useEffect(() => {
    const id = setTimeout(() => {
      const parsed = Number(hoursText)
      if (!hoursText.trim() || !Number.isFinite(parsed)) return
      setWithinHours(clampHours(parsed))
    }, 400)
    return () => clearTimeout(id)
  }, [hoursText])

  // Leaving the field tidies whatever is in it back to the committed value, so
  // an empty or out-of-range box never sits there contradicting the results.
  function normaliseHours() {
    const parsed = Number(hoursText)
    const next =
      !hoursText.trim() || !Number.isFinite(parsed) ? withinHours : clampHours(parsed)
    setHoursText(String(next))
    setWithinHours(next)
  }

  async function send() {
    setSending(true)
    setError(null)
    setResult(null)
    try {
      setResult(await api.dispatchReminders({ within_hours: withinHours }))
      await load()
    } catch (err) {
      setError(err)
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <div className="toolbar reminder-bar">
        <div className="reminder-row">
          <div className="field">
            <label htmlFor="rm-hours">Look ahead (hours)</label>
            <input
              id="rm-hours"
              type="number"
              min={HOURS_MIN}
              max={HOURS_MAX}
              value={hoursText}
              onChange={(e) => setHoursText(e.target.value)}
              onBlur={normaliseHours}
              aria-describedby="rm-hours-hint"
            />
          </div>
          <button className="btn btn-primary" onClick={send} disabled={sending || !due.length}>
            {sending ? 'Sending…' : `Send ${due.length} reminder${due.length === 1 ? '' : 's'}`}
          </button>
        </div>
        <span className="hint" id="rm-hours-hint">
          {withinHours === 24 ? 'Covers the next day' : `Covers the next ${withinHours} hours (max ${HOURS_MAX})`}
          {' · '}Delivery goes to the console sender; email or SMS drops in behind the same interface.
        </span>
      </div>

      <ErrorAlert error={error} />
      {result && (
        <div className="alert alert-info" style={{ marginBottom: 16 }}>
          <div>
            Considered {result.considered}, sent {result.sent}
            {result.failed > 0 && `, failed ${result.failed}`}.
          </div>
        </div>
      )}

      {loading ? (
        <div className="card loading">Loading…</div>
      ) : (
        <>
          <div className="section">
            <div className="section-head">
              <h2>Due reminders</h2>
              <span className="hint">
                Upcoming, still active, not yet reminded
              </span>
            </div>
            <div className="card table-wrap">
              {due.length === 0 ? (
                log.length === 0 ? (
                  // Nothing sent and nothing due means there is nothing to
                  // remind about, not that everyone has been reminded.
                  <EmptyState mark="📭" title="No upcoming appointments">
                    Nothing starts in the next {withinHours} hours. Widen the
                    window, or book an appointment from the Schedule tab.
                  </EmptyState>
                ) : (
                  <EmptyState mark="✅" title="Nothing due">
                    Every upcoming appointment in this window has had its
                    reminder.
                  </EmptyState>
                )
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Patient</th>
                      <th>Contact</th>
                      <th>Staff</th>
                      <th>Service</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {due.map((a) => (
                      <tr key={a.id}>
                        <td>
                          {formatDateShort(a.starts_at)}
                          <div className="cell-muted">{formatTime(a.starts_at)}</div>
                        </td>
                        <td className="cell-strong">{a.patient.full_name}</td>
                        <td className="cell-muted">
                          {a.patient.email || a.patient.phone}
                        </td>
                        <td>{a.staff.full_name}</td>
                        <td>{a.service.name}</td>
                        <td>
                          <StatusBadge status={a.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="section">
            <div className="section-head">
              <h2>Dispatch log</h2>
            </div>
            <div className="card table-wrap">
              {log.length === 0 ? (
                <EmptyState mark="📨" title="Nothing sent yet" />
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Sent</th>
                      <th>Appointment</th>
                      <th>Channel</th>
                      <th>Recipient</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {log.map((r: Report) => (
                      <tr key={r.id}>
                        <td>
                          {formatDateShort(r.sent_at)}
                          <div className="cell-muted">{formatTime(r.sent_at)}</div>
                        </td>
                        <td>#{r.appointment_id}</td>
                        <td>{r.channel}</td>
                        <td className="cell-muted">{r.recipient || '—'}</td>
                        <td>
                          <span
                            className={`badge badge-${
                              r.status === 'sent' ? 'confirmed' : 'cancelled'
                            }`}
                          >
                            {r.status === 'sent' ? 'Sent' : 'Failed'}
                          </span>
                          {r.detail && <div className="cell-muted">{r.detail}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}

/* ------------------------------------------------------------ Shared bits */

function RangeHint() {
  return (
    <div className="alert alert-info" style={{ marginBottom: 16 }}>
      <div>The “From” date is after the “To” date — pick an end date to continue.</div>
    </div>
  )
}

function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

function RangeBar({
  range,
  setRange,
  staff,
  onExport,
}: {
  range: Range
  setRange: React.Dispatch<React.SetStateAction<Range>>
  staff: Staff[]
  onExport?: () => void
}) {
  /**
   * Keep the range pointing forwards as it is edited.
   *
   * Moving "From" past "To" drags "To" with it rather than leaving a range
   * that cannot be run; moving "To" before "From" does the mirror. Without
   * this, a user who pushed the start date forward got a silently dead report
   * and no indication of which of the two fields was the problem.
   */
  const set = (key: keyof Range) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setRange((r: Range) => {
      const next = { ...r, [key]: e.target.value }
      if (!next.date_from || !next.date_to || next.date_from <= next.date_to) {
        return next
      }
      return key === 'date_from'
        ? { ...next, date_to: next.date_from }
        : { ...next, date_from: next.date_to }
    })

  // Past presets end today; `ahead` starts today. Reports about a schedule get
  // asked in both directions — "how did last month go" and "how full is the
  // month coming" — so both are one click.
  function preset(days: number, ahead = false) {
    const today = todayInput()
    setRange((r: Range) =>
      ahead
        ? { ...r, date_from: today, date_to: addDays(today, days - 1) }
        : { ...r, date_from: addDays(today, -(days - 1)), date_to: today },
    )
  }

  return (
    <div className="toolbar">
      {/* The two inputs bound each other, so the picker cannot offer a range
          that runs backwards: "To" starts at "From", and "From" stops at
          "To". Previously either could be dragged past the other, and the only
          sign was the results quietly refusing to update. The hint below still
          covers typed input, which ignores min/max. */}
      <div className="field">
        <label htmlFor="r-from">From</label>
        <input
          id="r-from"
          type="date"
          value={range.date_from}
          max={range.date_to || undefined}
          onChange={set('date_from')}
        />
      </div>
      <div className="field">
        <label htmlFor="r-to">To</label>
        <input
          id="r-to"
          type="date"
          value={range.date_to}
          min={range.date_from || undefined}
          onChange={set('date_to')}
        />
      </div>
      <div className="field">
        <label htmlFor="r-staff">Staff</label>
        <select id="r-staff" value={range.staff_id} onChange={set('staff_id')}>
          <option value="">All</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.full_name}
            </option>
          ))}
        </select>
      </div>
      <button className="btn btn-secondary btn-sm" onClick={() => preset(7)}>
        Past 7
      </button>
      <button className="btn btn-secondary btn-sm" onClick={() => preset(30)}>
        Past 30
      </button>
      <button className="btn btn-secondary btn-sm" onClick={() => preset(30, true)}>
        Next 30
      </button>
      <button className="btn btn-secondary btn-sm" onClick={() => setRange(defaultRange)}>
        Reset
      </button>
      <div className="spacer" />
      <button className="btn btn-secondary" onClick={onExport} disabled={!onExport}>
        Export CSV
      </button>
    </div>
  )
}
