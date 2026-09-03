import pino from 'pino';
import { env } from './env.js';

export const REDACT_PATHS = [
  // Phase 0 groundwork
  'passportNumber', 'passport_number', 'dateOfBirth', 'date_of_birth', 'dob',
  'address', 'documentText', 'mrz', 'applicant', 'password', 'token',
  'req.headers.authorization', 'req.headers.cookie',
  '*.passportNumber', '*.mrz', '*.dateOfBirth',
  // Phase 2 — applicant profile data
  'rawValue', 'raw_value',
  'surname', 'givenNames', 'given_names', 'fullNameAsInPassport', 'full_name_as_in_passport',
  'placeOfBirth', 'place_of_birth',
  'email', 'phone', 'altPhone', 'alt_phone',
  'line1', 'line2', 'postalCode', 'postal_code',
  'issuingAuthority', 'issuing_authority',
  '*.rawValue', '*.raw_value',
  '*.surname', '*.givenNames', '*.given_names',
  '*.passportNumber', '*.dateOfBirth', '*.date_of_birth',
  '*.email', '*.phone', '*.line1', '*.line2', '*.postalCode',
  // Phase 3 — document extraction
  // `documentText` + `mrz` (and `*.mrz`) already redacted from Phase 0;
  // `rawValue` / `raw_value` (and `*.` variants) already redacted from Phase 2.
  // pino redaction is not recursive: a bare key catches top-level, `*.key`
  // catches exactly one level deep — deliberate belt-and-suspenders scope.
  'ocrText', 'mrzLine', 'mrzLines', 'extractedFields', 'text', 'lines', 'fields',
  '*.ocrText', '*.mrzLine', '*.mrzLines', '*.extractedFields', '*.text', '*.lines', '*.fields',
];

/**
 * `redact` works on object paths and cannot reach a *substring* of `req.url`, but
 * the applicant search sends PII there — `GET /api/applicants?q=AB1234567` carries
 * a passport number or an email address. Drop the query string outright; no route
 * logs or needs it (the route layer does no logging at all, and the only
 * query-string consumer is `?q=`, whose value is exactly the thing to hide).
 */
export function redactQueryString(url: string): string {
  const cut = url.indexOf('?');
  return cut === -1 ? url : `${url.slice(0, cut)}?[REDACTED]`;
}

interface LoggableRequest {
  method?: string;
  url?: string;
  hostname?: string;
  ip?: string;
  headers?: Record<string, unknown>;
  socket?: { remoteAddress?: string };
}

/**
 * Replaces pino's default `req` serializer (which emits the full URL including the
 * query string, plus every header). Only method / path / host / remote address are
 * kept — headers never reach the log at all.
 */
export function serializeRequest(req: LoggableRequest): {
  method: string | undefined;
  url: string;
  host: string | undefined;
  remoteAddress: string | undefined;
} {
  const host =
    req.hostname ?? (typeof req.headers?.host === 'string' ? req.headers.host : undefined);
  return {
    method: req.method,
    url: redactQueryString(req.url ?? ''),
    host,
    remoteAddress: req.ip ?? req.socket?.remoteAddress,
  };
}

/** Exported so tests can build an identically-configured logger over a capture stream. */
export const loggerOptions = {
  level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  serializers: { req: serializeRequest },
  transport:
    env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
} satisfies pino.LoggerOptions;

export const logger = pino(loggerOptions);
