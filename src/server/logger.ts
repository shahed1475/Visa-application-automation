import pino from 'pino';
import { env } from './env.js';

export const REDACT_PATHS = [
  'passportNumber', 'passport_number', 'dateOfBirth', 'date_of_birth', 'dob',
  'address', 'documentText', 'mrz', 'applicant', 'password', 'token',
  'req.headers.authorization', 'req.headers.cookie',
  '*.passportNumber', '*.mrz', '*.dateOfBirth',
];

export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  transport:
    env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});
