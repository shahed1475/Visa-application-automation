import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function makeTempDbPath(): string {
  return path.join(tmpdir(), `visa-autofill-test-${randomUUID()}.db`);
}

export function cleanupTempDb(dbPath: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(dbPath + suffix, { force: true });
  }
}
