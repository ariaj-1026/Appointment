"""Phase 1: time-conflict detection — the central requirement."""

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
