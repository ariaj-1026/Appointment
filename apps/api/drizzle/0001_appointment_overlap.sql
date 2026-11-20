-- The database itself refuses double-booking: no two slot-holding appointments
-- for the same staff member may overlap. '[)' makes the range half-open, so a
-- 09:00-09:30 visit and a 09:30-10:00 visit do not collide (back-to-back is fine).
-- Statuses must match SLOT_BLOCKING_STATUSES in packages/shared.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "appointments"
  ADD CONSTRAINT "ex_appointments_no_overlap"
  EXCLUDE USING gist (
    "staff_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  )
  WHERE ("status" IN ('pending', 'scheduled', 'confirmed', 'completed'));
--> statement-breakpoint
INSERT INTO "clinic_settings" ("id") VALUES (1) ON CONFLICT DO NOTHING;
