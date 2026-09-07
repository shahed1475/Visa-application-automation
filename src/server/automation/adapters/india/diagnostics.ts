/**
 * Phase 6 §7.4 / §13.21 — India adapter self-diagnostics assembly.
 *
 * A value-free health snapshot of the India portal adapter: its contract
 * version + mapping revision, how much user-driven discovery has happened, the
 * mapping lifecycle counts, how many unknown-page pauses the engine has hit,
 * and the outcome of the most recent adapter-validation pass.
 *
 * This is a data-assembly module, not an HTTP route, so it MAY run its own SQL
 * (COUNT queries over `automation_events` / `portal_discovery_pages`). It
 * surfaces NO field values and NO applicant data — only structure and counts.
 * The `mappings` field carries lifecycle COUNTS, never a per-field path list.
 */
import type { DatabaseSync } from 'node:sqlite';
import {
  getIndiaMappingStatus,
  type MappingStatusCounts,
} from './indiaMappingRegistry.js';
import { indiaPortalMap } from './indiaPortalMap.js';
import {
  listDiscoveryPages,
  listDiscoverySessions,
} from '../../discovery/discoverySessionStore.js';

const ADAPTER_ID = 'india';

export interface IndiaDiagnostics {
  adapterId: 'india';
  adapterVersion: string;
  mappingRevision: string;
  lastDiscoveryAt: string | null;
  /** Total `portal_discovery_pages` rows across every `adapter_id = 'india'` session. */
  pagesDiscovered: number;
  /** `indiaPortalMap.fields` entries whose `status !== 'placeholder'` (0 today). */
  fieldsDiscovered: number;
  mappings: MappingStatusCounts;
  /** `mappings.stale` hoisted for the UI (validated but not against the current revision). */
  staleMappings: number;
  /** `mappings.productionUsable` hoisted — mappings that may drive a real run. */
  productionUsableMappings: number;
  /** `count(*)` of `automation_events` rows with `type = 'UNKNOWN_PORTAL_STATE'`,
   *  across ALL runs — not scoped to a portal or adapter (brief §13.21). */
  unknownPagesEncountered: number;
  /** `count(*)` of `automation_events` rows with `type = 'SELECTOR_STALE'` — a
   *  primary selector missed and its configured fallback carried the run. */
  selectorStaleEvents: number;
  /** `{ ranAt, ok }` from the most recent session that carries a validation
   *  report; `null` when no india session has one. Never the full report. */
  lastValidation: { ranAt: string; ok: boolean } | null;
}

export function getIndiaDiagnostics(
  db: DatabaseSync,
  _portalId: string,
): IndiaDiagnostics {
  // `_portalId` is accepted for URL symmetry with the sibling portal routes but
  // does NOT scope the result — the India map is adapter-level, and the event
  // count below is deliberately whole-database.
  void _portalId;

  const sessions = listDiscoverySessions(db, { adapterId: ADAPTER_ID });

  let pagesDiscovered = 0;
  for (const session of sessions) {
    pagesDiscovered += listDiscoveryPages(db, session.id).length;
  }

  const fieldsDiscovered = Object.values(indiaPortalMap.fields).filter(
    (field) => field.status !== 'placeholder',
  ).length;

  const { n: unknownPagesEncountered } = db
    .prepare(
      `SELECT count(*) AS n FROM automation_events WHERE type = 'UNKNOWN_PORTAL_STATE'`,
    )
    .get() as { n: number };

  const { n: selectorStaleEvents } = db
    .prepare(`SELECT count(*) AS n FROM automation_events WHERE type = 'SELECTOR_STALE'`)
    .get() as { n: number };

  // `listDiscoverySessions` orders by `started_at DESC, id DESC`, so the first
  // session with a parseable `last_validation_json` is the most recent one that
  // has been validated. A corrupt report is skipped, never thrown.
  let lastValidation: { ranAt: string; ok: boolean } | null = null;
  for (const session of sessions) {
    if (session.last_validation_json === null) continue;
    try {
      const report = JSON.parse(session.last_validation_json) as {
        ranAt?: unknown;
        ok?: unknown;
      };
      if (typeof report.ranAt === 'string' && typeof report.ok === 'boolean') {
        lastValidation = { ranAt: report.ranAt, ok: report.ok };
        break;
      }
    } catch {
      /* corrupt report on this session — keep looking */
    }
  }

  const mappings = getIndiaMappingStatus();

  return {
    adapterId: ADAPTER_ID,
    adapterVersion: indiaPortalMap.adapterVersion,
    mappingRevision: indiaPortalMap.mappingRevision,
    lastDiscoveryAt: indiaPortalMap.lastDiscoveryAt,
    pagesDiscovered,
    fieldsDiscovered,
    mappings,
    staleMappings: mappings.stale,
    productionUsableMappings: mappings.productionUsable,
    unknownPagesEncountered,
    selectorStaleEvents,
    lastValidation,
  };
}
