/**
 * Phase 8 §11 — render the `docs/portals/india.md` "Field support tables" from
 * data the app already persists: the live India mapping map plus the captured
 * `portal_discovery_pages` for one session. The operator pastes the output into
 * the doc instead of transcribing it by hand.
 *
 * PURE: no DB, no I/O, no clock. The route in `routes/discovery.ts` does the
 * reads and passes the rows in. The only import is the {@link MappingView} type.
 *
 * VALUE-FREE by construction: every cell is a canonical field path, a control
 * kind, a portal-state name, a selector-confidence label, a lifecycle status, or
 * a count. No portal field value, option label or free text is ever emitted.
 */
import type { MappingView } from './indiaMappingRegistry.js';

export interface FieldTablesInput {
  /** `getIndiaMappings()` — the value-free adapter mapping view model. */
  mappings: MappingView[];
  /** `indiaPortalMap.mappingRevision` — stamped on every `validated` row. */
  mappingRevision: string;
  /** The session's captured discovery pages (state guess + raw candidate JSON). */
  discoveryPages: { state_guess: string | null; candidates_json: string }[];
}

const UNKNOWN_STATE = '(unknown state)';
const NO_STATE = '—';

const HEADER = '| Canonical field path | Control | Portal state | Selector confidence | Status |';
const DIVIDER = '|---|---|---|---|---|';
const EMPTY_ROW = '| _(none)_ | | | | |';

interface RawCandidate {
  primarySelector?: unknown;
}

/**
 * Index the session's discovery candidates: a `selector -> portal state` map for
 * per-mapping state resolution, and a `state -> candidate count` map for the
 * summary line (a count only — never a candidate value).
 */
function indexDiscovery(pages: FieldTablesInput['discoveryPages']): {
  stateBySelector: Map<string, string>;
  countByState: Map<string, number>;
} {
  const stateBySelector = new Map<string, string>();
  const countByState = new Map<string, number>();
  for (const page of pages) {
    const state = page.state_guess ?? UNKNOWN_STATE;
    let parsed: unknown;
    try {
      parsed = JSON.parse(page.candidates_json);
    } catch {
      parsed = [];
    }
    if (!Array.isArray(parsed)) continue;
    countByState.set(state, (countByState.get(state) ?? 0) + parsed.length);
    for (const cand of parsed as RawCandidate[]) {
      if (typeof cand?.primarySelector === 'string' && !stateBySelector.has(cand.primarySelector)) {
        stateBySelector.set(cand.primarySelector, state);
      }
    }
  }
  return { stateBySelector, countByState };
}

function statusCell(status: MappingView['status'], mappingRevision: string): string {
  if (status === 'validated') return `✓ validated (rev ${mappingRevision})`;
  if (status === 'discovered') return 'discovered — awaiting validation';
  return 'TODO: discover';
}

function renderRow(
  m: MappingView,
  mappingRevision: string,
  stateBySelector: Map<string, string>,
): string {
  const state = stateBySelector.get(m.selector) ?? NO_STATE;
  return `| \`${m.canonicalFieldPath}\` | ${m.control} | ${state} | ${m.confidence} | ${statusCell(m.status, mappingRevision)} |`;
}

function renderTable(
  title: string,
  rows: MappingView[],
  mappingRevision: string,
  stateBySelector: Map<string, string>,
): string {
  const body =
    rows.length > 0
      ? rows.map((m) => renderRow(m, mappingRevision, stateBySelector)).join('\n')
      : EMPTY_ROW;
  return `### ${title}\n\n${HEADER}\n${DIVIDER}\n${body}\n`;
}

export function renderFieldTablesMarkdown(input: FieldTablesInput): string {
  const { mappings, mappingRevision, discoveryPages } = input;
  const { stateBySelector, countByState } = indexDiscovery(discoveryPages);

  const validated = mappings.filter((m) => m.status === 'validated');
  const discovered = mappings.filter((m) => m.status === 'discovered');
  const placeholder = mappings.filter((m) => m.status === 'placeholder');

  const countsLine =
    countByState.size > 0
      ? [...countByState.entries()]
          .map(([state, n]) => `${state}: ${n} candidate${n === 1 ? '' : 's'}`)
          .join(' · ')
      : 'no discovery pages captured';

  return [
    '<!-- field-tables:generated — do not hand-edit; regenerate with the Copy field tables button -->',
    `_Generated from the discovery session — mapping revision ${mappingRevision}._`,
    '',
    `Discovery candidates observed per portal state: ${countsLine}`,
    '',
    renderTable('Validated', validated, mappingRevision, stateBySelector),
    renderTable('Discovered (not yet validated)', discovered, mappingRevision, stateBySelector),
    renderTable('Placeholder', placeholder, mappingRevision, stateBySelector),
  ].join('\n');
}
