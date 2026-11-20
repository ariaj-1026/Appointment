from datetime import date, datetime

from sqlalchemy import Date, DateTime, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, clinic_now


class Patient(Base):
    __tablename__ = "patients"

    id: Mapped[int] = mapped_column(primary_key=True)
    first_name: Mapped[str] = mapped_column(String(80))
    last_name: Mapped[str] = mapped_column(String(80))
    phone: Mapped[str] = mapped_column(String(32))
    email: Mapped[str | None] = mapped_column(String(255), default=None)
    date_of_birth: Mapped[date | None] = mapped_column(Date, default=None)
    notes: Mapped[str | None] = mapped_column(Text, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=clinic_now)

    appointments: Mapped[list["Appointment"]] = relationship(  # noqa: F821
        back_populates="patient",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_patients_last_first", "last_name", "first_name"),
        Index("ix_patients_phone", "phone"),
    )

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}"
