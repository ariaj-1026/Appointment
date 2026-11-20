/**
 * The appointment status machine (see ALLOWED_TRANSITIONS in @clinic/shared).
 * Terminal statuses accept no further moves: a cancelled appointment cannot
 * be quietly revived — book a new one instead.
 */
import { ALLOWED_TRANSITIONS, TERMINAL_STATUSES, type AppointmentStatus } from '@clinic/shared';
import { InvalidStatusTransitionError } from '../lib/errors.js';

export function canTransition(current: AppointmentStatus, target: AppointmentStatus): boolean {
  return ALLOWED_TRANSITIONS[current].includes(target);
}

export function assertTransition(current: AppointmentStatus, target: AppointmentStatus): void {
  if (current === target) {
    throw new InvalidStatusTransitionError(`Appointment is already ${current}.`, {
      current_status: current,
      target_status: target,
    });
  }
  if (!canTransition(current, target)) {
    const allowed = [...ALLOWED_TRANSITIONS[current]].sort();
    throw new InvalidStatusTransitionError(
      `Cannot change a ${current} appointment to ${target}. ` +
        `Allowed from ${current}: ${allowed.length ? allowed.join(', ') : 'none'}.`,
      { current_status: current, target_status: target, allowed },
    );
  }
}

export function isTerminal(status: AppointmentStatus): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

/** Only appointments that still hold their slot can be moved. */
export function assertReschedulable(current: AppointmentStatus): void {
  if (isTerminal(current)) {
    throw new InvalidStatusTransitionError(`Cannot reschedule a ${current} appointment.`, {
      current_status: current,
    });
  }
}
