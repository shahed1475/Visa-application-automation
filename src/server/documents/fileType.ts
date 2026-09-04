export type SniffedMime = 'image/jpeg' | 'image/png' | 'application/pdf';

export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;

export class UploadError extends Error {
  constructor(
    public readonly code: 'too_large' | 'empty' | 'unsupported_type',
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'UploadError';
  }
}

const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

function hasPrefix(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i += 1) {
    if (bytes[i] !== magic[i]) return false;
  }
  return true;
}

export function sniffMime(bytes: Uint8Array): SniffedMime | null {
  if (hasPrefix(bytes, JPEG_MAGIC)) return 'image/jpeg';
  if (hasPrefix(bytes, PNG_MAGIC)) return 'image/png';
  if (hasPrefix(bytes, PDF_MAGIC)) return 'application/pdf';
  return null;
}

export function validateUpload(bytes: Uint8Array): { mime: SniffedMime } {
  if (bytes.length === 0) throw new UploadError('empty');
  if (bytes.length > MAX_DOCUMENT_BYTES) throw new UploadError('too_large');
  const mime = sniffMime(bytes);
  if (mime === null) throw new UploadError('unsupported_type');
  return { mime };
}
