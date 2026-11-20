/**
 * Demo data: 3 staff (Mon–Fri 09–12, 13–17), 5 services, 6 patients,
 * 14 appointments next week with history, 1 pending patient request,
 * and one login per role.
 *
 *   npm run db:seed -w @clinic/api            # add, keeping what exists
 *   npm run db:seed -w @clinic/api -- --reset # wipe all data first
 *
 * Demo logins (password from SEED_PASSWORD, default below):
 *   admin@clinic.local · employee@clinic.local · ana.cruz@example.com (patient)
 */
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { AppointmentStatus, Role } from '@clinic/shared';
import { createDb, type DB } from './client.js';
import * as t from './schema.js';
import { logActivity, SYSTEM_ACTOR } from '../domain/activity.js';
import { hashPassword } from '../lib/password.js';
import { getClinicZone } from '../lib/settings.js';

const PASSWORD = process.env.SEED_PASSWORD ?? 'ClinicDemo2026!';

const STAFF = [
  ['Dr. Maria Ilagan', 'General Physician'],
  ['Dr. Jose Santos', 'Dentist'],
  ['Dr. Liza Reyes', 'Pediatrician'],
] as const;

const SERVICES = [
  ['General Consultation', 30, 'Routine check-up and assessment'],
  ['Dental Cleaning', 45, 'Scaling and polishing'],
  ['Vaccination', 15, 'Single-dose immunisation'],
  ['Minor Procedure', 60, 'Outpatient procedure under local anaesthetic'],
  ['Follow-up Visit', 20, 'Review of an ongoing treatment'],
] as const;

// Which services each doctor performs (index into SERVICES).
// Ilagan (GP): consultation, vaccination, minor procedure, follow-up
// Santos (Dentist): dental cleaning, follow-up
// Reyes (Pediatrician): consultation, vaccination, follow-up
const SPECIALTIES: number[][] = [
  [0, 2, 3, 4],
  [1, 4],
  [0, 2, 4],
];

const PATIENTS = [
  ['Ana', 'Cruz', '0917-555-0101', 'ana.cruz@example.com', '1991-04-12'],
  ['Ben', 'Reyes', '0917-555-0202', 'ben.reyes@example.com', '1985-09-30'],
  ['Carla', 'Mendoza', '0917-555-0303', null, '2016-01-08'],
  ['Diego', 'Torres', '0917-555-0404', 'diego.t@example.com', '1978-06-21'],
  ['Elena', 'Villanueva', '0917-555-0505', null, '2002-11-03'],
  ['Francis', 'Bautista', '0917-555-0606', 'fbautista@example.com', '1969-02-17'],
] as const;

// (day offset from next Monday, HH:MM, staff idx, service idx, patient idx, final status)
const PLAN: [number, string, number, number, number, AppointmentStatus][] = [
  [0, '09:00', 0, 0, 0, 'confirmed'],
  [0, '09:30', 0, 4, 1, 'scheduled'],
  [0, '10:00', 0, 0, 2, 'scheduled'],
  [0, '09:00', 1, 1, 3, 'confirmed'],
  [0, '13:00', 1, 1, 4, 'scheduled'],
  [0, '11:00', 2, 2, 2, 'completed'],
  [1, '09:00', 0, 3, 5, 'scheduled'],
  [1, '10:30', 0, 0, 0, 'cancelled'],
  [1, '14:00', 1, 1, 1, 'scheduled'],
  [2, '09:30', 2, 2, 2, 'scheduled'],
  [2, '13:30', 0, 4, 3, 'no_show'],
  [3, '10:00', 0, 0, 4, 'scheduled'],
  [3, '15:00', 1, 1, 5, 'scheduled'],
  [4, '09:00', 2, 0, 0, 'scheduled'],
];

const NOTES: Partial<Record<AppointmentStatus, string>> = {
  cancelled: 'Patient called to cancel',
  no_show: 'Did not arrive',
};

async function confirm(question: string): Promise<boolean> {
  if (process.argv.includes('--yes')) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return answer.trim().toLowerCase() === 'y';
}

async function upsertUser(db: DB, email: string, role: Role, full_name: string, hash: string) {
  const [existing] = await db.select().from(t.users).where(eq(t.users.email, email));
  if (existing) return existing;
  const [row] = await db.insert(t.users).values({ email, role, full_name, password_hash: hash }).returning();
  return row!;
}

export async function seed(db: DB, { reset = false } = {}) {
  if (reset) {
    await db.execute(sql`
      TRUNCATE notifications, activity_log, appointments, business_hours, patients,
               services, staff, password_resets, users RESTART IDENTITY CASCADE`);
  }
  // TRUNCATE … CASCADE also empties clinic_settings (it references users).
  await db.insert(t.clinic_settings).values({ id: 1 }).onConflictDoNothing();
  const zone = await getClinicZone(db);
  const hash = await hashPassword(PASSWORD);

  // ---- Logins ----
  await upsertUser(db, 'admin@clinic.local', 'admin', 'Clinic Admin', hash);
  const employee = await upsertUser(db, 'employee@clinic.local', 'employee', 'Front Desk', hash);

  // ---- Staff + hours ----
  const staffRows: t.Staff[] = [];
  for (const [full_name, role] of STAFF) {
    let [member] = await db.select().from(t.staff).where(eq(t.staff.full_name, full_name));
    if (!member) {
      [member] = await db.insert(t.staff).values({ full_name, role }).returning();
      await db.insert(t.business_hours).values(
        [0, 1, 2, 3, 4].flatMap((weekday) => [
          { staff_id: member!.id, weekday, opens_at: '09:00:00', closes_at: '12:00:00' },
          { staff_id: member!.id, weekday, opens_at: '13:00:00', closes_at: '17:00:00' },
        ]),
      );
    }
    staffRows.push(member!);
  }

  // ---- Services ----
  const serviceRows: t.Service[] = [];
  for (const [name, duration_minutes, description] of SERVICES) {
    let [svc] = await db.select().from(t.services).where(eq(t.services.name, name));
    if (!svc) [svc] = await db.insert(t.services).values({ name, duration_minutes, description }).returning();
    serviceRows.push(svc!);
  }

  // ---- Specialties ----
  for (const [i, member] of staffRows.entries()) {
    await db
      .insert(t.staff_services)
      .values(SPECIALTIES[i]!.map((sv) => ({ staff_id: member.id, service_id: serviceRows[sv]!.id })))
      .onConflictDoNothing();
  }

  // ---- Patients (Ana gets a portal login) ----
  const patientRows = [];
  for (const [first_name, last_name, phone, email, date_of_birth] of PATIENTS) {
    let [p] = await db.select().from(t.patients).where(eq(t.patients.phone, phone));
    if (!p) {
      [p] = await db
        .insert(t.patients)
        .values({ first_name, last_name, phone, email, date_of_birth })
        .returning();
    }
    patientRows.push(p!);
  }
  const ana = patientRows[0]!;
  if (!ana.user_id) {
    const login = await upsertUser(db, ana.email!, 'patient', 'Ana Cruz', hash);
    await db.update(t.patients).set({ user_id: login.id }).where(eq(t.patients.id, ana.id));
  }

  // ---- Appointments ----
  if ((await db.$count(t.appointments)) > 0) {
    console.info('Appointments already present — skipping appointment seeding.');
    return;
  }

  const today = DateTime.now().setZone(zone).startOf('day');
  const monday = today.plus({ days: ((8 - today.weekday) % 7) || 7 });
  const actor = { user_id: employee.id, role: 'employee' as const };

  for (const [offset, hhmm, s, sv, p, status] of PLAN) {
    const [h, m] = hhmm.split(':').map(Number);
    const start = monday.plus({ days: offset }).set({ hour: h, minute: m });
    const service = serviceRows[sv]!;
    const starts_at = start.toJSDate();
    const ends_at = start.plus({ minutes: service.duration_minutes }).toJSDate();
    const [appt] = await db
      .insert(t.appointments)
      .values({
        patient_id: patientRows[p]!.id,
        staff_id: staffRows[s]!.id,
        service_id: service.id,
        starts_at,
        ends_at,
        status,
        created_by: employee.id,
      })
      .returning();

    // Give each appointment the history it would have had via the API.
    await logActivity(db, actor, {
      action: 'created',
      entity: 'appointment',
      entity_id: appt!.id,
      after: { status: 'scheduled', starts_at: starts_at.toISOString(), staff_id: appt!.staff_id },
    });
    const trail: AppointmentStatus[] = [];
    if (status === 'confirmed' || status === 'completed') trail.push('confirmed');
    if (status !== 'scheduled' && status !== 'confirmed') trail.push(status);
    let previous: AppointmentStatus = 'scheduled';
    for (const step of trail) {
      await logActivity(db, actor, {
        action: 'status_changed',
        entity: 'appointment',
        entity_id: appt!.id,
        before: { status: previous },
        after: { status: step },
        note: NOTES[step] ?? null,
      });
      previous = step;
    }
  }

  // One patient request awaiting approval (the Phase 3 approval queue).
  const reqStart = monday.plus({ days: 2 }).set({ hour: 15, minute: 0 });
  const [pending] = await db
    .insert(t.appointments)
    .values({
      patient_id: ana.id,
      staff_id: staffRows[0]!.id,
      service_id: serviceRows[4]!.id,
      starts_at: reqStart.toJSDate(),
      ends_at: reqStart.plus({ minutes: serviceRows[4]!.duration_minutes }).toJSDate(),
      status: 'pending',
      booked_via: 'patient',
      reason: 'Follow-up on blood test results',
    })
    .returning();
  await logActivity(db, SYSTEM_ACTOR, {
    action: 'created',
    entity: 'appointment',
    entity_id: pending!.id,
    after: { status: 'pending', starts_at: reqStart.toJSDate().toISOString(), staff_id: pending!.staff_id },
  });

  console.info(`Seeded ${PLAN.length + 1} appointments from ${monday.toISODate()} (${zone}).`);
}

// ---- CLI ----
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }
  const reset = process.argv.includes('--reset');
  if (reset && !(await confirm('This deletes ALL data in the database. Continue?'))) {
    console.info('Aborted.');
    process.exit(0);
  }
  const { db, close } = createDb(url);
  try {
    await seed(db, { reset });
    console.info(`Demo logins use password: ${PASSWORD}`);
  } finally {
    await close();
  }
}
