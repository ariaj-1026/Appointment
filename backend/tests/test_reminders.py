"""Phase 3: reminder sweep and dispatch."""

from datetime import date, datetime, time, timedelta

import pytest

from app.models import Appointment, Service
from app.services import reminders


@pytest.fixture
def soon(client, patient, doctor, consult):
    """An appointment a few hours from now, inside the default 24h window."""
    starts = (datetime.now() + timedelta(hours=3)).replace(second=0, microsecond=0)
    r = client.post(
        "/api/appointments",
        json={
            "patient_id": patient["id"],
            "staff_id": doctor["id"],
            "service_id": consult["id"],
            "starts_at": starts.isoformat(),
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def due_ids(client, **params):
    r = client.get("/api/reminders/due", params=params)
    assert r.status_code == 200, r.text
    return [a["id"] for a in r.json()]


def test_upcoming_appointment_is_due(client, soon):
    assert soon["id"] in due_ids(client)


def test_appointment_beyond_the_window_is_not_due(client, soon):
    assert due_ids(client, within_hours=1) == []


def test_cancelled_appointment_is_not_due(client, soon):
    client.patch(f"/api/appointments/{soon['id']}/status", json={"status": "cancelled"})
    assert soon["id"] not in due_ids(client)


def test_completed_appointment_is_not_due(client, soon):
    client.patch(f"/api/appointments/{soon['id']}/status", json={"status": "completed"})
    assert soon["id"] not in due_ids(client)


def test_confirmed_appointment_is_still_due(client, soon):
    client.patch(f"/api/appointments/{soon['id']}/status", json={"status": "confirmed"})
    assert soon["id"] in due_ids(client)


def test_past_appointment_is_not_due(client, db, soon):
    """A reminder for a visit already under way is noise."""
    appointment = db.get(Appointment, soon["id"])
    service = db.get(Service, appointment.service_id)
    appointment.starts_at = datetime.now() - timedelta(hours=2)
    appointment.ends_at = appointment.starts_at + timedelta(
        minutes=service.duration_minutes
    )
    db.commit()
    assert soon["id"] not in due_ids(client)


def test_dispatch_sends_and_logs(client, soon):
    body = client.post("/api/reminders/dispatch", params={"sender": "null"}).json()
    assert body["considered"] == 1
    assert body["sent"] == 1
    assert body["failed"] == 0

    log = client.get(f"/api/reminders/log/{soon['id']}").json()
    assert len(log) == 1
    assert log[0]["status"] == "sent"
    assert log[0]["channel"] == "null"


def test_dispatch_does_not_repeat_itself(client, soon):
    """Re-running the sweep must not pester the same patient twice."""
    first = client.post("/api/reminders/dispatch", params={"sender": "null"}).json()
    second = client.post("/api/reminders/dispatch", params={"sender": "null"}).json()
    assert first["sent"] == 1
    assert second["considered"] == 0
    assert second["sent"] == 0


def test_already_reminded_appointment_drops_out_of_due(client, soon):
    client.post("/api/reminders/dispatch", params={"sender": "null"})
    assert due_ids(client, channel="null") == []


def test_failed_send_is_logged_and_stays_due(client, db, soon):
    class Boom:
        channel = "null"

        def send(self, appointment, message):
            raise RuntimeError("smtp down")

    result = reminders.dispatch(db, sender=Boom())
    assert result["failed"] == 1
    assert result["sent"] == 0

    log = client.get(f"/api/reminders/log/{soon['id']}").json()
    assert log[0]["status"] == "failed"
    assert "smtp down" in log[0]["detail"]

    # A transient outage must not swallow the reminder permanently.
    assert soon["id"] in due_ids(client, channel="null")


def test_one_failure_does_not_abort_the_sweep(client, db, soon, other_patient, doctor, consult):
    starts = (datetime.now() + timedelta(hours=5)).replace(second=0, microsecond=0)
    client.post(
        "/api/appointments",
        json={
            "patient_id": other_patient["id"],
            "staff_id": doctor["id"],
            "service_id": consult["id"],
            "starts_at": starts.isoformat(),
        },
    )

    class FlakyOnFirst:
        channel = "null"

        def __init__(self):
            self.calls = 0

        def send(self, appointment, message):
            self.calls += 1
            if self.calls == 1:
                raise RuntimeError("transient")
            return "ok"

    result = reminders.dispatch(db, sender=FlakyOnFirst())
    assert result["considered"] == 2
    assert result["sent"] == 1 and result["failed"] == 1


def test_message_names_patient_staff_and_time(db, soon):
    appointment = db.get(Appointment, soon["id"])
    message = reminders.build_message(appointment)
    assert "Ana Cruz" in message
    assert "Dr. Ilagan" in message
    assert "Consultation" in message


def test_unknown_sender_is_rejected(client):
    r = client.post("/api/reminders/dispatch", params={"sender": "carrier-pigeon"})
    assert r.status_code == 422
    assert r.json()["code"] == "validation_error"
