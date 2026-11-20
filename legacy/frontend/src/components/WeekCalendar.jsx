import { useMemo } from 'react'

import {
  addDays,
  formatTimeRange,
  parseNaive,
  timeToMinutes,
  toDateInput,
  weekdayOf,
} from '../lib/datetime.js'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * Seven days at a glance, for one staff member.
 *
 * The day grid gives a column to each staff member, which is what a front desk
 * works from. Seven days cannot also fit per-staff columns, so the week view
 * trades that away: it shows one staff member across the week, picked above.
 * That is the whole reason this is a separate component rather than a mode of
 * DayCalendar — the axes differ.
 *
 * Appointments are listed inside their day rather than positioned by time,
 * because at this density a proportional layout produces unreadable slivers.
 * Clicking a day header opens that day in the detailed view.
 */
export default function WeekCalendar({
  weekStart,
  staffMember,
  appointments,
  hoursByStaff,
  today,
  onOpenAppointment,
  onOpenDay,
  onPickDay,
}) {
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  )

  const byDay = useMemo(() => {
    const map = new Map()
    for (const a of appointments) {
      const key = a.starts_at.slice(0, 10)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(a)
    }
    for (const list of map.values()) {
      list.sort((x, y) => x.starts_at.localeCompare(y.starts_at))
    }
    return map
  }, [appointments])

  const windows = hoursByStaff[staffMember?.id] || []
  const unrestricted = windows.length === 0

  function hoursFor(dateStr) {
    if (unrestricted) return null
    const weekday = weekdayOf(dateStr)
    return windows
      .filter((w) => w.weekday === weekday)
      .sort((a, b) => timeToMinutes(a.opens_at) - timeToMinutes(b.opens_at))
  }

  function bookedMinutes(list) {
    return list
      .filter((a) => !['cancelled', 'no_show'].includes(a.status))
      .reduce((sum, a) => sum + a.duration_minutes, 0)
  }

  return (
    <div className="week">
      {days.map((dateStr) => {
        const list = byDay.get(dateStr) || []
        const dayWindows = hoursFor(dateStr)
        const closed = dayWindows !== null && dayWindows.length === 0
        const isToday = dateStr === today
        const d = parseNaive(`${dateStr}T00:00:00`)
        const booked = bookedMinutes(list)

        return (
          <section
            className={`week-day${closed ? ' closed' : ''}${isToday ? ' today' : ''}`}
            key={dateStr}
            aria-label={`${DAY_NAMES[weekdayOf(dateStr)]} ${d.getDate()}`}
          >
            <header className="week-day-head">
              <button
                className="week-day-open"
                onClick={() => onOpenDay(dateStr)}
                title="Open this day"
              >
                <span className="week-dow">{DAY_NAMES[weekdayOf(dateStr)]}</span>
                <span className="week-dom">{d.getDate()}</span>
              </button>
              <span className="week-meta">
                {closed
                  ? 'Closed'
                  : list.length === 0
                    ? 'Free'
                    : `${list.length} appt${list.length === 1 ? '' : 's'} · ${
                        Math.floor(booked / 60) ? `${Math.floor(booked / 60)}h ` : ''
                      }${booked % 60}m`}
              </span>
            </header>

            <div className="week-day-body">
              {list.map((a) => (
                <button
                  key={a.id}
                  className={`appt s-${a.status}`}
                  onClick={() => onOpenAppointment(a)}
                  title={`${a.patient.full_name} — ${a.service.name}`}
                >
                  <span className="appt-name">{a.patient.full_name}</span>
                  <span className="appt-meta">
                    {formatTimeRange(a.starts_at, a.ends_at)} · {a.service.name}
                  </span>
                </button>
              ))}

              {list.length === 0 && !closed && (
                <button
                  className="week-add"
                  onClick={() => onPickDay(dateStr)}
                  title="Book on this day"
                >
                  + Book
                </button>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}

export { DAY_NAMES }

/** Monday of the week containing `dateStr`, as a date input string. */
export function weekStartOf(dateStr) {
  const offset = weekdayOf(dateStr)
  return addDays(dateStr, -offset)
}

export function todayStr() {
  return toDateInput(new Date())
}
