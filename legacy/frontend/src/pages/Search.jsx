import { useEffect, useState } from 'react'

import { api } from '../api/client.js'
import AppointmentDetail from '../components/AppointmentDetail.jsx'
import EmptyState from '../components/EmptyState.jsx'
import ErrorAlert from '../components/ErrorAlert.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import { STATUS_LABELS, formatDateShort, formatTimeRange } from '../lib/datetime.js'

const BLANK = {
  q: '',
  staff_id: '',
  service_id: '',
  status: '',
  date_from: '',
  date_to: '',
}

export default function Search({ staff, services }) {
  const [filters, setFilters] = useState(BLANK)
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  // Whether the last run actually narrowed anything. An empty result with no
  // filters means the clinic has no appointments yet — telling someone to
  // "widen the date range" there sends them looking for a problem that is not
  // theirs.
  const [filtered, setFiltered] = useState(false)
  const [selected, setSelected] = useState(null)

  async function run(e) {
    e?.preventDefault()
    setLoading(true)
    setError(null)
    try {
      setResults(await api.searchAppointments(filters))
      setFiltered(Object.values(filters).some((v) => v !== ''))
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }

  // Show something useful on first open rather than an empty table.
  useEffect(() => {
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The two date filters bound each other, so a range can never run backwards:
  // dragging one past the other carries it along instead of producing a filter
  // that matches nothing and looks like missing data.
  const set = (key) => (e) =>
    setFilters((f) => {
      const next = { ...f, [key]: e.target.value }
      if (!next.date_from || !next.date_to || next.date_from <= next.date_to) {
        return next
      }
      return key === 'date_from'
        ? { ...next, date_to: next.date_from }
        : { ...next, date_from: next.date_to }
    })

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Find appointments</h1>
          <div className="sub">Search by patient, staff, service, status or date</div>
        </div>
      </div>

      <form className="toolbar" onSubmit={run}>
        <div className="field" style={{ flex: '1 1 220px' }}>
          <label htmlFor="q">Patient name or phone</label>
          <input id="q" value={filters.q} onChange={set('q')} placeholder="e.g. Cruz" />
        </div>
        <div className="field">
          <label htmlFor="f-staff">Staff</label>
          <select id="f-staff" value={filters.staff_id} onChange={set('staff_id')}>
            <option value="">Any</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-service">Service</label>
          <select id="f-service" value={filters.service_id} onChange={set('service_id')}>
            <option value="">Any</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-status">Status</label>
          <select id="f-status" value={filters.status} onChange={set('status')}>
            <option value="">Any</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-from">From</label>
          <input
            id="f-from"
            type="date"
            value={filters.date_from}
            max={filters.date_to || undefined}
            onChange={set('date_from')}
          />
        </div>
        <div className="field">
          <label htmlFor="f-to">To</label>
          <input
            id="f-to"
            type="date"
            value={filters.date_to}
            min={filters.date_from || undefined}
            onChange={set('date_to')}
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? 'Searching…' : 'Search'}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            setFilters(BLANK)
            setResults([])
            setFiltered(false)
          }}
        >
          Clear
        </button>
      </form>

      {error && <ErrorAlert error={error} />}

      <div className="card">
        {loading ? (
          <div className="loading">Searching…</div>
        ) : results.length === 0 ? (
          <EmptyState
            mark={filtered ? '🔍' : '📋'}
            title={filtered ? 'No matching appointments' : 'No appointments yet'}
          >
            {filtered
              ? 'Try widening the date range or clearing some filters.'
              : 'Book one from the Schedule tab.'}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Patient</th>
                  <th>Staff</th>
                  <th>Service</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {results.map((a) => (
                  <tr key={a.id}>
                    <td>{formatDateShort(a.starts_at)}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatTimeRange(a.starts_at, a.ends_at)}
                    </td>
                    <td>
                      <div className="cell-strong">{a.patient.full_name}</div>
                      <div className="cell-muted">{a.patient.phone}</div>
                    </td>
                    <td>{a.staff.full_name}</td>
                    <td>
                      {a.service.name}
                      <div className="cell-muted">{a.duration_minutes} min</div>
                    </td>
                    <td>
                      <StatusBadge status={a.status} />
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => setSelected(a)}
                        >
                          Open
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {results.length > 0 && (
        <p className="hint" style={{ marginTop: 12 }}>
          {results.length} appointment{results.length === 1 ? '' : 's'}, newest first.
        </p>
      )}

      {selected && (
        <AppointmentDetail
          appointment={selected}
          staff={staff}
          services={services}
          onClose={() => setSelected(null)}
          onChanged={(updated) => {
            setSelected(updated)
            setResults((rs) => rs.map((r) => (r.id === updated.id ? updated : r)))
          }}
        />
      )}
    </div>
  )
}
