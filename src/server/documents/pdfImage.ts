/**
 * Stage 2 (spec §7): turn an uploaded PDF into a single raster image for OCR.
 *
 * Only the narrow happy path is accepted: exactly one page carrying exactly one
 * image XObject. pdfjs decodes the embedded image to raw pixels (we never get
 * the original JPEG bytes back), so the pixels are re-encoded to a PNG here with
 * a tiny dependency-free encoder (`node:zlib`).
 *
 * Hard boundaries:
 *  - Encrypted / password-protected PDF -> `pdf_encrypted`, with NO password
 *    attempt (pdfjs raises `PasswordException` before we touch it).
 *  - No worker, no eval, no network: pdfjs runs on the main thread with
 *    `isEvalSupported: false` and no font/cmap/standard-font URLs. A tiny image
 *    PDF needs none of those.
 *  - `ExtractionError.message` is only ever the bare code or a fixed short
 *    string — never bytes, paths, or any PDF content.
 */
import { deflateSync } from 'node:zlib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

export type ExtractionErrorCode =
  | 'pdf_encrypted'
  | 'pdf_unsupported'
  | 'unreadable'
  | 'not_an_image'
  | 'internal';

export class ExtractionError extends Error {
  constructor(
    public readonly code: ExtractionErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'ExtractionError';
  }
}

export interface PreparedImage {
  bytes: Uint8Array;
  mime: 'image/jpeg' | 'image/png';
  pageCount: number | null;
}

// pdfjs ImageKind
const GRAYSCALE_1BPP = 1;
const RGB_24BPP = 2;
const RGBA_32BPP = 3;

interface DecodedImage {
  width: number;
  height: number;
  kind?: number;
  data?: Uint8Array | Uint8ClampedArray;
}

export async function extractSingleImage(pdfBytes: Uint8Array): Promise<PreparedImage> {
  const task = pdfjs.getDocument({
    // pdfjs mutates the buffer it is handed; give it a private copy.
    data: new Uint8Array(pdfBytes),
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0, // errors only — no "Indexing all PDF objects" chatter
  });

  let doc: pdfjs.PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch (err) {
    // The loading task never produced a document — tear it down here, the
    // finally below only runs once `doc` exists.
    await task.destroy().catch(() => undefined);
    if (err && typeof err === 'object' && (err as { name?: string }).name === 'PasswordException') {
      throw new ExtractionError('pdf_encrypted');
    }
    throw new ExtractionError('unreadable');
  }

  try {
    const pageCount = doc.numPages;
    if (pageCount !== 1) {
      throw new ExtractionError('pdf_unsupported');
    }

    const page = await doc.getPage(1);
    const ops = await page.getOperatorList();
    const OPS = pdfjs.OPS;
    const imageNames: string[] = [];
    for (let i = 0; i < ops.fnArray.length; i += 1) {
      const fn = ops.fnArray[i];
      // pdfjs 4.x has no `paintJpegXObject` — an embedded JPEG surfaces as a
      // plain image XObject (its bytes already decoded to raster).
      if (fn === OPS.paintImageXObject || fn === OPS.paintImageXObjectRepeat) {
        const name = ops.argsArray[i]?.[0];
        if (typeof name === 'string') imageNames.push(name);
      }
    }
    if (imageNames.length !== 1) {
      throw new ExtractionError('pdf_unsupported');
    }

    // After getOperatorList() the image XObjects the op list references are
    // resolved, so the *synchronous* getter returns them. If one is somehow not
    // ready it throws synchronously — we return pdf_unsupported rather than hang
    // (the callback form has no timeout/rejection path).
    let img: DecodedImage;
    try {
      img = page.objs.get(imageNames[0]!) as DecodedImage;
    } catch {
      throw new ExtractionError('pdf_unsupported');
    }
    // pdfjs can instead hand back an ImageBitmap on `img.bitmap` (no `img.data`)
    // when @napi-rs/canvas is installed — not the case here; treat as unsupported.
    if (!img || !img.data) throw new ExtractionError('pdf_unsupported');

    const png = encodeImageToPng(img);
    return { bytes: png, mime: 'image/png', pageCount };
  } catch (err) {
    if (err instanceof ExtractionError) throw err;
    throw new ExtractionError('pdf_unsupported');
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}

function encodeImageToPng(img: DecodedImage): Uint8Array {
  const { width, height, kind, data } = img;
  if (
    !data ||
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    width <= 0 ||
    height <= 0
  ) {
    throw new ExtractionError('pdf_unsupported');
  }
  if (kind === GRAYSCALE_1BPP) {
    // 1-bit packed grayscale — rare, out of scope this phase.
    throw new ExtractionError('pdf_unsupported');
  }

  let channels: number;
  let colorType: number;
  if (kind === RGB_24BPP) {
    channels = 3;
    colorType = 2;
  } else if (kind === RGBA_32BPP) {
    channels = 4;
    colorType = 6;
  } else {
    throw new ExtractionError('pdf_unsupported');
  }

  if (data.length !== width * height * channels) {
    throw new ExtractionError('pdf_unsupported');
  }

  const src = data instanceof Uint8Array ? data : new Uint8Array(data.buffer, data.byteOffset, data.length);
  return buildPng(src, width, height, channels, colorType);
}

// --- minimal PNG encoder -------------------------------------------------------
// PNG = 8-byte signature + IHDR + IDAT (zlib deflate of filtered scanlines,
// each prefixed with filter byte 0x00 = None) + IEND. Every chunk is
// length + type + data + CRC32(type+data).

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array([...type].map((ch) => ch.charCodeAt(0)));
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);

  const out = new Uint8Array(4 + body.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(4 + body.length, crc32(body));
  return out;
}

function buildPng(
  pixels: Uint8Array,
  width: number,
  height: number,
  channels: number,
  colorType: number,
): Uint8Array {
  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, width);
  iv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * channels;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: None
    raw.set(pixels.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1);
  }

  const idat = deflateSync(raw);

  const parts = [
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(idat.buffer, idat.byteOffset, idat.length)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    png.set(p, offset);
    offset += p.length;
  }
  return png;
}
