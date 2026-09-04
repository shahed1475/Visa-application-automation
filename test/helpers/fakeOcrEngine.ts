import type { OcrEngine, OcrResult } from '../../src/server/documents/ocrEngine.js';

/**
 * Test double for `OcrEngine`. Constructed with either a fixed `OcrResult` or a
 * function of the image bytes. Records every `recognize()` argument in `calls`
 * for assertions, and flips `disposed` on `dispose()`.
 */
export class FakeOcrEngine implements OcrEngine {
  readonly calls: Uint8Array[] = [];
  disposed = false;

  #result: OcrResult | ((img: Uint8Array) => OcrResult);

  constructor(result: OcrResult | ((img: Uint8Array) => OcrResult)) {
    this.#result = result;
  }

  recognize(image: Uint8Array): Promise<OcrResult> {
    this.calls.push(image);
    const r = typeof this.#result === 'function' ? this.#result(image) : this.#result;
    return Promise.resolve(r);
  }

  dispose(): Promise<void> {
    this.disposed = true;
    return Promise.resolve();
  }
}

/** Build an `OcrResult` from plain text lines, all sharing one confidence. */
export function ocrResultFromLines(lines: string[], confidence = 88): OcrResult {
  return {
    text: lines.join('\n'),
    lines: lines.map((text) => ({ text, confidence })),
    meanConfidence: confidence,
  };
}
