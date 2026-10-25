import type { ApiErrorCode } from '@cadence/shared';
import type { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what = 'Not found') => new AppError(404, 'NOT_FOUND', what);
export const unauthorized = (message = 'Sign in to continue') =>
  new AppError(401, 'UNAUTHORIZED', message);

export function validationError(error: ZodError): AppError {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] ??= issue.message;
  }
  const first = error.issues[0]?.message ?? 'Invalid request';
  return new AppError(400, 'VALIDATION_ERROR', first, { fields });
}
