"""Phase 1: the appointment status machine."""

import pytest

from tests.conftest import at


def test_new_appointment_is_scheduled(book, monday):
    assert book(at(monday, 9)).json()["status"] == "scheduled"


@pytest.mark.parametrize("target", ["confirmed", "completed", "cancelled", "no_show"])
def test_scheduled_can_move_anywhere(client, book, monday, target):
    appt = book(at(monday, 9)).json()
    r = client.patch(f"/api/appointments/{appt['id']}/status", json={"status": target})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == target


def test_confirmed_cannot_go_back_to_scheduled(client, book, monday):
    appt = book(at(monday, 9)).json()
    client.patch(f"/api/appointments/{appt['id']}/status", json={"status": "confirmed"})
    r = client.patch(
        f"/api/appointments/{appt['id']}/status", json={"status": "scheduled"}
    )
    assert r.status_code == 422
    assert r.json()["code"] == "invalid_status_transition"


@pytest.mark.parametrize("terminal", ["completed", "cancelled", "no_show"])
def test_terminal_statuses_are_final(client, book, monday, terminal):
    appt = book(at(monday, 9)).json()
    client.patch(f"/api/appointments/{appt['id']}/status", json={"status": terminal})
    r = client.patch(
        f"/api/appointments/{appt['id']}/status", json={"status": "confirmed"}
    )
    assert r.status_code == 422
    assert r.json()["current_status"] == terminal


def test_setting_the_same_status_is_rejected(client, book, monday):
    appt = book(at(monday, 9)).json()
    r = client.patch(
        f"/api/appointments/{appt['id']}/status", json={"status": "scheduled"}
    )
    assert r.status_code == 422
    assert "already scheduled" in r.json()["message"]


def test_error_lists_the_legal_moves(client, book, monday):
    appt = book(at(monday, 9)).json()
    client.patch(f"/api/appointments/{appt['id']}/status", json={"status": "confirmed"})
    body = client.patch(
        f"/api/appointments/{appt['id']}/status", json={"status": "scheduled"}
    ).json()
    assert set(body["allowed"]) == {"cancelled", "completed", "no_show"}


def test_unknown_status_is_rejected_by_validation(client, book, monday):
    appt = book(at(monday, 9)).json()
    r = client.patch(
        f"/api/appointments/{appt['id']}/status", json={"status": "rescheduled"}
    )
    assert r.status_code == 422
