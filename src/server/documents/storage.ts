import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { env } from '../env.js';

const SEGMENT_RE = /^[A-Za-z0-9_-]+$/;

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Resolve `rel` under `baseDir` and reject anything that escapes the store. */
function containedAbs(baseDir: string, rel: string): string {
  const root = path.resolve(baseDir);
  const abs = path.resolve(root, rel);
  if (abs === root || !abs.startsWith(root + path.sep)) {
    throw new Error('path escapes document store');
  }
  return abs;
}

export function storeOriginal(
  documentId: string,
  ext: string,
  bytes: Uint8Array,
  baseDir: string = env.DOCUMENTS_DIR,
): string {
  if (!SEGMENT_RE.test(documentId)) {
    throw new Error('invalid documentId');
  }
  const rel = `${documentId}/original.${ext}`;
  const abs = containedAbs(baseDir, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, bytes);
  return rel;
}

export function readOriginal(storagePath: string, baseDir: string = env.DOCUMENTS_DIR): Buffer {
  const abs = containedAbs(baseDir, storagePath);
  return readFileSync(abs);
}

export function deleteOriginal(storagePath: string, baseDir: string = env.DOCUMENTS_DIR): void {
  const abs = containedAbs(baseDir, storagePath);
  rmSync(abs, { force: true });
  try {
    rmdirSync(path.dirname(abs));
  } catch {
    // parent not empty, or already gone — leave it.
  }
}
