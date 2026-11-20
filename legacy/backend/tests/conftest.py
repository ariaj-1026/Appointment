"""Test fixtures.

Each test gets a fresh in-memory SQLite database via a StaticPool, so the
single connection is shared between the test and the app under test.
"""

import os
from datetime import date, datetime, time, timedelta

os.environ["DATABASE_URL"] = "sqlite://"
# Tests build the schema straight from the models against a throwaway in-memory
# database; replaying the migration history per test would only cost time.
os.environ["AUTO_MIGRATE"] = "0"
os.environ["REMINDER_SENDER"] = "null"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app import database  # noqa: E402
from app.database import Base, get_db  # noqa: E402
from app.clock import clinic_now, clinic_today  # noqa: E402,F401
from app.main import create_app  # noqa: E402


@pytest.fixture
def engine():
    eng = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    database.engine = eng
    Base.metadata.create_all(bind=eng)
    yield eng
    eng.dispose()


@pytest.fixture
def db(engine):
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = factory()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(engine, db):
    app = create_app()

    def _override():
        yield db

    app.dependency_overrides[get_db] = _override
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


# --------------------------------------------------------------------------
# Domain fixtures
# --------------------------------------------------------------------------

@pytest.fixture
def patient(client):
    r = client.post(
        "/api/patients",
        json={"first_name": "Ana", "last_name": "Cruz", "phone": "0917-555-0101"},
    )
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def other_patient(client):
    r = client.post(
        "/api/patients",
        json={"first_name": "Ben", "last_name": "Reyes", "phone": "0917-555-0202"},
    )
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def doctor(client):
    r = client.post(
        "/api/staff", json={"full_name": "Dr. Ilagan", "role": "General Physician"}
    )
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def other_doctor(client):
    r = client.post("/api/staff", json={"full_name": "Dr. Santos", "role": "Dentist"})
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def consult(client):
    """A 30-minute service."""
    r = client.post(
        "/api/services", json={"name": "Consultation", "duration_minutes": 30}
    )
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def long_service(client):
    """A 60-minute service, for testing that duration drives the end time."""
    r = client.post(
        "/api/services", json={"name": "Minor Procedure", "duration_minutes": 60}
    )
    assert r.status_code == 201, r.text
    return r.json()


def next_weekday(weekday: int = 0) -> date:
    """The next future date falling on `weekday` (0 = Monday).

    Tests use a future date so the booking-horizon check never interferes and
    results do not depend on the day the suite happens to run.
    """
    today = clinic_today()
    ahead = (weekday - today.weekday()) % 7 or 7
    return today + timedelta(days=ahead)


def at(day: date, hour: int, minute: int = 0) -> str:
    """ISO timestamp with no offset, as the browser's datetime-local sends."""
    return datetime.combine(day, time(hour, minute)).isoformat()


@pytest.fixture
def monday():
    return next_weekday(0)


@pytest.fixture
def book(client, patient, doctor, consult):
    """Book an appointment, returning the response for assertion."""

    def _book(starts_at: str, *, patient_id=None, staff_id=None, service_id=None):
        return client.post(
            "/api/appointments",
            json={
                "patient_id": patient_id or patient["id"],
                "staff_id": staff_id or doctor["id"],
                "service_id": service_id or consult["id"],
                "starts_at": starts_at,
            },
        )

    return _book
