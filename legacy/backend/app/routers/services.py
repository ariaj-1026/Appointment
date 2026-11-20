from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Service
from app.schemas import ServiceCreate, ServiceRead, ServiceUpdate
from app.services.scheduling import get_service

router = APIRouter(prefix="/api/services", tags=["services"])


@router.get("", response_model=list[ServiceRead])
def list_services(
    include_inactive: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    stmt = select(Service).order_by(Service.name)
    if not include_inactive:
        stmt = stmt.where(Service.is_active.is_(True))
    return list(db.execute(stmt).scalars())


@router.post("", response_model=ServiceRead, status_code=status.HTTP_201_CREATED)
def create_service(payload: ServiceCreate, db: Session = Depends(get_db)):
    service = Service(**payload.model_dump())
    db.add(service)
    db.commit()
    db.refresh(service)
    return service


@router.get("/{service_id}", response_model=ServiceRead)
def read_service(service_id: int, db: Session = Depends(get_db)):
    return get_service(db, service_id)


@router.patch("/{service_id}", response_model=ServiceRead)
def update_service(
    service_id: int, payload: ServiceUpdate, db: Session = Depends(get_db)
):
    service = get_service(db, service_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(service, field, value)
    db.commit()
    db.refresh(service)
    # Note: changing duration_minutes does not retroactively move existing
    # appointments — their ends_at was fixed at booking time on purpose.
    return service
