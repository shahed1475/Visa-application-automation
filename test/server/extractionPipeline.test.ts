import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runExtraction } from '../../src/server/documents/extractionPipeline.js';
import { ExtractionError } from '../../src/server/documents/pdfImage.js';
import { FakeOcrEngine, ocrResultFromLines } from '../helpers/fakeOcrEngine.js';
import { ICAO_SPECIMEN, buildTd3 } from '../helpers/mrzFixtures.js';

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'documents',
);
const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(path.join(FIXTURES, name)));

const IMG = new Uint8Array([1, 2, 3]);

describe('runExtraction — MRZ primary', () => {
  it('uses the MRZ as the sole authority for its fields', async () => {
    const ocr = new FakeOcrEngine(
      ocrResultFromLines(['REPUBLIC OF ELBONIA', ICAO_SPECIMEN.line1, ICAO_SPECIMEN.line2], 92),
    );
    const outcome = await runExtraction(IMG, 'image/png', { ocr });

    expect(outcome.method).toBe('mrz');
    expect(outcome.mrzDetected).toBe(true);
    expect(outcome.mrzValid).toBe(true);
    expect(outcome.kind).toBe('passport');
    expect(outcome.pageCount).toBeNull();
    expect(outcome.ocrMeanConfidence).toBe(92);

    const number = outcome.fields.find((f) => f.fieldPath === 'passport.number');
    expect(number).toMatchObject({
      fieldPath: 'passport.number',
      source: 'passport_mrz',
      confidence: 0.99,
      checkDigitOk: true,
    });
  });

  it('threads the `now` seam into the century window for dates', async () => {
    const ocr = new FakeOcrEngine(
      ocrResultFromLines([ICAO_SPECIMEN.line1, ICAO_SPECIMEN.line2], 92),
    );
    const outcome = await runExtraction(IMG, 'image/png', {
      ocr,
      now: () => new Date('2026-09-04T00:00:00Z'),
    });

    const dob = outcome.fields.find((f) => f.fieldPath === 'identity.dateOfBirth');
    expect(dob?.value).toBe('1974-08-12');
  });
});

describe('runExtraction — OCR fallback', () => {
  it('falls back to OCR text when the MRZ check digits fail', async () => {
    const badLine2 = ICAO_SPECIMEN.line2.slice(0, 9) + '9' + ICAO_SPECIMEN.line2.slice(10);
    const ocr = new FakeOcrEngine(
      ocrResultFromLines(
        [ICAO_SPECIMEN.line1, badLine2, 'Passport No: X1234567', 'Date of Birth 15/01/1990'],
        90,
      ),
    );
    const outcome = await runExtraction(IMG, 'image/png', { ocr });

    expect(outcome.method).toBe('ocr');
    expect(outcome.mrzDetected).toBe(true);
    expect(outcome.mrzValid).toBe(false);
    expect(outcome.fields.length).toBeGreaterThan(0);
    for (const f of outcome.fields) {
      expect(f.source).toBe('passport_ocr');
      expect(f.confidence).toBeLessThan(0.8);
    }
    expect(outcome.warnings).toContain('MRZ detected but check digits failed — used OCR fallback');
  });
});

describe('runExtraction — mixed', () => {
  it('keeps MRZ fields but adds OCR-only fields, marking the run mrz_ocr', async () => {
    const ocr = new FakeOcrEngine(
      ocrResultFromLines(
        [
          ICAO_SPECIMEN.line1,
          ICAO_SPECIMEN.line2,
          'Place of Issue: DHAKA',
          'Date of Issue: 02/01/2019',
        ],
        90,
      ),
    );
    const outcome = await runExtraction(IMG, 'image/png', { ocr });

    expect(outcome.method).toBe('mrz_ocr');

    const place = outcome.fields.find((f) => f.fieldPath === 'passport.placeOfIssue');
    expect(place?.value).toBe('DHAKA');
    expect(['passport_ocr', 'document_ocr']).toContain(place?.source);

    const number = outcome.fields.find((f) => f.fieldPath === 'passport.number');
    expect(number?.source).toBe('passport_mrz');
  });
});

describe('runExtraction — unknown document', () => {
  it('classifies a non-passport as unknown without throwing', async () => {
    const ocr = new FakeOcrEngine(
      ocrResultFromLines(['GROCERY RECEIPT', 'TOTAL 12.40', 'THANK YOU']),
    );
    const outcome = await runExtraction(IMG, 'image/png', { ocr });

    expect(outcome.kind).toBe('unknown');
    expect(outcome.method).toBe('ocr');
    expect(outcome.mrzDetected).toBe(false);
    expect(outcome.warnings).toContain('no MRZ found — used OCR text extraction');
  });
});

describe('runExtraction — normalization failure', () => {
  it('keeps an unresolvable MRZ date with value null and a halved score', async () => {
    const { line1, line2 } = buildTd3({
      surname: 'X',
      givenNames: 'Y',
      documentNumber: 'A01234567',
      dateOfBirth: '999999',
      sex: 'M',
      expiryDate: '300114',
    });
    const ocr = new FakeOcrEngine(ocrResultFromLines([line1, line2], 90));
    const outcome = await runExtraction(IMG, 'image/png', { ocr });

    const dob = outcome.fields.find((f) => f.fieldPath === 'identity.dateOfBirth');
    expect(dob?.value).toBeNull();
    expect(dob?.normalizationNote).toBeTruthy();
    expect(dob?.confidence).toBeCloseTo(0.99 * 0.5, 5);
    expect(outcome.warnings.some((w) => /could not be normalized/.test(w))).toBe(true);
  });
});

describe('runExtraction — PDF path', () => {
  it('unwraps a single-image PDF and OCRs the PNG', async () => {
    const ocr = new FakeOcrEngine(ocrResultFromLines(['NOTHING USEFUL HERE']));
    const outcome = await runExtraction(fixture('single-image.pdf'), 'application/pdf', { ocr });

    expect(ocr.calls.length).toBe(1);
    const png = ocr.calls[0]!;
    expect([png[0], png[1], png[2], png[3]]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(outcome.pageCount).toBe(1);
  });

  it('propagates ExtractionError(pdf_encrypted) and never calls OCR', async () => {
    const ocr = new FakeOcrEngine(ocrResultFromLines(['x']));
    await expect(
      runExtraction(fixture('encrypted.pdf'), 'application/pdf', { ocr }),
    ).rejects.toMatchObject({ name: 'ExtractionError', code: 'pdf_encrypted' });
    expect(ocr.calls.length).toBe(0);
  });
});

describe('runExtraction — errors carry no content', () => {
  it('maps an OCR failure to ExtractionError(unreadable) with a code-only message', async () => {
    const ocr = new FakeOcrEngine(() => {
      throw new Error('boom ERIKSSON');
    });
    let caught: unknown;
    try {
      await runExtraction(IMG, 'image/png', { ocr });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ExtractionError);
    expect((caught as ExtractionError).code).toBe('unreadable');
    expect((caught as ExtractionError).message).not.toContain('ERIKSSON');
  });
});
