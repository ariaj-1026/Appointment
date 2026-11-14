"""Phase 3: booking history."""

from datetime import datetime, timedelta

from app.clock import clinic_now, clinic_today
from tests.conftest import at


def history(client, appointment_id):
    r = client.get(f"/api/appointments/{appointment_id}/history")
    assert r.status_code == 200, r.text
    return r.json()


def test_booking_is_recorded(client, book, monday):
    appt = book(at(monday, 9)).json()
    log = history(client, appt["id"])
    assert len(log) == 1
    assert log[0]["action"] == "created"
    assert log[0]["to_status"] == "scheduled"
    assert log[0]["to_starts_at"].endswith("09:00:00")


def test_status_change_is_recorded(client, book, monday):
    appt = book(at(monday, 9)).json()
    client.patch(f"/api/appointments/{appt['id']}/status", json={"status": "confirmed"})
    log = history(client, appt["id"])
    assert [e["action"] for e in log] == ["created", "status_changed"]
    assert log[1]["from_status"] == "scheduled"
    assert log[1]["to_status"] == "confirmed"


def test_status_note_is_kept(client, book, monday):
    appt = book(at(monday, 9)).json()
    client.patch(
        f"/api/appointments/{appt['id']}/status",
        json={"status": "cancelled", "note": "Patient called to cancel"},
    )
    assert history(client, appt["id"])[1]["note"] == "Patient called to cancel"


def test_reschedule_is_recorded_with_both_times(client, book, monday):
    appt = book(at(monday, 9)).json()
    client.patch(
        f"/api/appointments/{appt['id']}/reschedule", json={"starts_at": at(monday, 14)}
    )
    entry = history(client, appt["id"])[-1]
    assert entry["action"] == "rescheduled"
    assert entry["from_starts_at"].endswith("09:00:00")
    assert entry["to_starts_at"].endswith("14:00:00")


def test_reschedule_records_the_staff_move(client, book, monday, doctor, other_doctor):
    appt = book(at(monday, 9)).json()
    client.patch(
        f"/api/appointments/{appt['id']}/reschedule",
        json={"starts_at": at(monday, 9), "staff_id": other_doctor["id"]},
    )
    entry = history(client, appt["id"])[-1]
    assert entry["from_staff_id"] == doctor["id"]
    assert entry["to_staff_id"] == other_doctor["id"]


def test_full_lifecycle_is_reconstructable(client, book, monday):
    appt = book(at(monday, 9)).json()
    client.patch(f"/api/appointments/{appt['id']}/status", json={"status": "confirmed"})
    client.patch(
        f"/api/appointments/{appt['id']}/reschedule", json={"starts_at": at(monday, 15)}
    )
    client.patch(f"/api/appointments/{appt['id']}/status", json={"status": "completed"})
    assert [e["action"] for e in history(client, appt["id"])] == [
        "created",
        "status_changed",
        "rescheduled",
        "status_changed",
    ]


def test_rejected_changes_leave_no_trace(client, book, monday, other_patient):
    """A failed booking must not log that it happened."""
    appt = book(at(monday, 9)).json()
    assert book(at(monday, 9), patient_id=other_patient["id"]).status_code == 409
    client.patch(f"/api/appointments/{appt['id']}/status", json={"status": "completed"})
    # Illegal move from a terminal status.
    client.patch(f"/api/appointments/{appt['id']}/status", json={"status": "confirmed"})
    actions = [e["action"] for e in history(client, appt["id"])]
    assert actions == ["created", "status_changed"]


def test_history_of_unknown_appointment_is_404(client):
    assert client.get("/api/appointments/9999/history").status_code == 404


def test_history_is_stamped_in_local_clinic_time(client, book, monday):
    """`changed_at` follows the same naive-local rule as every other datetime.

    It used to rely on `server_default=func.now()`, which SQLite renders as
    CURRENT_TIMESTAMP — i.e. **UTC**. East of Greenwich that reported every
    booking as having been made hours earlier, often on the previous calendar
    day, while the appointment times beside it were local. The two clocks in
    one timeline could not be compared.
    """
    before = clinic_now() - timedelta(seconds=5)
    created = book(at(monday, 10)).json()
    after = clinic_now() + timedelta(seconds=5)

    entry = client.get(f"/api/appointments/{created['id']}/history").json()[0]
    stamped = datetime.fromisoformat(entry["changed_at"])
    assert before <= stamped <= after, (
        f"{stamped} is outside {before}..{after}; a UTC stamp would land here"
    )


def test_each_history_entry_gets_its_own_timestamp(client, book, monday):
    """A later action is stamped later — the column is not frozen at insert."""
    created = book(at(monday, 10)).json()
    client.patch(
        f"/api/appointments/{created['id']}/status", json={"status": "confirmed"}
    )
    entries = client.get(f"/api/appointments/{created['id']}/history").json()
    assert len(entries) == 2
    assert entries[0]["changed_at"] <= entries[1]["changed_at"]
