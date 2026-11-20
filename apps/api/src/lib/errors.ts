/**
 * Domain errors. The error handler in app.ts turns each into
 * `{ code, message, ...detail }` with its HTTP status — the same payload shape
 * v1 returned, so the UI can show `message` directly.
 */
export class DomainError extends Error {
  readonly statusCode: number = 400;
  readonly code: string = 'domain_error';
  constructor(
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
  }
  toPayload() {
    return { code: this.code, message: this.message, ...this.detail };
  }
}

export class NotFoundError extends DomainError {
  override readonly statusCode = 404;
  override readonly code = 'not_found';
}

/** The requested slot overlaps an appointment that still holds it. */
export class ConflictError extends DomainError {
  override readonly statusCode = 409;
  override readonly code = 'slot_conflict';
}

export class OutsideBusinessHoursError extends DomainError {
  override readonly statusCode = 422;
  override readonly code = 'outside_business_hours';
}

export class InvalidStatusTransitionError extends DomainError {
  override readonly statusCode = 422;
  override readonly code = 'invalid_status_transition';
}

export class ValidationError extends DomainError {
  override readonly statusCode = 422;
  override readonly code = 'validation_error';
}

/** Postgres error code for an exclusion-constraint violation. */
export function isOverlapViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23P01' || e?.cause?.code === '23P01';
}

export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23505' || e?.cause?.code === '23505';
}
