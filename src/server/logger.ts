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
];

export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  transport:
    env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});
