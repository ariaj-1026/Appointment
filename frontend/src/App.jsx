import { useCallback, useEffect, useState } from 'react'

import { api } from './api/client.js'
import ErrorAlert from './components/ErrorAlert.jsx'
import Reports from './pages/Reports.jsx'
import Schedule from './pages/Schedule.jsx'
import Search from './pages/Search.jsx'
import Settings from './pages/Settings.jsx'

const TABS = [
  ['schedule', 'Schedule'],
  ['search', 'Find'],
  ['reports', 'Reports'],
  ['settings', 'Settings'],
]

export default function App() {
  const [tab, setTab] = useState('schedule')

  // Staff, services and hours are small, change rarely and are needed by every
  // page, so they are loaded once here and passed down.
  const [staff, setStaff] = useState([])
  const [services, setServices] = useState([])
  const [hoursByStaff, setHoursByStaff] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const loadRefs = useCallback(async () => {
    setError(null)
    try {
      const [staffRows, serviceRows] = await Promise.all([
        api.listStaff({ include_inactive: true }),
        api.listServices({ include_inactive: true }),
      ])
      setStaff(staffRows)
      setServices(serviceRows)

      const hourSets = await Promise.all(
        staffRows.map((s) => api.getBusinessHours(s.id).catch(() => [])),
      )
      setHoursByStaff(
        Object.fromEntries(staffRows.map((s, i) => [s.id, hourSets[i]])),
      )
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadRefs()
  }, [loadRefs])

  // Everything is fetched including inactive rows, because Find, Reports and
  // Settings all have to show a departed doctor's past work. Only the places
  // that *start* something new are narrowed to the active set: offering a
  // deactivated staff member in the booking form invited a rejection the user
  // could not have predicted from the dropdown.
  const activeStaff = staff.filter((s) => s.is_active)
  const activeServices = services.filter((s) => s.is_active)

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            🗓
          </span>
          Clinic Scheduling
        </div>
        <nav className="tabs">
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
        </nav>
      </header>

      {loading ? (
        <div className="page loading">Loading…</div>
      ) : error ? (
        <div className="page">
          <ErrorAlert error={error} />
          <button className="btn btn-primary" onClick={loadRefs} style={{ marginTop: 16 }}>
            Try again
          </button>
        </div>
      ) : (
        <>
          {tab === 'schedule' && (
            <Schedule
              staff={staff}
              services={activeServices}
              hoursByStaff={hoursByStaff}
              reloadRefs={loadRefs}
            />
          )}
          {tab === 'search' && <Search staff={staff} services={services} />}
          {tab === 'reports' && <Reports staff={staff} />}
          {tab === 'settings' && (
            <Settings staff={staff} services={services} reload={loadRefs} />
          )}
        </>
      )}
    </div>
  )
}
