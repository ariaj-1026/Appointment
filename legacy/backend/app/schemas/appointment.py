from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, computed_field, field_validator

from app.models.appointment import AppointmentStatus
from app.schemas.patient import PatientRead
from app.schemas.service import ServiceRead
from app.schemas.staff import StaffRead


def _as_naive_local(value: datetime) -> datetime:
    """Drop any incoming offset.

    The browser sends `datetime-local` values with no offset, but a client
    could send `...Z`. Appointments are stored as naive local clinic time, so
    an aware value is converted to local time and then stripped rather than
    silently treated as local.
    """
    if value.tzinfo is not None:
        value = value.astimezone().replace(tzinfo=None)
    return value.replace(second=0, microsecond=0)


class AppointmentCreate(BaseModel):
    patient_id: int
    staff_id: int
    service_id: int
    starts_at: datetime
    reason: str | None = None

    # ends_at is deliberately absent: duration comes from the service.

    @field_validator("starts_at")
    @classmethod
    def _normalise(cls, v: datetime) -> datetime:
        return _as_naive_local(v)


class AppointmentReschedule(BaseModel):
    starts_at: datetime
    staff_id: int | None = Field(
        default=None, description="Omit to keep the current staff member."
    )
    service_id: int | None = Field(
        default=None, description="Omit to keep the current service and duration."
    )

    @field_validator("starts_at")
    @classmethod
    def _normalise(cls, v: datetime) -> datetime:
        return _as_naive_local(v)


class AppointmentStatusUpdate(BaseModel):
    status: AppointmentStatus
    note: str | None = None


class AppointmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    patient_id: int
    staff_id: int
    service_id: int
    starts_at: datetime
    ends_at: datetime
    status: AppointmentStatus
    reason: str | None
    created_at: datetime
    updated_at: datetime

    @computed_field
    @property
    def duration_minutes(self) -> int:
        return int((self.ends_at - self.starts_at).total_seconds() // 60)


class AppointmentDetail(AppointmentRead):
    """List and detail payload, with the joined rows the UI needs to render."""

    patient: PatientRead
    staff: StaffRead
    service: ServiceRead
