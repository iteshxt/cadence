import type { ApiErrorBody } from '@cadence/shared';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError, validationError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';

export const notFoundHandler: RequestHandler = (req, res) => {
  const body: ApiErrorBody = {
    error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` },
  };
  res.status(404).json(body);
};

export function errorHandler(log: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    let appErr: AppError;
    if (err instanceof AppError) appErr = err;
    else if (err instanceof ZodError) appErr = validationError(err);
    else if (err?.type === 'entity.too.large')
      appErr = new AppError(413, 'VALIDATION_ERROR', 'Request body is too large');
    else if (err?.type === 'entity.parse.failed')
      appErr = new AppError(400, 'VALIDATION_ERROR', 'Request body is not valid JSON');
    else {
      log.error({ err, method: req.method, path: req.path }, 'unhandled error');
      appErr = new AppError(500, 'INTERNAL', 'Unexpected server error. It has been logged.');
    }
    if (res.headersSent) return;
    const body: ApiErrorBody = {
      error: {
        code: appErr.code,
        message: appErr.message,
        ...(appErr.details !== undefined ? { details: appErr.details } : {}),
      },
    };
    res.status(appErr.status).json(body);
  };
}
