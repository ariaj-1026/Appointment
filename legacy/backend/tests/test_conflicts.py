"""Phase 1: time-conflict detection — the central requirement."""

from datetime import date, datetime, timedelta

from app.clock import clinic_now, clinic_today
from tests.conftest import at


def test_books_an_appointment(book, monday, consult):
    r = book(at(monday, 9))
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "scheduled"
    # Duration comes from the service, not the caller.
    assert body["duration_minutes"] == consult["duration_minutes"] == 30
    assert body["ends_at"].endswith("09:30:00")


def test_exact_double_booking_is_refused(book, monday):
    assert book(at(monday, 9)).status_code == 201
    r = book(at(monday, 9))
    assert r.status_code == 409
    assert r.json()["code"] == "slot_conflict"


def test_partial_overlap_is_refused(book, monday):
    """09:00-09:30 booked; 09:15 would start inside it."""
    assert book(at(monday, 9)).status_code == 201
    r = book(at(monday, 9, 15))
    assert r.status_code == 409
    assert r.json()["conflicting_appointment_ids"]


def test_overlap_from_the_other_side_is_refused(book, monday, long_service):
    """09:30-10:30 booked; a 60-min slot at 09:00 would swallow its start."""
    assert book(at(monday, 9, 30)).status_code == 201
    r = book(at(monday, 9), service_id=long_service["id"])
    assert r.status_code == 409


def test_enclosing_appointment_is_refused(book, monday, long_service, consult):
    """A long appointment fully containing a short one still conflicts."""
    assert book(at(monday, 10), service_id=consult["id"]).status_code == 201
    r = book(at(monday, 9, 45), service_id=long_service["id"])
    assert r.status_code == 409


def test_back_to_back_is_allowed(book, monday):
    """09:00-09:30 then 09:30-10:00 do not overlap: boundaries are exclusive."""
    assert book(at(monday, 9)).status_code == 201
    r = book(at(monday, 9, 30))
    assert r.status_code == 201, r.text


def test_same_time_different_staff_is_allowed(book, monday, other_doctor):
    """Conflicts are per staff member, not global."""
    assert book(at(monday, 9)).status_code == 201
    r = book(at(monday, 9), staff_id=other_doctor["id"])
    assert r.status_code == 201, r.text


def test_cancelled_slot_can_be_rebooked(client, book, monday, other_patient):
    first = book(at(monday, 9)).json()
    assert (
        client.patch(
            f"/api/appointments/{first['id']}/status", json={"status": "cancelled"}
        ).status_code
        == 200
    )
    r = book(at(monday, 9), patient_id=other_patient["id"])
    assert r.status_code == 201, r.text


def test_no_show_slot_can_be_rebooked(client, book, monday, other_patient):
    first = book(at(monday, 9)).json()
    client.patch(f"/api/appointments/{first['id']}/status", json={"status": "no_show"})
    assert book(at(monday, 9), patient_id=other_patient["id"]).status_code == 201


def test_completed_slot_still_blocks(client, book, monday, other_patient):
    """A finished visit is history: its slot is not free for a second booking."""
    first = book(at(monday, 9)).json()
    client.patch(f"/api/appointments/{first['id']}/status", json={"status": "completed"})
    assert book(at(monday, 9), patient_id=other_patient["id"]).status_code == 409


def test_conflict_response_names_the_clash(book, monday):
    book(at(monday, 9))
    body = book(at(monday, 9, 10)).json()
    assert "09:00" in body["message"] and "09:30" in body["message"]
    assert body["conflicting_appointments"][0]["patient_name"] == "Ana Cruz"


def test_unknown_patient_is_rejected(book, monday):
    r = book(at(monday, 9), patient_id=9999)
    assert r.status_code == 404
    assert r.json()["code"] == "not_found"


# --------------------------------------------------------------------------
# The booking horizon: now is a floor as well as a ceiling
# --------------------------------------------------------------------------

def test_booking_in_the_past_is_rejected(client, book):
    """Yesterday is not a slot.

    Without this the system accepted a booking for a time that had already
    gone and then counted it in utilisation and reminders, producing numbers
    about work nobody could still do.
    """
    yesterday = clinic_today() - timedelta(days=1)
    r = book(at(yesterday, 10))
    assert r.status_code == 422
    body = r.json()
    assert body["code"] == "validation_error"
    assert "past" in body["message"].lower()


def test_earlier_today_is_rejected(client, book):
    """Not just past dates — a time earlier today has passed too."""
    long_past = clinic_now() - timedelta(hours=4)
    assert book(long_past.replace(microsecond=0).isoformat()).status_code == 422


def test_grace_window_allows_the_slot_just_begun(client, book):
    """A booking submitted moments after its start time still goes through.

    Someone who opens the form at 13:58 for a 14:00 slot and submits at 14:01
    is booking the present. Bouncing them would be baffling, so the floor sits
    a few minutes back.
    """
    just_now = clinic_now() - timedelta(minutes=2)
    assert book(just_now.replace(microsecond=0).isoformat()).status_code == 201


def test_rescheduling_into_the_past_is_rejected(client, book, monday):
    created = book(at(monday, 10)).json()
    yesterday = clinic_today() - timedelta(days=1)
    r = client.patch(
        f"/api/appointments/{created['id']}/reschedule",
        json={"starts_at": at(yesterday, 10)},
    )
    assert r.status_code == 422
    assert "past" in r.json()["message"].lower()

    # The appointment did not move.
    assert client.get(f"/api/appointments/{created['id']}").json()[
        "starts_at"
    ] == at(monday, 10)


# --------------------------------------------------------------------------
# Deactivated staff and services take no new bookings
# --------------------------------------------------------------------------

def test_deactivated_staff_cannot_be_booked(client, book, doctor, monday):
    client.patch(f"/api/staff/{doctor['id']}", json={"is_active": False})
    r = book(at(monday, 10))
    assert r.status_code == 422
    assert "deactivated" in r.json()["message"].lower()


def test_deactivated_service_cannot_be_booked(client, book, consult, monday):
    client.patch(f"/api/services/{consult['id']}", json={"is_active": False})
    assert book(at(monday, 10)).status_code == 422


def test_deactivating_staff_preserves_existing_appointments(
    client, book, doctor, monday
):
    """Deactivating is not deleting.

    The appointments a departing doctor already holds must survive, stay
    readable and keep appearing in reports — otherwise history silently
    rewrites itself the moment someone leaves.
    """
    created = book(at(monday, 10)).json()
    client.patch(f"/api/staff/{doctor['id']}", json={"is_active": False})

    assert client.get(f"/api/appointments/{created['id']}").status_code == 200
    rows = client.get("/api/reports/utilisation").json()["staff"]
    assert any(r["staff_id"] == doctor["id"] for r in rows)


def test_cannot_reschedule_onto_deactivated_staff(client, book, doctor, monday):
    created = book(at(monday, 10)).json()
    other = client.post(
        "/api/staff", json={"full_name": "Dr. Gone", "role": "Dentist"}
    ).json()
    client.patch(f"/api/staff/{other['id']}", json={"is_active": False})

    r = client.patch(
        f"/api/appointments/{created['id']}/reschedule",
        json={"starts_at": at(monday, 11), "staff_id": other["id"]},
    )
    assert r.status_code == 422
    assert "deactivated" in r.json()["message"].lower()


def test_existing_appointment_still_moves_after_its_staff_is_deactivated(
    client, book, doctor, monday
):
    """Tidying a departing doctor's calendar must stay possible.

    Only what the caller explicitly changes is checked for being active, so
    shifting the time of an appointment already on a deactivated staff member
    is allowed — it is not a new booking on them.
    """
    created = book(at(monday, 10)).json()
    client.patch(f"/api/staff/{doctor['id']}", json={"is_active": False})

    r = client.patch(
        f"/api/appointments/{created['id']}/reschedule",
        json={"starts_at": at(monday, 14)},
    )
    assert r.status_code == 200
