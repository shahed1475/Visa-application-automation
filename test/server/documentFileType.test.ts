import { describe, expect, it } from 'vitest';
import {
  MAX_DOCUMENT_BYTES,
  UploadError,
  sniffMime,
  validateUpload,
} from '../../src/server/documents/fileType.js';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const PDF = new Uint8Array([...Buffer.from('%PDF-1.4\n', 'ascii')]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

describe('sniffMime', () => {
  it('recognises a JPEG prefix FF D8 FF', () => {
    expect(sniffMime(JPEG)).toBe('image/jpeg');
  });

  it('recognises the 8-byte PNG signature', () => {
    expect(sniffMime(PNG)).toBe('image/png');
  });

  it('recognises the %PDF- prefix', () => {
    expect(sniffMime(PDF)).toBe('application/pdf');
  });

  it('returns null for a GIF header', () => {
    expect(sniffMime(GIF)).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(sniffMime(new Uint8Array(0))).toBeNull();
  });

  it('returns null for input shorter than 5 bytes', () => {
    expect(sniffMime(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBeNull();
  });

  it('returns null for a truncated PNG signature', () => {
    expect(sniffMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a]))).toBeNull();
  });
});

describe('validateUpload', () => {
  it('accepts a JPEG and returns its mime', () => {
    expect(validateUpload(JPEG)).toEqual({ mime: 'image/jpeg' });
  });

  it('rejects empty input with code "empty"', () => {
    try {
      validateUpload(new Uint8Array(0));
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(UploadError);
      expect((err as UploadError).code).toBe('empty');
    }
  });

  it('rejects oversize input with code "too_large" (checked before type)', () => {
    const big = Buffer.alloc(MAX_DOCUMENT_BYTES + 1);
    big[0] = 0xff;
    big[1] = 0xd8;
    big[2] = 0xff;
    try {
      validateUpload(big);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(UploadError);
      expect((err as UploadError).code).toBe('too_large');
    }
  });

  it('rejects an unsupported type with code "unsupported_type"', () => {
    try {
      validateUpload(GIF);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(UploadError);
      expect((err as UploadError).code).toBe('unsupported_type');
    }
  });

  it('does not put file bytes or absolute paths in the error message', () => {
    try {
      validateUpload(GIF);
    } catch (err) {
      expect((err as UploadError).message).toBe('unsupported_type');
    }
  });
});
