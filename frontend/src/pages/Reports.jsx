import { useCallback, useEffect, useState } from 'react'

import { api } from '../api/client.js'
import { Bars, Meter } from '../components/Bars.jsx'
import EmptyState from '../components/EmptyState.jsx'
import ErrorAlert from '../components/ErrorAlert.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import { downloadCsv } from '../lib/csv.js'
import {
  STATUS_LABELS,
  addDays,
  formatDate,
  formatDateShort,
  formatTime,
  todayInput,
} from '../lib/datetime.js'

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
function rangeIsBackwards(range) {
  return Boolean(range.date_from && range.date_to && range.date_from > range.date_to)
}

function hm(minutes) {
  if (minutes === null || minutes === undefined) return '—'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h ? `${h}h ${m}m` : `${m}m`
}

export default function Reports({ staff }) {
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

function DailySummary({ staff }) {
  const [date, setDate] = useState(todayInput())
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
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
        { label: 'Staff', get: (r) => r.staff_name },
        { label: 'Role', get: (r) => r.role },
        { label: 'Appointments', get: (r) => r.total },
        ...Object.keys(STATUS_LABELS).map((s) => ({
          label: STATUS_LABELS[s],
          get: (r) => r.counts[s],
        })),
        { label: 'Booked minutes', get: (r) => r.booked_minutes },
        { label: 'Available minutes', get: (r) => r.available_minutes ?? '' },
        { label: 'Utilisation %', get: (r) => r.utilisation_pct ?? '' },
      ],
      data.staff,
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

      {error && <ErrorAlert error={error} />}
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
                  rows={data.staff.map((r) => ({
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
                  {data.staff.map((r) => (
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

function Utilisation({ staff }) {
  const [range, setRange] = useState(() => ({
    date_from: addDays(todayInput(), -29),
    date_to: todayInput(),
    staff_id: '',
  }))
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
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
          data &&
          (() =>
            downloadCsv(
              `utilisation-${range.date_from}-to-${range.date_to}.csv`,
              [
                { label: 'Staff', get: (r) => r.staff_name },
                { label: 'Role', get: (r) => r.role },
                { label: 'Appointments', get: (r) => r.appointments },
                { label: 'Booked minutes', get: (r) => r.booked_minutes },
                { label: 'Available minutes', get: (r) => r.available_minutes ?? '' },
                { label: 'Free minutes', get: (r) => r.free_minutes ?? '' },
                { label: 'Utilisation %', get: (r) => r.utilisation_pct ?? '' },
              ],
              data.staff,
            ))
        }
      />

      {backwards && <RangeHint />}
      {error && <ErrorAlert error={error} />}
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
                rows={data.staff.map((r) => ({
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
                {data.staff.map((r) => (
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

function Cancellations({ staff }) {
  const [range, setRange] = useState(() => ({
    date_from: addDays(todayInput(), -29),
    date_to: todayInput(),
    staff_id: '',
  }))
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
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
          data &&
          (() =>
            downloadCsv(
              `cancellations-${range.date_from}-to-${range.date_to}.csv`,
              [
                { label: 'Date', get: (r) => r.starts_at.slice(0, 10) },
                { label: 'Time', get: (r) => formatTime(r.starts_at) },
                { label: 'Patient', get: (r) => r.patient_name },
                { label: 'Staff', get: (r) => r.staff_name },
                { label: 'Service', get: (r) => r.service_name },
                { label: 'Status', get: (r) => STATUS_LABELS[r.status] },
                { label: 'Minutes lost', get: (r) => r.duration_minutes },
              ],
              data.recent,
            ))
        }
      />

      {backwards && <RangeHint />}
      {error && <ErrorAlert error={error} />}
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
                      {data.by_staff.map((r) => (
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
                      {data.by_service.map((r) => (
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
                        {data.recent.map((r) => (
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

function Reminders() {
  const [withinHours, setWithinHours] = useState(24)
  const [due, setDue] = useState([])
  const [log, setLog] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)

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
      <div className="toolbar">
        <div className="field" style={{ maxWidth: 160 }}>
          <label htmlFor="rm-hours">Look ahead (hours)</label>
          <input
            id="rm-hours"
            type="number"
            min={1}
            max={720}
            value={withinHours}
            onChange={(e) => setWithinHours(Number(e.target.value) || 1)}
          />
        </div>
        <button className="btn btn-primary" onClick={send} disabled={sending || !due.length}>
          {sending ? 'Sending…' : `Send ${due.length} reminder${due.length === 1 ? '' : 's'}`}
        </button>
        <span className="hint">
          Delivery goes to the console sender; email or SMS drops in behind the
          same interface.
        </span>
      </div>

      {error && <ErrorAlert error={error} />}
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
                    {log.map((r) => (
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

function Stat({ value, label }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

function RangeBar({ range, setRange, staff, onExport }) {
  const set = (key) => (e) => setRange((r) => ({ ...r, [key]: e.target.value }))

  function preset(days) {
    const today = todayInput()
    setRange((r) => ({ ...r, date_from: addDays(today, -(days - 1)), date_to: today }))
  }

  return (
    <div className="toolbar">
      <div className="field">
        <label htmlFor="r-from">From</label>
        <input id="r-from" type="date" value={range.date_from} onChange={set('date_from')} />
      </div>
      <div className="field">
        <label htmlFor="r-to">To</label>
        <input id="r-to" type="date" value={range.date_to} onChange={set('date_to')} />
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
        7 days
      </button>
      <button className="btn btn-secondary btn-sm" onClick={() => preset(30)}>
        30 days
      </button>
      <div className="spacer" />
      <button className="btn btn-secondary" onClick={onExport} disabled={!onExport}>
        Export CSV
      </button>
    </div>
  )
}
