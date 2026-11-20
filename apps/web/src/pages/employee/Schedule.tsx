import { useCallback, useEffect, useMemo, useState } from 'react'

import { api } from '../../api/client'
import type { Appointment, Service, Staff } from '../../api/types'
import type { HoursByStaff } from '../../components/DayCalendar'
import AppointmentDetail from '../../components/AppointmentDetail'
import AppointmentForm from '../../components/AppointmentForm'
import DayCalendar from '../../components/DayCalendar'
import EmptyState from '../../components/EmptyState'
import ErrorAlert from '../../components/ErrorAlert'
import WeekCalendar, { weekStartOf } from '../../components/WeekCalendar'
import { addDays, formatDate, formatDateShort, todayInput } from '../../lib/datetime'

export default function Schedule({
  staff,
  services,
  hoursByStaff,
  reloadRefs,
}: {
  staff: Staff[]
  services: Service[]
  hoursByStaff: HoursByStaff
  reloadRefs?: () => void
}) {
  const [view, setView] = useState<'day' | 'week'>('day')
  const [date, setDate] = useState(todayInput())
  // The week view shows one staff member across seven days; see WeekCalendar.
  const [weekStaffId, setWeekStaffId] = useState('')
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [booking, setBooking] = useState<{ start: string; staffId: string | number } | null>(null)
  const [selected, setSelected] = useState<Appointment | null>(null)

  const activeStaff = useMemo(() => staff.filter((s) => s.is_active), [staff])
  const weekStart = useMemo(() => weekStartOf(date), [date])

  useEffect(() => {
    if (!weekStaffId && activeStaff.length) setWeekStaffId(String(activeStaff[0]!.id))
  }, [activeStaff, weekStaffId])

  const weekStaffMember = useMemo(
    () => activeStaff.find((s) => String(s.id) === String(weekStaffId)),
    [activeStaff, weekStaffId],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (view === 'day') {
        setAppointments(await api.listAppointments({ on: date }))
      } else {
        // One request for the whole week, filtered to the chosen staff member.
        setAppointments(
          await api.searchAppointments({
            date_from: weekStart,
            date_to: addDays(weekStart, 6),
            staff_id: weekStaffId || undefined,
            limit: 500,
          }),
        )
      }
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [view, date, weekStart, weekStaffId])

  useEffect(() => {
    load()
  }, [load])

  const stats = useMemo(() => {
    const counts = { total: appointments.length, booked: 0, cancelled: 0, minutes: 0 }
    for (const a of appointments) {
      if (a.status === 'cancelled' || a.status === 'no_show' || a.status === 'declined') counts.cancelled += 1
      else {
        counts.booked += 1
        counts.minutes += a.duration_minutes
      }
    }
    return counts
  }, [appointments])

  const step = view === 'day' ? 1 : 7
  const notSetUp = activeStaff.length === 0 || services.length === 0

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Schedule</h1>
          <div className="sub">
            {view === 'day'
              ? formatDate(date)
              : `${formatDateShort(`${weekStart}T00:00:00`)} – ${formatDateShort(
                  `${addDays(weekStart, 6)}T00:00:00`,
                )}`}
          </div>
        </div>
        <div className="spacer" />
        <div className="view-toggle" role="group" aria-label="Calendar view">
          <button
            className="tab"
            aria-pressed={view === 'day'}
            onClick={() => setView('day')}
          >
            Day
          </button>
          <button
            className="tab"
            aria-pressed={view === 'week'}
            onClick={() => setView('week')}
          >
            Week
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setDate((d) => addDays(d, -step))}
            aria-label={view === 'day' ? 'Previous day' : 'Previous week'}
          >
            ‹
          </button>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ width: 160 }}
            aria-label="Date"
          />
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setDate((d) => addDays(d, step))}
            aria-label={view === 'day' ? 'Next day' : 'Next week'}
          >
            ›
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => setDate(todayInput())}>
            Today
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setBooking({ start: '', staffId: '' })}
            disabled={notSetUp}
          >
            + New appointment
          </button>
        </div>
      </div>

      {view === 'week' && activeStaff.length > 0 && (
        <div className="toolbar">
          <div className="field" style={{ flex: '1 1 260px' }}>
            <label htmlFor="week-staff">Staff member</label>
            <select
              id="week-staff"
              value={weekStaffId}
              onChange={(e) => setWeekStaffId(e.target.value)}
            >
              {activeStaff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name} — {s.role}
                </option>
              ))}
            </select>
          </div>
          <span className="hint">
            A week cannot also fit a column per staff member, so this view shows
            one at a time. Switch to Day to see everyone side by side.
          </span>
        </div>
      )}

      <div className="stats">
        <div className="stat">
          <div className="stat-value">{stats.total}</div>
          <div className="stat-label">Appointments</div>
        </div>
        <div className="stat">
          <div className="stat-value">{stats.booked}</div>
          <div className="stat-label">Active</div>
        </div>
        <div className="stat">
          <div className="stat-value">{stats.cancelled}</div>
          <div className="stat-label">Cancelled / no-show / declined</div>
        </div>
        <div className="stat">
          <div className="stat-value">
            {Math.floor(stats.minutes / 60)}h {stats.minutes % 60}m
          </div>
          <div className="stat-label">Booked time</div>
        </div>
      </div>

      <ErrorAlert error={error} />

      {notSetUp ? (
        <div className="card">
          <EmptyState mark="⚙️" title="Set up the clinic first">
            Add at least one staff member and one service under Settings before
            booking appointments.
          </EmptyState>
        </div>
      ) : loading ? (
        <div className="card loading">Loading schedule…</div>
      ) : view === 'day' ? (
        <>
          <DayCalendar
            date={date}
            staff={activeStaff}
            appointments={appointments}
            hoursByStaff={hoursByStaff}
            onPickSlot={(start, staffId) => setBooking({ start, staffId })}
            onOpenAppointment={setSelected}
          />
          <p className="hint" style={{ marginTop: 12, textAlign: 'center' }}>
            {appointments.length === 0
              ? 'Nothing booked on this day. Click an empty slot to book.'
              : 'Click a slot to book, or an appointment to open it. Arrow keys move around the grid.'}
          </p>
        </>
      ) : (
        <>
          <WeekCalendar
            weekStart={weekStart}
            staffMember={weekStaffMember}
            appointments={appointments}
            hoursByStaff={hoursByStaff}
            today={todayInput()}
            onOpenAppointment={setSelected}
            onOpenDay={(day) => {
              setDate(day)
              setView('day')
            }}
            onPickDay={(day) =>
              setBooking({ start: `${day}T09:00`, staffId: weekStaffId })
            }
          />
          <p className="hint" style={{ marginTop: 12, textAlign: 'center' }}>
            Click a date to open that day in detail.
          </p>
        </>
      )}

      {booking && (
        <AppointmentForm
          staff={activeStaff}
          services={services}
          initialStart={booking.start}
          initialStaffId={booking.staffId}
          onClose={() => setBooking(null)}
          onCreated={(appointment) => {
            setBooking(null)
            const day = appointment.starts_at.slice(0, 10)
            if (view === 'day' && day !== date) setDate(day)
            else load()
            reloadRefs?.()
          }}
        />
      )}

      {selected && (
        <AppointmentDetail
          appointment={selected}
          staff={staff}
          services={services}
          onClose={() => setSelected(null)}
          onChanged={(updated) => {
            setSelected(updated)
            load()
          }}
        />
      )}
    </div>
  )
}
