from pydantic import BaseModel, ConfigDict, Field


class StaffBase(BaseModel):
    full_name: str = Field(min_length=1, max_length=160)
    role: str = Field(min_length=1, max_length=80)
    is_active: bool = True


class StaffCreate(StaffBase):
    pass


class StaffUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=160)
    role: str | None = Field(default=None, min_length=1, max_length=80)
    is_active: bool | None = None


class StaffRead(StaffBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
