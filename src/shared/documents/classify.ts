/**
 * Document classification (design §7). Decides whether an uploaded file is a
 * passport, and how confident that call is. The confidence here is the same
 * kind of application-level heuristic as `confidence.ts` — an ordering signal,
 * not a calibrated probability.
 *
 * Pure module: imports only `./types.js`.
 */

import type { DocumentKind } from './types.js';

export interface ClassifyInput {
  mrzDetected: boolean;
  mrzDocType: string | null;
  mrzOverallValid: boolean;
  ocrText: string;
}

const KEYWORDS = ['PASSPORT', 'P<', 'REPUBLIC OF', 'MRZ'] as const;

export function classifyDocument(i: ClassifyInput): { kind: DocumentKind; confidence: number } {
  if (i.mrzDetected && i.mrzDocType !== null && i.mrzDocType.toUpperCase().startsWith('P')) {
    return { kind: 'passport', confidence: i.mrzOverallValid ? 0.97 : 0.8 };
  }

  const text = i.ocrText.toUpperCase();
  let hits = KEYWORDS.reduce((n, kw) => (text.includes(kw) ? n + 1 : n), 0);
  if (/TYPE\s*P\b/.test(text)) hits += 1;

  if (hits >= 1) return { kind: 'passport', confidence: Math.min(0.4 + 0.1 * hits, 0.65) };
  return { kind: 'unknown', confidence: 0.9 };
}
