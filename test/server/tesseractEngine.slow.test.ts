import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createTesseractEngine } from '../../src/server/documents/tesseractEngine.js';

describe('tesseractEngine (real OCR, slow)', () => {
  it('reads recognizable text from a synthetic MRZ image, fully offline', async () => {
    const eng = createTesseractEngine();
    try {
      const r = await eng.recognize(readFileSync('test/fixtures/documents/mrz-clean.png'));
      const up = r.text.toUpperCase();
      // lenient: the alpha tokens are what OCR reads reliably from this fixture
      expect(up).toContain('RAHMAN');
      expect(up).toContain('BGD');
      expect(r.lines.length).toBeGreaterThan(0);
      expect(r.meanConfidence).toBeGreaterThan(0);
    } finally {
      await eng.dispose();
    }
  }, 60_000);
});
