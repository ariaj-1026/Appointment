import enum
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, clinic_now


class ReminderStatus(str, enum.Enum):
    SENT = "sent"
    FAILED = "failed"


class ReminderLog(Base):
    """One dispatch attempt for one appointment.

    Doubles as the record of what has already been sent: the due-reminder
    query excludes appointments with a `sent` row for the same channel, so
    re-running dispatch does not pester the same patient twice.
    """

    __tablename__ = "reminder_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    appointment_id: Mapped[int] = mapped_column(
        ForeignKey("appointments.id", ondelete="CASCADE"), index=True
    )
    channel: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16))
    recipient: Mapped[str | None] = mapped_column(String(255), default=None)
    detail: Mapped[str | None] = mapped_column(Text, default=None)
    sent_at: Mapped[datetime] = mapped_column(DateTime, default=clinic_now)

    appointment: Mapped["Appointment"] = relationship(  # noqa: F821
        back_populates="reminder_logs"
    )

    __table_args__ = (
        Index("ix_reminder_logs_appt_channel", "appointment_id", "channel", "status"),
    )
