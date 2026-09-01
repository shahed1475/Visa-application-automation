import type { ZodError } from 'zod';
import type { ApiError } from '../../shared/types.js';

export function errorBody(code: string, message: string): ApiError {
  return { error: { code, message } };
}

export function validationError(err: ZodError): ApiError {
  const message = err.issues
    .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
    .join('; ');
  return errorBody('VALIDATION_ERROR', message);
}

export function notFoundError(what: string): ApiError {
  return errorBody('NOT_FOUND', `${what} not found`);
}
