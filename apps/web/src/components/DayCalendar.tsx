import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'

import type { Appointment, BusinessHour, Staff } from '../api/types'
import {
  clinicNow,
  formatTimeRange,
  minutesToTime,
  parseNaive,
  timeToMinutes,
  toDateTimeInput,
  weekdayOf,
} from '../lib/datetime'

const SLOT_MINUTES = 30
const DEFAULT_OPEN = 8 * 60
const DEFAULT_CLOSE = 18 * 60

/**
 * One day, one row per staff member, half-hour columns (time runs left to right).
 *
 * Appointments are placed in the row their start time falls in. A cell outside
 * the staff member's business hours is hatched and not actionable, so the grid
 * shows the same rules the backend enforces rather than letting the user
 * discover them through a rejected booking.
 *
 * Slots that have already passed are dimmed and refuse booking, for the same
 * reason. An appointment already sitting in a past slot stays clickable — the
 * whole point of looking at yesterday is to mark what happened.
 *
 * Keyboard model: the grid is one tab stop, not forty. A roving tabindex keeps
 * exactly one cell focusable; arrows move between cells, Home/End jump along a
 * staff row, PageUp/PageDown jump two hours, Ctrl+Home/End to the corners, and Enter or Space
 * either opens the appointment in the cell or books the empty slot. Tabbing
 * past the grid therefore takes one press, which is why individual cells are
 * not each focusable.
 */
export type HoursByStaff = Record<number, BusinessHour[]>

interface DayCalendarProps {
  date: string
  staff: Staff[]
  appointments: Appointment[]
  hoursByStaff: HoursByStaff
  onPickSlot: (startsAt: string, staffId: number) => void
  onOpenAppointment: (a: Appointment) => void
}

export default function DayCalendar({
  date,
  staff,
  appointments,
  hoursByStaff,
  onPickSlot,
  onOpenAppointment,
}: DayCalendarProps) {
  const weekday = weekdayOf(date)
  const gridRef = useRef<HTMLDivElement>(null)
  const [focus, setFocus] = useState({ row: 0, col: 0 })
  // Only move focus in response to a key press, never on a data refresh.
  const shouldFocus = useRef(false)

  const [dayStart, dayEnd] = useMemo(() => {
    let min = DEFAULT_OPEN
    let max = DEFAULT_CLOSE

    for (const windows of Object.values(hoursByStaff)) {
      for (const w of windows) {
        if (w.weekday !== weekday) continue
        min = Math.min(min, timeToMinutes(w.opens_at))
        max = Math.max(max, timeToMinutes(w.closes_at))
      }
    }
    for (const appointment of appointments) {
      const start = parseNaive(appointment.starts_at)
      const end = parseNaive(appointment.ends_at)
      min = Math.min(min, start.getHours() * 60 + start.getMinutes())
      max = Math.max(max, end.getHours() * 60 + end.getMinutes())
    }

    return [
      Math.floor(min / SLOT_MINUTES) * SLOT_MINUTES,
      Math.ceil(max / SLOT_MINUTES) * SLOT_MINUTES,
    ]
  }, [hoursByStaff, appointments, weekday])

  const slots = useMemo(() => {
    const out: number[] = []
    for (let m = dayStart; m < dayEnd; m += SLOT_MINUTES) out.push(m)
    return out
  }, [dayStart, dayEnd])

  const placed = useMemo(() => {
    const map = new Map<string, Appointment[]>()
    for (const appointment of appointments) {
      const start = parseNaive(appointment.starts_at)
      const minutes = start.getHours() * 60 + start.getMinutes()
      const slot = Math.floor(minutes / SLOT_MINUTES) * SLOT_MINUTES
      const key = `${appointment.staff_id}:${slot}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(appointment)
    }
    return map
  }, [appointments])

  const isOpen = useCallback(
    (staffId: number, slotMinutes: number) => {
      const all = hoursByStaff[staffId] || []
      if (all.length === 0) return true // unrestricted, matching the backend
      const slotEnd = slotMinutes + SLOT_MINUTES
      return all.some(
        (w) =>
          w.weekday === weekday &&
          timeToMinutes(w.opens_at) <= slotMinutes &&
          slotEnd <= timeToMinutes(w.closes_at),
      )
    },
    [hoursByStaff, weekday],
  )

  // Re-read the clock each time the day changes rather than once at mount, so
  // a tab left open overnight does not keep yesterday bookable.
  const isPast = useCallback(
    (slotMinutes: number) => {
      const slot = new Date(`${date}T00:00:00`)
      slot.setMinutes(slotMinutes + SLOT_MINUTES)
      // The slot is past only once it has fully elapsed, so the half-hour you
      // are currently standing in can still be booked.
      return slot <= clinicNow()
    },
    [date],
  )

  // Keep the focused cell in range when the day or staff list changes.
  useEffect(() => {
    setFocus((f) => ({
      row: Math.min(f.row, Math.max(slots.length - 1, 0)),
      col: Math.min(f.col, Math.max(staff.length - 1, 0)),
    }))
  }, [slots.length, staff.length])

  useEffect(() => {
    if (!shouldFocus.current) return
    shouldFocus.current = false
    gridRef.current
      ?.querySelector<HTMLElement>(`[data-cell="${focus.row}-${focus.col}"]`)
      ?.focus()
  }, [focus])

  function move(row: number, col: number) {
    shouldFocus.current = true
    setFocus({
      row: Math.max(0, Math.min(row, slots.length - 1)),
      col: Math.max(0, Math.min(col, staff.length - 1)),
    })
  }

  function activate(row: number, col: number) {
    const slotMinutes = slots[row]!
    const member = staff[col]
    if (!member) return
    const items = placed.get(`${member.id}:${slotMinutes}`) || []
    if (items.length > 0) {
      onOpenAppointment(items[0])
      return
    }
    if (!isOpen(member.id, slotMinutes) || isPast(slotMinutes)) return
    onPickSlot(
      toDateTimeInput(date, Math.floor(slotMinutes / 60), slotMinutes % 60),
      member.id,
    )
  }

  // Layout: one ROW per staff member, one COLUMN per half-hour slot.
  // `focus.row` is still the slot index and `focus.col` the staff index, so
  // Left/Right move through time and Up/Down move between staff.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const { row, col } = focus
    switch (e.key) {
      case 'ArrowRight':
        move(row + 1, col)
        break
      case 'ArrowLeft':
        move(row - 1, col)
        break
      case 'ArrowDown':
        move(row, col + 1)
        break
      case 'ArrowUp':
        move(row, col - 1)
        break
      case 'Home':
        e.ctrlKey ? move(0, 0) : move(0, col)
        break
      case 'End':
        e.ctrlKey ? move(slots.length - 1, staff.length - 1) : move(slots.length - 1, col)
        break
      case 'PageDown':
        move(row + 4, col)
        break
      case 'PageUp':
        move(row - 4, col)
        break
      case 'Enter':
      case ' ':
        activate(row, col)
        break
      default:
        return
    }
    e.preventDefault()
  }

  return (
    <div className="cal-scroll">
      <div
        className="calendar calendar-h"
        role="grid"
        aria-label={`Schedule for ${date}`}
        aria-rowcount={staff.length + 1}
        aria-colcount={slots.length + 1}
        ref={gridRef}
        onKeyDown={onKeyDown}
        style={{ gridTemplateColumns: `200px repeat(${slots.length}, minmax(96px, 1fr))` }}
      >
        <div className="cal-row" role="row">
          <div className="cal-head cal-corner" role="columnheader">
            Staff
          </div>
          {slots.map((m) => (
            <div className={`cal-head cal-time-head${m % 60 === 0 ? ' hour' : ''}`} role="columnheader" key={m}>
              {minutesToTime(m)}
            </div>
          ))}
        </div>

        {staff.map((member, colIndex) => (
          <StaffRow
            key={member.id}
            colIndex={colIndex}
            member={member}
            slots={slots}
            placed={placed}
            isOpen={isOpen}
            isPast={isPast}
            focus={focus}
            onFocusCell={(row: number, col: number) => setFocus({ row, col })}
            onActivate={activate}
          />
        ))}
      </div>
    </div>
  )
}

interface StaffRowProps {
  colIndex: number
  member: Staff
  slots: number[]
  placed: Map<string, Appointment[]>
  isOpen: (staffId: number, slotMinutes: number) => boolean
  isPast: (slotMinutes: number) => boolean
  focus: { row: number; col: number }
  onFocusCell: (row: number, col: number) => void
  onActivate: (row: number, col: number) => void
}

function StaffRow({
  colIndex,
  member,
  slots,
  placed,
  isOpen,
  isPast,
  focus,
  onFocusCell,
  onActivate,
}: StaffRowProps) {
  return (
    <div className="cal-row" role="row">
      <div className="cal-staff" role="rowheader">
        {member.full_name}
        <div className="role">{member.role}</div>
      </div>
      {slots.map((slotMinutes, rowIndex) => {
        const items = placed.get(`${member.id}:${slotMinutes}`) || []
        const open = isOpen(member.id, slotMinutes)
        const past = isPast(slotMinutes)
        const isFocused = focus.row === rowIndex && focus.col === colIndex
        const time = minutesToTime(slotMinutes)

        let className = 'cal-cell'
        let label: string
        if (items.length > 0) {
          label = `${time}, ${member.full_name}: ${items
            .map((a) => `${a.patient.full_name}, ${a.service.name}`)
            .join('; ')}`
        } else if (!open) {
          className += ' closed'
          label = `${time}, ${member.full_name}: outside business hours`
        } else if (past) {
          className += ' past'
          label = `${time}, ${member.full_name}: time has passed`
        } else {
          className += ' bookable'
          label = `${time}, ${member.full_name}: free — book`
        }
        if (slotMinutes % 60 === 0) className += ' hour'

        return (
          <div
            key={slotMinutes}
            className={className}
            role="gridcell"
            data-cell={`${rowIndex}-${colIndex}`}
            tabIndex={isFocused ? 0 : -1}
            aria-label={label}
            title={items.length === 0 && open && !past ? label : undefined}
            onFocus={() => onFocusCell(rowIndex, colIndex)}
            onClick={() => onActivate(rowIndex, colIndex)}
          >
            {items.map((appointment) => (
              <button
                key={appointment.id}
                className={`appt s-${appointment.status}`}
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation()
                  onActivate(rowIndex, colIndex)
                }}
              >
                <span className="appt-name">{appointment.patient.full_name}</span>
                <span className="appt-meta">
                  {formatTimeRange(appointment.starts_at, appointment.ends_at)} ·{' '}
                  {appointment.service.name}
                </span>
              </button>
            ))}
          </div>
        )
      })}
    </div>
  )
}
