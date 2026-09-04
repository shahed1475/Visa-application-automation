/**
 * Stage-wiring orchestrator for passport / document extraction (design §2, §4).
 *
 * `runExtraction` runs stages 2–9 in order and nothing else: prepare → OCR →
 * MRZ detect → MRZ parse → classify → (MRZ-primary | OCR-fallback | mixed) →
 * normalize / score / map. It owns NO extraction logic of its own — every rule
 * lives in the pure units it calls.
 *
 * Thin by contract: no database access, no filesystem access beyond the PDF
 * unwrap in stage 2, no logging of content. Every failure leaves this function
 * as an `ExtractionError` whose `message` is only the stable `code` or a fixed
 * phrase — never bytes, OCR text, MRZ characters, or a path.
 */

import { detectMrzLines, parseTd3 } from '../../shared/mrz/index.js';
import type { Td3Result } from '../../shared/mrz/index.js';
import {
  classifyDocument,
  extractFieldsFromOcr,
  mapMrzResult,
} from '../../shared/documents/index.js';
import type { ExtractedField, ExtractionMethod, ExtractionOutcome } from '../../shared/documents/index.js';
import type { SniffedMime } from './fileType.js';
import { ExtractionError, extractSingleImage } from './pdfImage.js';
import type { OcrEngine } from './ocrEngine.js';

export interface PipelineDeps {
  ocr: OcrEngine;
  now?: () => Date;
}

/** True when a parsed TD3 result is trustworthy enough to be the primary source. */
function isMrzPrimary(td3: Td3Result | null): td3 is Td3Result {
  if (td3 === null) return false;
  return (
    td3.overallValid ||
    td3.composite.ok ||
    ((td3.documentNumber.checkDigit?.ok ?? false) &&
      (td3.dateOfBirth.checkDigit?.ok ?? false) &&
      (td3.expiryDate.checkDigit?.ok ?? false))
  );
}

export async function runExtraction(
  bytes: Uint8Array,
  mime: SniffedMime,
  deps: PipelineDeps,
): Promise<ExtractionOutcome> {
  try {
    // --- Stage 2: prepare -----------------------------------------------------
    let imageBytes: Uint8Array;
    let pageCount: number | null;
    if (mime === 'image/jpeg' || mime === 'image/png') {
      imageBytes = bytes;
      pageCount = null;
    } else if (mime === 'application/pdf') {
      const prepared = await extractSingleImage(bytes);
      imageBytes = prepared.bytes;
      pageCount = prepared.pageCount;
    } else {
      throw new ExtractionError('not_an_image');
    }

    // --- Stage 3: OCR -------------------------------------------------------
    let ocr;
    try {
      ocr = await deps.ocr.recognize(imageBytes);
    } catch {
      throw new ExtractionError('unreadable');
    }

    // --- Stage 4: MRZ detection -------------------------------------------
    const detected = detectMrzLines(ocr.lines);

    // --- Stage 5: MRZ parsing ------------------------------------------------
    const td3 = detected ? parseTd3(detected.line1, detected.line2) : null;

    // --- Classify ----------------------------------------------------------
    const { kind, confidence: classificationConfidence } = classifyDocument({
      mrzDetected: detected !== null,
      mrzDocType: td3?.documentCode ?? null,
      mrzOverallValid: td3?.overallValid ?? false,
      ocrText: ocr.text,
    });

    // --- Stages 6–9: choose the path, normalize / score / map ------------
    const ref = deps.now?.() ?? new Date();
    const mrzPrimary = isMrzPrimary(td3);

    let fields: ExtractedField[];
    let ocrContributed: boolean;
    if (mrzPrimary) {
      const mrzFields = mapMrzResult(td3, ref);
      const mrzPaths = new Set(mrzFields.map((f) => f.fieldPath));
      // MRZ always wins: keep only OCR fields for paths the MRZ did not produce.
      const ocrExtras = extractFieldsFromOcr(ocr.text, ocr.lines, kind, ref).filter(
        (f) => !mrzPaths.has(f.fieldPath),
      );
      fields = [...mrzFields, ...ocrExtras];
      ocrContributed = ocrExtras.length > 0;
    } else {
      fields = extractFieldsFromOcr(ocr.text, ocr.lines, kind, ref);
      ocrContributed = fields.length > 0;
    }

    const method: ExtractionMethod =
      mrzPrimary && ocrContributed ? 'mrz_ocr' : mrzPrimary ? 'mrz' : 'ocr';

    // --- Warnings (generic, structural, never a value) --------------------
    const warnings: string[] = [];
    if (!detected) {
      warnings.push('no MRZ found — used OCR text extraction');
    } else if (!mrzPrimary) {
      warnings.push('MRZ detected but check digits failed — used OCR fallback');
    }
    const unnormalized = fields.filter((f) => f.value === null).length;
    if (unnormalized > 0) {
      warnings.push(`${unnormalized} field(s) could not be normalized`);
    }

    return {
      kind,
      classificationConfidence,
      method,
      mrzDetected: detected !== null,
      mrzValid: td3?.overallValid ?? false,
      ocrMeanConfidence: ocr.meanConfidence,
      pageCount,
      fields,
      warnings,
    };
  } catch (err) {
    if (err instanceof ExtractionError) throw err;
    throw new ExtractionError('internal');
  }
}
