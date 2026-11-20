import enum
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, clinic_now


class AppointmentStatus(str, enum.Enum):
    SCHEDULED = "scheduled"
    CONFIRMED = "confirmed"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    NO_SHOW = "no_show"

    @property
    def is_terminal(self) -> bool:
        return self in _TERMINAL

    @property
    def blocks_slot(self) -> bool:
        """Whether an appointment in this status still occupies its time slot."""
        return self not in _RELEASES_SLOT


_TERMINAL = frozenset(
    {
        AppointmentStatus.COMPLETED,
        AppointmentStatus.CANCELLED,
        AppointmentStatus.NO_SHOW,
    }
)

# Cancelled and no-show appointments free their slot for rebooking.
_RELEASES_SLOT = frozenset(
    {AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW}
)

#: Statuses that still occupy a slot, as raw values for use in queries.
BLOCKING_STATUSES = tuple(s.value for s in AppointmentStatus if s.blocks_slot)

_BLOCKING_SQL = ", ".join(f"'{s}'" for s in BLOCKING_STATUSES)


class Appointment(Base):
    __tablename__ = "appointments"

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(
        ForeignKey("patients.id", ondelete="CASCADE"), index=True
    )
    staff_id: Mapped[int] = mapped_column(ForeignKey("staff.id"), index=True)
    service_id: Mapped[int] = mapped_column(ForeignKey("services.id"))

    # Naive local clinic time. Business hours are inherently local, so storing
    # local time keeps hours validation a direct comparison. Single-clinic
    # assumption: revisit if the system ever spans timezones.
    starts_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    # Derived from starts_at + service.duration_minutes and stored, so overlap
    # detection is one comparison with no join.
    ends_at: Mapped[datetime] = mapped_column(DateTime)

    status: Mapped[str] = mapped_column(
        String(16), default=AppointmentStatus.SCHEDULED.value, index=True
    )
    reason: Mapped[str | None] = mapped_column(Text, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=clinic_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=clinic_now, onupdate=clinic_now
    )

    patient: Mapped["Patient"] = relationship(back_populates="appointments")  # noqa: F821
    staff: Mapped["Staff"] = relationship(back_populates="appointments")  # noqa: F821
    service: Mapped["Service"] = relationship(back_populates="appointments")  # noqa: F821

    audit_logs: Mapped[list["AuditLog"]] = relationship(  # noqa: F821
        back_populates="appointment",
        cascade="all, delete-orphan",
        order_by="AuditLog.changed_at, AuditLog.id",
    )
    reminder_logs: Mapped[list["ReminderLog"]] = relationship(  # noqa: F821
        back_populates="appointment",
        cascade="all, delete-orphan",
        order_by="ReminderLog.sent_at",
    )

    __table_args__ = (
        CheckConstraint("starts_at < ends_at", name="ck_appointments_time_order"),
        # Catches exact-duplicate submissions cheaply. Genuine overlap needs a
        # range check, which SQLite cannot express as a constraint, so the
        # service layer in app/services/scheduling.py is the real guard.
        Index(
            "uq_appointments_staff_start_active",
            "staff_id",
            "starts_at",
            unique=True,
            sqlite_where=text(f"status IN ({_BLOCKING_SQL})"),
        ),
        Index("ix_appointments_staff_window", "staff_id", "starts_at", "ends_at"),
    )

    @property
    def status_enum(self) -> AppointmentStatus:
        return AppointmentStatus(self.status)

    @property
    def duration_minutes(self) -> int:
        return int((self.ends_at - self.starts_at).total_seconds() // 60)
