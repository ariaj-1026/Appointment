import { z } from 'zod';
import { ValidationError } from './errors.js';

/** Parse with zod, turning failures into a 422 `validation_error` payload. */
export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  const issues = result.error.issues.map((i) => ({
    field: i.path.join('.') || null,
    message: i.message,
  }));
  const first = issues[0]!;
  throw new ValidationError(first.field ? `${first.field}: ${first.message}` : first.message, {
    issues,
  });
}

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date as YYYY-MM-DD');
export const clockTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Expected a time as HH:MM')
  .transform((v) => (v.length === 5 ? `${v}:00` : v));
export const id = z.coerce.number().int().positive();
export const idParams = z.object({ id });
/** Query-string boolean: "true"/"1" → true. */
export const queryBool = z
  .union([z.boolean(), z.string()])
  .transform((v) => v === true || v === 'true' || v === '1');
