"""The appointment status machine.

    scheduled ──► confirmed ──► completed
        │             │
        └──► cancelled / no_show ◄──┘

A walk-in can go straight from scheduled to completed without being confirmed.
Terminal statuses accept no further transitions, so a cancelled appointment
cannot be quietly revived — book a new one instead.
"""

from app.models.appointment import AppointmentStatus
from app.services.errors import InvalidStatusTransitionError

S = AppointmentStatus

ALLOWED_TRANSITIONS: dict[AppointmentStatus, frozenset[AppointmentStatus]] = {
    S.SCHEDULED: frozenset({S.CONFIRMED, S.COMPLETED, S.CANCELLED, S.NO_SHOW}),
    S.CONFIRMED: frozenset({S.COMPLETED, S.CANCELLED, S.NO_SHOW}),
    S.COMPLETED: frozenset(),
    S.CANCELLED: frozenset(),
    S.NO_SHOW: frozenset(),
}


def can_transition(current: AppointmentStatus, target: AppointmentStatus) -> bool:
    return target in ALLOWED_TRANSITIONS[current]


def assert_transition(current: AppointmentStatus, target: AppointmentStatus) -> None:
    """Raise unless `current -> target` is a legal move."""
    if current == target:
        raise InvalidStatusTransitionError(
            f"Appointment is already {current.value}.",
            current_status=current.value,
            target_status=target.value,
        )
    if not can_transition(current, target):
        allowed = sorted(s.value for s in ALLOWED_TRANSITIONS[current])
        hint = ", ".join(allowed) if allowed else "none"
        raise InvalidStatusTransitionError(
            f"Cannot change a {current.value} appointment to {target.value}. "
            f"Allowed from {current.value}: {hint}.",
            current_status=current.value,
            target_status=target.value,
            allowed=allowed,
        )


def assert_reschedulable(current: AppointmentStatus) -> None:
    """Only appointments that still hold their slot can be moved."""
    if current.is_terminal:
        raise InvalidStatusTransitionError(
            f"Cannot reschedule a {current.value} appointment.",
            current_status=current.value,
        )
