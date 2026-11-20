import enum
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, clinic_now


class AuditAction(str, enum.Enum):
    CREATED = "created"
    STATUS_CHANGED = "status_changed"
    RESCHEDULED = "rescheduled"


class AuditLog(Base):
    """An append-only record of what happened to an appointment.

    Written by the service layer on every create, status change and
    reschedule, so an appointment's history can be reconstructed without
    relying on anyone remembering to log it at the call site.

    Rows are never updated or deleted. The before/after columns are nullable
    because which ones apply depends on the action: a status change fills the
    status pair, a reschedule fills the time and staff pairs.
    """

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    appointment_id: Mapped[int] = mapped_column(
        ForeignKey("appointments.id", ondelete="CASCADE"), index=True
    )
    action: Mapped[str] = mapped_column(String(24))

    from_status: Mapped[str | None] = mapped_column(String(16), default=None)
    to_status: Mapped[str | None] = mapped_column(String(16), default=None)

    from_starts_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)
    to_starts_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)

    from_staff_id: Mapped[int | None] = mapped_column(default=None)
    to_staff_id: Mapped[int | None] = mapped_column(default=None)

    note: Mapped[str | None] = mapped_column(Text, default=None)
    changed_at: Mapped[datetime] = mapped_column(DateTime, default=clinic_now)

    appointment: Mapped["Appointment"] = relationship(  # noqa: F821
        back_populates="audit_logs"
    )

    __table_args__ = (
        Index("ix_audit_logs_appointment_time", "appointment_id", "changed_at"),
    )
