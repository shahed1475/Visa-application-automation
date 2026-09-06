/**
 * Phase 6 §7.3 / §13.12 — India mapping registry.
 *
 * A read-only view model over {@link indiaPortalMap} for the adapter-mappings UI
 * plus a `promoteCandidate` helper that renders a paste-ready `indiaPortalMap.ts`
 * edit from a discovered selector candidate.
 *
 * Global constraint: the app NEVER writes adapter source. `promoteCandidate`
 * returns a TS string for a human to paste and review — `indiaPortalMap.ts`
 * stays the hand-maintained source of truth. The view model carries only
 * structure (path / label / selector / control / status / confidence / refs) —
 * no PII, no field values.
 */
import type { DatabaseSync } from 'node:sqlite';
import type { ControlKind, SelectorConfidence } from '../../../../shared/automation/types.js';
import { DiscoverySessionNotFoundError } from '../../discovery/discoveryController.js';
import type { DiscoveryFieldCandidate } from '../../discovery/portalDiscovery.js';
import {
  getDiscoverySession,
  listDiscoveryPages,
} from '../../discovery/discoverySessionStore.js';
import { indiaPortalMap, type MappingStatus } from './indiaPortalMap.js';

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

export function getIndiaMappings(): MappingView[] {
  return Object.entries(indiaPortalMap.fields).map(([canonicalFieldPath, spec]) => {
    const view: MappingView = {
      canonicalFieldPath,
      // label: the canonical path verbatim. IndiaFieldMapping carries no label;
      // humanizing the last segment adds noise without adding information, and the
      // path is already deterministic and value-free.
      label: canonicalFieldPath,
      selector: spec.selector,
      control: spec.control,
      status: spec.status,
      confidence: spec.selectorConfidence,
    };
    if (spec.validatedAt !== undefined) view.validatedAt = spec.validatedAt;
    if (spec.discoverySessionRef !== undefined) view.discoverySessionRef = spec.discoverySessionRef;
    if (spec.notes !== undefined) view.notes = spec.notes;
    return view;
  });
}

export interface MappingStatusCounts {
  placeholder: number;
  discovered: number;
  validated: number;
  total: number;
  requiredRemaining: number;
}

export function getIndiaMappingStatus(): MappingStatusCounts {
  const specs = Object.values(indiaPortalMap.fields);
  const counts: MappingStatusCounts = {
    placeholder: 0,
    discovered: 0,
    validated: 0,
    total: specs.length,
    // requiredRemaining = mappings whose status !== 'validated'. Only a validated
    // selector can drive a real autofill run, so "remaining work" is everything
    // not yet validated. (indiaPortalMap carries no static "required" flag —
    // required-ness is per-application, owned by the Phase 4 ApplicationPlan.)
    requiredRemaining: 0,
  };
  for (const spec of specs) {
    counts[spec.status] += 1;
    if (spec.status !== 'validated') counts.requiredRemaining += 1;
  }
  return counts;
}

export interface PromoteInput {
  pageSeq: number;
  candidateIndex: number;
  canonicalFieldPath: string;
}

export interface PromotedMappingEdit {
  canonicalFieldPath: string;
  /** exact TS to paste into indiaPortalMap.fields (includes the map key) */
  literal: string;
  warnings: string[];
}

/** A `promoteCandidate` lookup that misses a page seq or candidate index. */
export class DiscoveryCandidateNotFoundError extends Error {
  constructor(readonly detail: string) {
    super(`Discovery candidate not found: ${detail}`);
    this.name = 'DiscoveryCandidateNotFoundError';
  }
}

/**
 * Render a paste-ready `indiaPortalMap.fields['<path>']` entry from a discovery
 * candidate. Does NOT write any file — the returned `literal` is for a human to
 * review and paste. `warnings` flags an unknown canonical field, a fragile
 * selector, an unknown candidate control, and a control mismatch against the
 * placeholder's expected `ControlKind`.
 */
export function promoteCandidate(
  db: DatabaseSync,
  sessionId: string,
  input: PromoteInput,
): PromotedMappingEdit {
  if (!getDiscoverySession(db, sessionId)) {
    throw new DiscoverySessionNotFoundError(sessionId);
  }

  const page = listDiscoveryPages(db, sessionId).find((row) => row.seq === input.pageSeq);
  if (!page) {
    throw new DiscoveryCandidateNotFoundError(
      `session '${sessionId}' has no page with seq ${input.pageSeq}`,
    );
  }

  const candidates = JSON.parse(page.candidates_json) as DiscoveryFieldCandidate[];
  const cand = candidates[input.candidateIndex];
  if (!cand) {
    throw new DiscoveryCandidateNotFoundError(
      `page seq ${input.pageSeq} has no candidate at index ${input.candidateIndex}`,
    );
  }

  const warnings: string[] = [];
  const expected = indiaPortalMap.fields[input.canonicalFieldPath];
  if (!expected) {
    warnings.push('unknown canonical field');
  }
  if (cand.selectorConfidence === 'fragile') {
    warnings.push("selector confidence is 'fragile' — verify the selector before validating");
  }
  if (cand.control === 'unknown') {
    warnings.push("candidate control is 'unknown' — set control manually before pasting");
  } else if (expected && cand.control !== expected.control) {
    warnings.push(
      `control mismatch: candidate '${cand.control}' vs expected '${expected.control}'`,
    );
  }

  const control: string =
    cand.control !== 'unknown' ? cand.control : (expected?.control ?? 'unknown');
  const discoveredAt = new Date().toISOString();

  const body: string[] = [`  selector: ${quote(cand.primarySelector)},`];
  if (cand.fallbackSelector !== null) {
    body.push(`  fallbackSelector: ${quote(cand.fallbackSelector)},`);
  }
  body.push(`  control: ${quote(control)},`);
  body.push(`  selectorConfidence: ${quote(cand.selectorConfidence)},`);
  body.push(`  status: 'discovered',`);
  body.push(`  discoveredAt: ${quote(discoveredAt)},`);
  body.push(`  discoverySessionRef: ${quote(sessionId)},`);

  const literal = [`${quote(input.canonicalFieldPath)}: {`, ...body, '},'].join('\n');

  return { canonicalFieldPath: input.canonicalFieldPath, literal, warnings };
}

function quote(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}
