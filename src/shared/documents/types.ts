/**
 * Shared document-extraction DTOs. These mirror the migration-3 columns
 * (`documents`, `extraction_runs`, `document_fields`) in camelCase and are the
 * type surface every later Phase 3 task (pipeline, apply, service, routes, web
 * pages) consumes. Pure module — no Node/browser deps, no runtime imports.
 */

export type DocumentKind = 'passport' | 'unknown';
export type DocumentStatus = 'uploaded' | 'extracted' | 'failed';
export type ExtractionMethod = 'mrz' | 'ocr' | 'mrz_ocr';
export type DocumentFieldStatus = 'proposed' | 'applied' | 'held' | 'dismissed';
export type ExtractionSource = 'passport_mrz' | 'passport_ocr' | 'document_ocr';

export interface ExtractedField {
  fieldPath: string;
  value: string | null;
  /** Pre-normalization text. Maps to the `raw_value` column (the one intentional view↔column name divergence). */
  raw: string | null;
  source: ExtractionSource;
  confidence: number;
  checkDigitOk: boolean | null;
  normalizationNote: string | null;
}

export interface ExtractionOutcome {
  kind: DocumentKind;
  classificationConfidence: number;
  method: ExtractionMethod;
  mrzDetected: boolean;
  mrzValid: boolean;
  ocrMeanConfidence: number | null;
  /** `null` for a direct image; the source PDF's page count for a PDF. */
  pageCount: number | null;
  fields: ExtractedField[];
  warnings: string[];
}

export interface DocumentExtractedFieldView extends ExtractedField {
  id: string;
  status: DocumentFieldStatus;
  extractionRunId: string;
  inProfile: boolean;
  /**
   * `true` only when the field is `applied` AND the value currently sitting in
   * the applicant's section table still equals what was extracted (trimmed
   * string compare, both non-null). Goes `false` once the user edits the
   * profile value away — the Confirm gate keys off this.
   */
  profileMatches: boolean;
  verified: boolean;
}

export interface ExtractionRunView {
  id: string;
  attempt: number;
  method: ExtractionMethod | null;
  status: 'completed' | 'failed';
  mrzDetected: boolean;
  mrzValid: boolean;
  ocrMeanConfidence: number | null;
  fieldCount: number;
  errorCode: string | null;
  engineDetail: string | null;
  createdAt: string;
}

export interface DocumentSummary {
  id: string;
  applicantId: string | null;
  kind: DocumentKind;
  originalName: string | null;
  mimeType: string;
  status: DocumentStatus;
  runCount: number;
  fieldCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentDetail extends DocumentSummary {
  classificationConfidence: number | null;
  latestExtractionMethod: ExtractionMethod | null;
  latestOcrMeanConfidence: number | null;
  pageCount: number | null;
  errorCode: string | null;
  byteSize: number;
  runs: ExtractionRunView[];
  fields: DocumentExtractedFieldView[];
}
