import type { z } from 'zod';
import { validationError } from '../lib/errors.js';

/** Parses a request part with a shared schema, throwing a 400 with field messages on failure. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) throw validationError(result.error);
  return result.data;
}
