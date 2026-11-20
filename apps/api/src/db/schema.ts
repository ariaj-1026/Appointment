/**
 * Database schema. Property names are snake_case on purpose: they match the
 * column names and the JSON the API returns (v1's contract), so rows need no
 * key renaming on the way out.
 *
 * Every timestamp is `timestamptz` (an instant). Business hours are `time`
 * (a wall-clock reading) and are interpreted in the clinic time zone stored in
 * `clinic_settings`.
 *
 * The no-double-booking exclusion constraint on `appointments` cannot be
 * expressed in Drizzle; it lives in a hand-written migration
 * (drizzle/0001_appointment_overlap.sql).
 */
import { relations, sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { APPOINTMENT_STATUSES, DEFAULT_TIMEZONE, ROLES } from '@clinic/shared';

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    /** Always stored lower-cased. */
    email: text('email').notNull(),
    /** Null for Google-only patient accounts. */
    password_hash: text('password_hash'),
    google_id: text('google_id').unique(),
    role: text('role', { enum: ROLES }).notNull(),
    full_name: text('full_name').notNull(),
    is_active: boolean('is_active').notNull().default(true),
    created_by: integer('created_by'),
    created_at: tstz('created_at').notNull().defaultNow(),
    last_login_at: tstz('last_login_at'),
  },
  (t) => [
    uniqueIndex('uq_users_email').on(t.email),
    check('ck_users_role', sql`${t.role} in (${inList(ROLES)})`),
  ],
);

export const password_resets = pgTable('password_resets', {
  id: serial('id').primaryKey(),
  user_id: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  token_hash: text('token_hash').notNull().unique(),
  expires_at: tstz('expires_at').notNull(),
  used_at: tstz('used_at'),
  created_at: tstz('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Clinic
// ---------------------------------------------------------------------------

/** Single row (id = 1). */
export const clinic_settings = pgTable(
  'clinic_settings',
  {
    id: integer('id').primaryKey().default(1),
    timezone: text('timezone').notNull().default(DEFAULT_TIMEZONE),
    updated_by: integer('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updated_at: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [check('ck_clinic_settings_singleton', sql`${t.id} = 1`)],
);

export const staff = pgTable('staff', {
  id: serial('id').primaryKey(),
  full_name: text('full_name').notNull(),
  role: text('role').notNull(),
  is_active: boolean('is_active').notNull().default(true),
  /** The employee login linked to this staff member, if any. */
  user_id: integer('user_id')
    .unique()
    .references(() => users.id, { onDelete: 'set null' }),
});

export const services = pgTable(
  'services',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull().unique(),
    duration_minutes: integer('duration_minutes').notNull(),
    description: text('description'),
    is_active: boolean('is_active').notNull().default(true),
  },
  (t) => [
    check('ck_services_duration', sql`${t.duration_minutes} > 0 and ${t.duration_minutes} <= 600`),
  ],
);

export const patients = pgTable(
  'patients',
  {
    id: serial('id').primaryKey(),
    first_name: text('first_name').notNull(),
    last_name: text('last_name').notNull(),
    phone: text('phone').notNull(),
    email: text('email'),
    date_of_birth: date('date_of_birth', { mode: 'string' }),
    notes: text('notes'),
    /** Null for walk-in patients without a portal account. */
    user_id: integer('user_id')
      .unique()
      .references(() => users.id, { onDelete: 'set null' }),
    created_at: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [index('ix_patients_name').on(t.last_name, t.first_name)],
);

/**
 * One open window for one staff member on one weekday (0 = Monday).
 * No rows at all = unrestricted; once any row exists, missing days are closed.
 * Several rows per day express split shifts.
 */
export const business_hours = pgTable(
  'business_hours',
  {
    id: serial('id').primaryKey(),
    staff_id: integer('staff_id')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    weekday: integer('weekday').notNull(),
    opens_at: time('opens_at').notNull(),
    closes_at: time('closes_at').notNull(),
  },
  (t) => [
    unique('uq_business_hours_slot').on(t.staff_id, t.weekday, t.opens_at),
    check('ck_business_hours_weekday', sql`${t.weekday} between 0 and 6`),
    check('ck_business_hours_order', sql`${t.opens_at} < ${t.closes_at}`),
  ],
);

export const appointments = pgTable(
  'appointments',
  {
    id: serial('id').primaryKey(),
    patient_id: integer('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    staff_id: integer('staff_id')
      .notNull()
      .references(() => staff.id),
    service_id: integer('service_id')
      .notNull()
      .references(() => services.id),
    starts_at: tstz('starts_at').notNull(),
    /** starts_at + service duration, fixed at booking time. */
    ends_at: tstz('ends_at').notNull(),
    status: text('status', { enum: APPOINTMENT_STATUSES }).notNull().default('scheduled'),
    reason: text('reason'),
    booked_via: text('booked_via', { enum: ['employee', 'patient'] })
      .notNull()
      .default('employee'),
    created_by: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    /** Who approved/declined a patient request, and why. */
    decision_by: integer('decision_by').references(() => users.id, { onDelete: 'set null' }),
    decision_reason: text('decision_reason'),
    created_at: tstz('created_at').notNull().defaultNow(),
    updated_at: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('ck_appointments_time_order', sql`${t.starts_at} < ${t.ends_at}`),
    check('ck_appointments_status', sql`${t.status} in (${inList(APPOINTMENT_STATUSES)})`),
    index('ix_appointments_staff_window').on(t.staff_id, t.starts_at, t.ends_at),
    index('ix_appointments_starts_at').on(t.starts_at),
    index('ix_appointments_patient').on(t.patient_id),
    index('ix_appointments_status').on(t.status),
  ],
);

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

/**
 * Append-only record of who did what. Covers logins as well as every write.
 * Replaces v1 `audit_logs`; an appointment's history is the rows with
 * entity = 'appointment'. `before` / `after` hold the changed fields
 * (or a full snapshot for deletes).
 */
export const activity_log = pgTable(
  'activity_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    user_id: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    actor_role: text('actor_role'),
    action: text('action').notNull(),
    entity: text('entity'),
    entity_id: integer('entity_id'),
    before: jsonb('before').$type<Record<string, unknown>>(),
    after: jsonb('after').$type<Record<string, unknown>>(),
    note: text('note'),
    ip: text('ip'),
    user_agent: text('user_agent'),
    created_at: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('ix_activity_entity').on(t.entity, t.entity_id, t.created_at),
    index('ix_activity_user').on(t.user_id, t.created_at),
    index('ix_activity_created').on(t.created_at),
  ],
);

/**
 * In-app and email notifications. For email it doubles as the send log: a
 * reminder is not resent while a `sent` row exists for the same
 * appointment + type + channel. Replaces v1 `reminder_logs`.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: serial('id').primaryKey(),
    type: text('type').notNull(),
    channel: text('channel', { enum: ['email', 'in_app'] }).notNull(),
    /** 'user' → user_id; 'employees' → shared employee inbox. */
    audience: text('audience', { enum: ['user', 'employees'] })
      .notNull()
      .default('user'),
    user_id: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
    appointment_id: integer('appointment_id').references(() => appointments.id, {
      onDelete: 'cascade',
    }),
    recipient: text('recipient'),
    status: text('status', { enum: ['sent', 'failed', 'skipped'] }).notNull(),
    title: text('title'),
    detail: text('detail'),
    read_at: tstz('read_at'),
    created_at: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('ix_notifications_dedupe').on(t.appointment_id, t.type, t.channel, t.status),
    index('ix_notifications_inbox').on(t.audience, t.user_id, t.read_at),
  ],
);

// ---------------------------------------------------------------------------
// Relations (for db.query.*)
// ---------------------------------------------------------------------------

export const appointmentsRelations = relations(appointments, ({ one }) => ({
  patient: one(patients, { fields: [appointments.patient_id], references: [patients.id] }),
  staff: one(staff, { fields: [appointments.staff_id], references: [staff.id] }),
  service: one(services, { fields: [appointments.service_id], references: [services.id] }),
}));

export const patientsRelations = relations(patients, ({ many }) => ({
  appointments: many(appointments),
}));

export const staffRelations = relations(staff, ({ many }) => ({
  appointments: many(appointments),
  business_hours: many(business_hours),
}));

export const servicesRelations = relations(services, ({ many }) => ({
  appointments: many(appointments),
}));

export const businessHoursRelations = relations(business_hours, ({ one }) => ({
  staff: one(staff, { fields: [business_hours.staff_id], references: [staff.id] }),
}));

export type Appointment = typeof appointments.$inferSelect;
export type Patient = typeof patients.$inferSelect;
export type Staff = typeof staff.$inferSelect;
export type Service = typeof services.$inferSelect;
export type BusinessHour = typeof business_hours.$inferSelect;
export type User = typeof users.$inferSelect;
