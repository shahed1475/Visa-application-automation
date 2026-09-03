/**
 * OCR engine contract (Phase 3, spec §6).
 *
 * An `OcrEngine` turns raw image bytes into text. It is a pixels-to-text
 * provider only: it knows nothing about passports, the MRZ, or field
 * semantics. The real implementation (`tesseractEngine.ts`, a later task) runs
 * tesseract.js WASM against a vendored model with no network access; tests use
 * `FakeOcrEngine` (`test/helpers/fakeOcrEngine.ts`).
 *
 * This module imports nothing — it is a pure type surface.
 */

export interface OcrResultLine {
  text: string;
  confidence: number;
  bbox?: [number, number, number, number];
}

export interface OcrResult {
  text: string;
  lines: OcrResultLine[];
  /** Mean per-line confidence on the tesseract 0..100 scale. */
  meanConfidence: number;
}

export interface OcrEngine {
  recognize(image: Uint8Array): Promise<OcrResult>;
  dispose(): Promise<void>;
}
