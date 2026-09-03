import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  deleteOriginal,
  readOriginal,
  sha256Hex,
  storeOriginal,
} from '../../src/server/documents/storage.js';

const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0x01, 0x02, 0x03]);

describe('sha256Hex', () => {
  it('produces the known SHA-256 of an empty input', () => {
    expect(sha256Hex(new Uint8Array(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('is stable for the same bytes', () => {
    expect(sha256Hex(BYTES)).toBe(sha256Hex(new Uint8Array(BYTES)));
  });
});

describe('storeOriginal / readOriginal / deleteOriginal', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), `visa-autofill-docs-${randomUUID()}-`));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('stores a file and returns the forward-slash relative path', () => {
    const rel = storeOriginal('abc123', 'jpg', BYTES, tmp);
    expect(rel).toBe('abc123/original.jpg');
    expect(existsSync(path.join(tmp, 'abc123', 'original.jpg'))).toBe(true);
  });

  it('round-trips through readOriginal', () => {
    const rel = storeOriginal('abc123', 'jpg', BYTES, tmp);
    expect(new Uint8Array(readOriginal(rel, tmp))).toEqual(BYTES);
  });

  it('deleteOriginal removes the file and the now-empty id dir', () => {
    const rel = storeOriginal('abc123', 'jpg', BYTES, tmp);
    deleteOriginal(rel, tmp);
    expect(existsSync(path.join(tmp, 'abc123', 'original.jpg'))).toBe(false);
    expect(existsSync(path.join(tmp, 'abc123'))).toBe(false);
  });

  it('rejects a documentId containing ".."', () => {
    expect(() => storeOriginal('../evil', 'jpg', BYTES, tmp)).toThrow();
  });

  it('rejects a documentId that is not a plain path segment', () => {
    expect(() => storeOriginal('a/b', 'jpg', BYTES, tmp)).toThrow();
    expect(() => storeOriginal('', 'jpg', BYTES, tmp)).toThrow();
  });

  it('rejects a storagePath containing ".." on read', () => {
    expect(() => readOriginal('../../etc/passwd', tmp)).toThrow();
  });

  it('rejects a storagePath containing ".." on delete', () => {
    expect(() => deleteOriginal('../../etc/passwd', tmp)).toThrow();
  });
});
