/**
 * Phase 6 §5.4 / §7.3 / §7.4 — web-facing DTO shapes for the discovery and
 * India-adapter surfaces. These mirror the server view models
 * (`discoverySessionStore`, `indiaMappingRegistry`, `diagnostics`,
 * `validateAdapter`) and live in `shared/` because the web tsconfig cannot see
 * `src/server`. Every shape here is value-free: labels, selectors, control
 * kinds, timestamps and counts only — never a portal field value or PII.
 */
import type { ControlKind, SelectorConfidence } from '../automation/types.js';

/** Where a single selector mapping sits in its discovery lifecycle. */
export type MappingStatus = 'placeholder' | 'discovered' | 'validated';

/** `portal_discovery_sessions` row, as returned by the discovery routes. */
export interface DiscoverySessionDTO {
  id: string;
  portal_id: string | null;
  adapter_id: string;
  status: 'active' | 'ended' | 'aborted';
  started_at: string;
  ended_at: string | null;
  page_count: number;
  last_validation_json: string | null;
  notes: string | null;
}

/** One ranked selector candidate inside a captured page's `candidates_json`. */
export interface DiscoveryFieldCandidateDTO {
  label: string;
  primarySelector: string;
  fallbackSelector: string | null;
  selectorConfidence: SelectorConfidence;
  control: ControlKind | 'unknown';
}

/** `portal_discovery_pages` row. `candidates_json` parses to `DiscoveryFieldCandidateDTO[]`. */
export interface DiscoveryPageDTO {
  id: string;
  session_id: string;
  seq: number;
  created_at: string;
  state_guess: string | null;
  url_pattern: string | null;
  page_title: string | null;
  headings_json: string;
  fingerprint_json: string;
  candidates_json: string;
  signals_json: string;
}

/** One value-free row per canonical field mapping, for the adapter-mappings UI. */
export interface MappingView {
  canonicalFieldPath: string;
  label: string;
  selector: string;
  control: ControlKind;
  status: MappingStatus;
  confidence: SelectorConfidence;
  validatedAt?: string;
  discoverySessionRef?: string;
  notes?: string;
}

export interface MappingStatusCounts {
  placeholder: number;
  discovered: number;
  validated: number;
  total: number;
  requiredRemaining: number;
}

/** Paste-ready `indiaPortalMap.ts` edit returned by `POST .../promote`. */
export interface PromotedMappingEdit {
  canonicalFieldPath: string;
  literal: string;
  warnings: string[];
}

/** Value-free health snapshot of the India adapter. */
export interface IndiaDiagnostics {
  adapterId: 'india';
  adapterVersion: string;
  mappingRevision: string;
  lastDiscoveryAt: string | null;
  pagesDiscovered: number;
  fieldsDiscovered: number;
  mappings: MappingStatusCounts;
  unknownPagesEncountered: number;
  lastValidation: { ranAt: string; ok: boolean } | null;
}

export interface AdapterFieldValidation {
  fieldPath: string;
  resolvable: boolean;
  nodeCount: number;
  controlMatches: boolean;
  optionLabels?: string[];
  note?: string;
}

export interface AdapterStateValidation {
  state: string;
  nextResolvable: boolean;
}

export interface AdapterValidationReport {
  adapterVersion: string;
  mappingRevision: string;
  ranAt: string;
  fields: AdapterFieldValidation[];
  states: AdapterStateValidation[];
  ok: boolean;
}
