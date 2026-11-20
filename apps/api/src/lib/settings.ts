import { eq } from 'drizzle-orm';
import type { Conn } from '../db/client.js';
import { clinic_settings } from '../db/schema.js';
import { env } from '../env.js';

/** The clinic's time zone, from the settings row (admin-editable). */
export async function getClinicZone(db: Conn): Promise<string> {
  const [row] = await db
    .select({ timezone: clinic_settings.timezone })
    .from(clinic_settings)
    .where(eq(clinic_settings.id, 1));
  return row?.timezone ?? env.DEFAULT_CLINIC_TIMEZONE;
}
