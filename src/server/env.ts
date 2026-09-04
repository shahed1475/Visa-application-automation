import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(5174),
  DATA_DIR: z.string().min(1).default('data'),
  PW_HEADLESS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
});

const parsed = schema.parse(process.env);
const dataDir = path.resolve(parsed.DATA_DIR);

export const env = {
  ...parsed,
  DATA_DIR: dataDir,
  DB_PATH: path.join(dataDir, 'visa-autofill.db'),
  SCREENSHOT_DIR: path.join(dataDir, 'screenshots'),
  DOCUMENTS_DIR: path.join(dataDir, 'documents'),
};
