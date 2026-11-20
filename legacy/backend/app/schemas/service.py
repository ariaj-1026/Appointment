from pydantic import BaseModel, ConfigDict, Field


class ServiceBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    duration_minutes: int = Field(gt=0, le=600)
    description: str | None = None
    is_active: bool = True


class ServiceCreate(ServiceBase):
    pass


class ServiceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    duration_minutes: int | None = Field(default=None, gt=0, le=600)
    description: str | None = None
    is_active: bool | None = None


class ServiceRead(ServiceBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
