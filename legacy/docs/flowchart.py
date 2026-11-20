"""Generate the system flowchart PDF for the clinic appointment scheduler.

No-login variant: the operator opens the app and works straight from setup
(staff -> services -> hours) into patients and bookings.
"""

import math
import sys

from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import simpleSplit
from reportlab.pdfgen import canvas

PAGE_H, PAGE_W = A4  # landscape: PAGE_W is the long edge

# Palette from ROADMAP.md
SURFACE = HexColor("#FFFDF5")
PRIMARY = HexColor("#F5C518")
PRIMARY_DARK = HexColor("#D4A70C")
ACCENT = HexColor("#FFF3C4")
BORDER = HexColor("#E8E3D3")
INK = HexColor("#1A1A1A")
MUTED = HexColor("#6B6B6B")
RED = HexColor("#C62828")
RED_BG = HexColor("#FDEDEC")
GREEN = HexColor("#2E7D32")
GREEN_BG = HexColor("#ECF5EC")
ORANGE = HexColor("#E65100")
GREY_BG = HexColor("#F2F2F2")

T_SIZE = 8.4
D_SIZE = 7.1
LH_T = 10.0
LH_D = 8.4

STYLES = {
    "terminal": dict(fill=PRIMARY, stroke=PRIMARY_DARK, title=INK, detail=INK, radius=11),
    "process": dict(fill=SURFACE, stroke=BORDER, title=INK, detail=MUTED, radius=3),
    "io": dict(fill=white, stroke=PRIMARY_DARK, title=INK, detail=MUTED, radius=3),
    "decision": dict(fill=ACCENT, stroke=PRIMARY_DARK, title=INK, detail=MUTED, radius=0),
    "error": dict(fill=RED_BG, stroke=RED, title=RED, detail=MUTED, radius=3),
    "good": dict(fill=GREEN_BG, stroke=GREEN, title=GREEN, detail=MUTED, radius=3),
    "state": dict(fill=white, stroke=INK, title=INK, detail=MUTED, radius=13),
    "note": dict(fill=white, stroke=BORDER, title=MUTED, detail=MUTED, radius=3),
}


class Box:
    def __init__(self, cx, cy, w, h):
        self.cx, self.cy, self.w, self.h = cx, cy, w, h

    @property
    def top(self):
        return (self.cx, self.cy + self.h / 2)

    @property
    def bottom(self):
        return (self.cx, self.cy - self.h / 2)

    @property
    def left(self):
        return (self.cx - self.w / 2, self.cy)

    @property
    def right(self):
        return (self.cx + self.w / 2, self.cy)


def _wrap(c, text, font, size, width):
    return simpleSplit(text, font, size, width)


def _measure(c, title, detail, kind, w):
    inner = w * (0.58 if kind == "decision" else 0.88)
    tl = _wrap(c, title, "Helvetica-Bold", T_SIZE, inner)
    dl = _wrap(c, detail, "Helvetica", D_SIZE, inner) if detail else []
    h = 14 + len(tl) * LH_T + (len(dl) * LH_D + 3 if dl else 0)
    if kind == "decision":
        h = max(h * 1.62, 52)
    return tl, dl, max(h, 26), inner


def node(c, kind, cx, cy, w, title, detail=None, h=None, dashed=False):
    st = STYLES[kind]
    tl, dl, auto_h, inner = _measure(c, title, detail, kind, w)
    h = h or auto_h
    b = Box(cx, cy, w, h)
    c.setLineWidth(1.1 if kind in ("terminal", "decision", "state") else 0.9)
    c.setStrokeColor(st["stroke"])
    c.setFillColor(st["fill"])
    if dashed:
        c.setDash(3, 2)
    if kind == "decision":
        p = c.beginPath()
        p.moveTo(cx, cy + h / 2)
        p.lineTo(cx + w / 2, cy)
        p.lineTo(cx, cy - h / 2)
        p.lineTo(cx - w / 2, cy)
        p.close()
        c.drawPath(p, fill=1, stroke=1)
    else:
        c.roundRect(cx - w / 2, cy - h / 2, w, h, st["radius"], fill=1, stroke=1)
    c.setDash()

    total = len(tl) * LH_T + (len(dl) * LH_D + 3 if dl else 0)
    y = cy + total / 2 - LH_T + 2.6
    c.setFont("Helvetica-Bold", T_SIZE)
    c.setFillColor(st["title"])
    for line in tl:
        c.drawCentredString(cx, y, line)
        y -= LH_T
    if dl:
        y -= 1
        c.setFont("Helvetica", D_SIZE)
        c.setFillColor(st["detail"])
        for line in dl:
            c.drawCentredString(cx, y, line)
            y -= LH_D
    return b


def _head(c, x, y, ang, size=5.4, color=INK):
    p = c.beginPath()
    p.moveTo(x, y)
    p.lineTo(
        x - size * math.cos(ang) + size * 0.45 * math.sin(ang),
        y - size * math.sin(ang) - size * 0.45 * math.cos(ang),
    )
    p.lineTo(
        x - size * math.cos(ang) - size * 0.45 * math.sin(ang),
        y - size * math.sin(ang) + size * 0.45 * math.cos(ang),
    )
    p.close()
    c.setFillColor(color)
    c.drawPath(p, fill=1, stroke=0)


def route(c, pts, label=None, color=INK, dashed=False, arrow=True,
          label_at=0, label_dx=0, label_dy=0, label_color=None, width=0.9):
    c.setStrokeColor(color)
    c.setLineWidth(width)
    if dashed:
        c.setDash(3.2, 2.4)
    p = c.beginPath()
    p.moveTo(*pts[0])
    for pt in pts[1:]:
        p.lineTo(*pt)
    c.drawPath(p, fill=0, stroke=1)
    c.setDash()
    if arrow:
        (x1, y1), (x2, y2) = pts[-2], pts[-1]
        _head(c, x2, y2, math.atan2(y2 - y1, x2 - x1), color=color)
    if label:
        (ax, ay), (bx, by) = pts[label_at], pts[label_at + 1]
        mx, my = (ax + bx) / 2 + label_dx, (ay + by) / 2 + label_dy
        c.setFont("Helvetica-Bold", 6.8)
        tw = c.stringWidth(label, "Helvetica-Bold", 6.8)
        c.setFillColor(white)
        c.rect(mx - tw / 2 - 2, my - 2.6, tw + 4, 9.4, fill=1, stroke=0)
        c.setFillColor(label_color or MUTED)
        c.drawCentredString(mx, my, label)


def down(c, a, b, label=None, **kw):
    route(c, [a.bottom, (b.cx, b.top[1])], label=label, label_dx=14, **kw)


def page_header(c, n, total, title, sub):
    c.setFillColor(PRIMARY)
    c.rect(0, PAGE_H - 4, PAGE_W, 4, fill=1, stroke=0)
    c.setFont("Helvetica-Bold", 14.5)
    c.setFillColor(INK)
    c.drawString(38, PAGE_H - 36, title)
    c.setFont("Helvetica", 8.2)
    c.setFillColor(MUTED)
    c.drawString(38, PAGE_H - 48, sub)
    c.setFont("Helvetica", 7.4)
    c.drawRightString(PAGE_W - 38, PAGE_H - 36, "Clinic Appointment Scheduling")
    c.drawRightString(PAGE_W - 38, PAGE_H - 46, f"Page {n} of {total}")
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.8)
    c.line(38, PAGE_H - 56, PAGE_W - 38, PAGE_H - 56)
    # footer
    c.setFont("Helvetica", 6.6)
    c.setFillColor(MUTED)
    c.drawString(38, 26, "Clinic appointment scheduler  ·  no login: anyone at the terminal has full access")
    c.setStrokeColor(BORDER)
    c.line(38, 36, PAGE_W - 38, 36)


def legend(c, x, y):
    items = [
        ("terminal", "Start / end"),
        ("process", "System action"),
        ("io", "Operator input"),
        ("decision", "Decision / rule check"),
        ("error", "Refused by a check"),
    ]
    c.setFont("Helvetica-Bold", 7)
    c.setFillColor(MUTED)
    c.drawString(x, y + 13, "LEGEND")
    for i, (kind, label) in enumerate(items):
        cy = y - i * 15
        st = STYLES[kind]
        c.setStrokeColor(st["stroke"])
        c.setFillColor(st["fill"])
        c.setLineWidth(0.9)
        if kind == "decision":
            p = c.beginPath()
            p.moveTo(x + 11, cy + 6)
            p.lineTo(x + 22, cy)
            p.lineTo(x + 11, cy - 6)
            p.lineTo(x, cy)
            p.close()
            c.drawPath(p, fill=1, stroke=1)
        else:
            c.roundRect(x, cy - 5, 22, 10, st["radius"] * 0.5, fill=1, stroke=1)
        c.setFont("Helvetica", 6.8)
        c.setFillColor(MUTED)
        c.drawString(x + 27, cy - 2.4, label)


# ---------------------------------------------------------------- the one page
def sheet(c):
    c.setFillColor(PRIMARY)
    c.rect(0, PAGE_H - 5, PAGE_W, 5, fill=1, stroke=0)
    c.setFont("Helvetica-Bold", 17)
    c.setFillColor(INK)
    c.drawString(38, PAGE_H - 38, "Appointment Scheduling — how the system is used")
    c.setFont("Helvetica", 9)
    c.setFillColor(MUTED)
    c.drawString(38, PAGE_H - 52, "There is no login. Anyone at the front desk opens the system and starts here.")
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.8)
    c.line(38, PAGE_H - 62, PAGE_W - 38, PAGE_H - 62)

    cx, w = 379, 270

    n1 = node(c, "terminal", cx, 510, w, "START — open the scheduler")
    n2 = node(c, "io", cx, 462, w, "Add the staff members",
              "their name and role")
    n3 = node(c, "io", cx, 414, w, "Add the services offered",
              "and how long each one takes")
    n4 = node(c, "io", cx, 366, w, "Set each staff member's working hours",
              "which days they work, and from when to when")
    n5 = node(c, "io", cx, 318, w, "Register the patient",
              "name and contact details")
    n6 = node(c, "io", cx, 270, w, "Book the visit",
              "choose the patient, the staff member, the service, and a date and time")
    d1 = node(c, "decision", cx, 196, 310, "Is that time free, and within working hours?")
    n7 = node(c, "good", cx, 124, w, "Appointment booked",
              "it appears on the calendar and the slot is held")

    down(c, n1, n2)
    down(c, n2, n3)
    down(c, n3, n4)
    down(c, n4, n5)
    down(c, n5, n6)
    down(c, n6, d1)
    down(c, d1, n7, label="Yes", color=GREEN, label_color=GREEN)

    # refusal and retry
    r1 = node(c, "error", 672, 196, 186, "Not allowed",
              "the reason is shown — the slot is taken, or it is outside working hours")
    route(c, [d1.right, r1.left], label="No", label_dy=4, color=RED, label_color=RED)
    route(c, [r1.top, (672, 270), n6.right], label="choose another time", label_at=1, label_dy=5,
          color=RED, dashed=True, label_color=RED)

    node(c, "note", 672, 360, 186, "No working hours set?",
         "Then that staff member can be booked at any time of day.", dashed=True)
    node(c, "note", 672, 452, 186, "Deactivating is not deleting",
         "A staff member or service switched off takes no new bookings, but stays on past ones.", dashed=True)

    node(c, "note", 118, 452, 160, "Before the visit",
         "A reminder goes out to patients whose appointment is in the next 24 hours.", dashed=True)
    node(c, "note", 118, 346, 160, "Changed plans?",
         "Open the appointment and pick a new time — the same check runs again.", dashed=True)
    node(c, "note", 118, 230, 160, "At the end of the day",
         "Reports show how many appointments there were, how busy each staff member was, and how many were cancelled or missed.", dashed=True)

    # outcomes
    oy, ow = 46, 172
    xs = (128, 316, 504, 692)
    o1 = node(c, "state", xs[0], oy, ow, "CONFIRMED", "the patient said they are coming")
    o2 = node(c, "state", xs[1], oy, ow, "COMPLETED", "the visit went ahead")
    o3 = node(c, "state", xs[2], oy, ow, "CANCELLED", "the slot is free for someone else")
    o4 = node(c, "state", xs[3], oy, ow, "NO-SHOW", "the patient did not arrive")

    fan = 88
    route(c, [n7.bottom, (cx, fan)], arrow=False)
    c.setFont("Helvetica-Bold", 7.2)
    c.setFillColor(MUTED)
    tw = c.stringWidth("on the day, it ends up as one of these", "Helvetica-Bold", 7.2)
    c.setFillColor(white)
    c.rect(cx + 6, fan + 3, tw + 4, 9.4, fill=1, stroke=0)
    c.setFillColor(MUTED)
    c.drawString(cx + 8, fan + 5, "on the day, it ends up as one of these")
    for o in (o1, o2, o3, o4):
        route(c, [(cx, fan), (o.cx, fan), o.top])

    c.setFont("Helvetica", 7)
    c.setFillColor(MUTED)
    c.drawCentredString(PAGE_W / 2, 13, "Cancelled and missed appointments give their time back, so the slot can be booked again. Completed, cancelled and no-show appointments are final.")


def main(path):
    c = canvas.Canvas(path, pagesize=(PAGE_W, PAGE_H))
    c.setTitle("Appointment Scheduling — how the system is used")
    sheet(c)
    c.showPage()
    c.save()
    print("wrote", path)


if __name__ == "__main__":
    main(sys.argv[1])
