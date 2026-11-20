"""Phase 2: business-hours validation."""

from tests.conftest import at, next_weekday


def set_hours(client, staff_id, windows):
    r = client.put(f"/api/staff/{staff_id}/business-hours", json=windows)
    assert r.status_code == 200, r.text
    return r.json()


WEEKDAYS_9_TO_5 = [
    {"weekday": d, "opens_at": "09:00:00", "closes_at": "17:00:00"} for d in range(5)
]


def test_no_hours_configured_means_unrestricted(book, monday):
    """Hours are opt-in, so a staff member without them can be booked anytime."""
    assert book(at(monday, 3)).status_code == 201


def test_inside_hours_is_allowed(client, book, doctor, monday):
    set_hours(client, doctor["id"], WEEKDAYS_9_TO_5)
    assert book(at(monday, 10)).status_code == 201, "10:00 is inside 09:00-17:00"


def test_before_opening_is_refused(client, book, doctor, monday):
    set_hours(client, doctor["id"], WEEKDAYS_9_TO_5)
    r = book(at(monday, 8))
    assert r.status_code == 422
    assert r.json()["code"] == "outside_business_hours"


def test_appointment_ending_after_close_is_refused(client, book, doctor, monday):
    """16:45 + 30 min would run to 17:15, past a 17:00 close."""
    set_hours(client, doctor["id"], WEEKDAYS_9_TO_5)
    r = book(at(monday, 16, 45))
    assert r.status_code == 422
    assert "16:45" in r.json()["message"]


def test_appointment_ending_exactly_at_close_is_allowed(client, book, doctor, monday):
    set_hours(client, doctor["id"], WEEKDAYS_9_TO_5)
    assert book(at(monday, 16, 30)).status_code == 201


def test_closed_weekday_is_refused(client, book, doctor):
    set_hours(client, doctor["id"], WEEKDAYS_9_TO_5)
    saturday = next_weekday(5)
    r = book(at(saturday, 10))
    assert r.status_code == 422
    assert "Saturday" in r.json()["message"]
    assert "Monday" in r.json()["message"], "should name the open days"


def test_split_shift_rejects_the_lunch_gap(client, book, doctor, monday):
    """Two windows a day express a break; the gap between them is closed."""
    set_hours(
        client,
        doctor["id"],
        [
            {"weekday": 0, "opens_at": "09:00:00", "closes_at": "12:00:00"},
            {"weekday": 0, "opens_at": "13:00:00", "closes_at": "17:00:00"},
        ],
    )
    assert book(at(monday, 11, 30)).status_code == 201
    assert book(at(monday, 13)).status_code == 201
    r = book(at(monday, 12, 15))
    assert r.status_code == 422, "12:15 falls in the lunch break"


def test_appointment_straddling_two_windows_is_refused(client, book, doctor, monday):
    """11:45-12:15 is not inside either window, even though both are open."""
    set_hours(
        client,
        doctor["id"],
        [
            {"weekday": 0, "opens_at": "09:00:00", "closes_at": "12:00:00"},
            {"weekday": 0, "opens_at": "12:00:00", "closes_at": "17:00:00"},
        ],
    )
    assert book(at(monday, 11, 45)).status_code == 422


def test_hours_are_per_staff_member(client, book, doctor, other_doctor, monday):
    set_hours(client, doctor["id"], WEEKDAYS_9_TO_5)
    # other_doctor has no hours, so is unrestricted at 08:00
    assert book(at(monday, 8)).status_code == 422
    assert book(at(monday, 8), staff_id=other_doctor["id"]).status_code == 201


def test_overlapping_windows_are_rejected(client, doctor):
    r = client.put(
        f"/api/staff/{doctor['id']}/business-hours",
        json=[
            {"weekday": 0, "opens_at": "09:00:00", "closes_at": "13:00:00"},
            {"weekday": 0, "opens_at": "12:00:00", "closes_at": "17:00:00"},
        ],
    )
    assert r.status_code == 422
    assert r.json()["code"] == "validation_error"


def test_backwards_window_is_rejected(client, doctor):
    r = client.put(
        f"/api/staff/{doctor['id']}/business-hours",
        json=[{"weekday": 0, "opens_at": "17:00:00", "closes_at": "09:00:00"}],
    )
    assert r.status_code == 422


def test_hours_can_be_replaced_and_cleared(client, doctor):
    set_hours(client, doctor["id"], WEEKDAYS_9_TO_5)
    assert len(set_hours(client, doctor["id"], [])) == 0
