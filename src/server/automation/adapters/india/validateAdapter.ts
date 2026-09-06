// DESIGN NOTE (do not remove): READ-ONLY. `validateAdapterAgainstPage` is a
// self-diagnostic over a LIVE page — it only ever calls `page.locator().count()`,
// `page.locator().allTextContents()` and `page.evaluate()` (structure reads). It
// has NO page-mutating call — no fill / click / type / press / check / uncheck /
// selectOption / setInputFiles / hover / goto / form.submit. It never reads a
// control's value; the only strings it surfaces are `<option>` labels, each put
// through `sanitizeString` first (spec §5.3 / §7.4). The report is value-free.

import type { Page } from 'playwright';
import type { ControlKind } from '../../../../shared/automation/types.js';
import { sanitizeString } from '../../discovery/observe.js';
import {
  indiaPortalMap,
  type IndiaFieldMapping,
  type IndiaPortalMap,
} from './indiaPortalMap.js';

/**
 * Minimal browser-DOM shapes, declared locally so this server-side module
 * typechecks without pulling the whole DOM lib into the server program (same
 * precedent as `engine/pageInspector.ts` / `discovery/observe.ts`). The real
 * objects are supplied by the browser inside `page.evaluate`. No `value` member
 * — reading a control's value is forbidden here.
 */
interface EvaluatedElement {
  tagName: string;
  getAttribute(name: string): string | null;
}
interface EvaluatedNodeList {
  length: number;
  item(index: number): EvaluatedElement | null;
}
interface EvaluatedDocument {
  querySelectorAll(selector: string): EvaluatedNodeList;
}
declare const document: EvaluatedDocument;

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

/**
 * The slice of a portal map `validateAdapterAgainstPage` needs. The real
 * {@link IndiaPortalMap} and the populated fixture map both satisfy it.
 */
export type AdapterMapView = Pick<
  IndiaPortalMap,
  'adapterVersion' | 'mappingRevision' | 'fields' | 'states'
>;

interface NodeShape {
  tag: string;
  /** Lower-cased `type` attribute for an `<input>` (defaulting to `text`); `null` otherwise. */
  type: string | null;
}

/**
 * Pure control-kind matcher (brief Step 3). Given a declared {@link ControlKind}
 * and the DOM `tagName` / input `type` of the single resolved node, decide
 * whether the node is the right sort of control. `custom_select` can be any
 * element (a widget), so it always matches; `date` requires `type="date"`
 * exactly (a text input is only a soft match, noted by the caller).
 */
export function controlMatchesNode(
  control: ControlKind,
  tagName: string,
  inputType: string | null,
): boolean {
  const tag = tagName.toLowerCase();
  const type = inputType === null ? null : inputType.toLowerCase();
  switch (control) {
    case 'text':
    case 'number':
    case 'autocomplete':
    case 'searchable_select':
      return tag === 'input';
    case 'textarea':
      return tag === 'textarea';
    case 'native_select':
      return tag === 'select';
    case 'radio':
      return tag === 'input' && type === 'radio';
    case 'checkbox':
      return tag === 'input' && type === 'checkbox';
    case 'date':
      return tag === 'input' && type === 'date';
    case 'custom_select':
      return true;
  }
}

const SELECT_LIKE: ReadonlySet<ControlKind> = new Set<ControlKind>([
  'native_select',
  'custom_select',
]);

/** Read `tagName` / input `type` for every node the selector resolves to. Read-only. */
async function readNodes(page: Page, selector: string): Promise<NodeShape[]> {
  try {
    return await page.evaluate((sel: string): NodeShape[] => {
      const out: NodeShape[] = [];
      const list = document.querySelectorAll(sel);
      for (let i = 0; i < list.length; i += 1) {
        const el = list.item(i);
        if (!el) continue;
        const tag = el.tagName.toLowerCase();
        const type = tag === 'input' ? (el.getAttribute('type') ?? 'text').toLowerCase() : null;
        out.push({ tag, type });
      }
      return out;
    }, selector);
  } catch {
    return [];
  }
}

async function countNodes(page: Page, selector: string): Promise<number> {
  try {
    return await page.locator(selector).count();
  } catch {
    return 0;
  }
}

async function validateField(
  page: Page,
  fieldPath: string,
  mapping: IndiaFieldMapping,
): Promise<AdapterFieldValidation> {
  const selector = mapping.selector;
  const nodeCount = await countNodes(page, selector);
  const resolvable = nodeCount === 1;

  const first = resolvable ? ((await readNodes(page, selector))[0] ?? null) : null;
  const controlMatches =
    first !== null && controlMatchesNode(mapping.control, first.tag, first.type);

  const result: AdapterFieldValidation = { fieldPath, resolvable, nodeCount, controlMatches };

  if (
    !controlMatches &&
    mapping.control === 'date' &&
    first?.tag === 'input' &&
    (first.type === 'text' || first.type === null)
  ) {
    result.note = 'soft match: "date" mapped to an <input type="text">';
  }

  if (SELECT_LIKE.has(mapping.control)) {
    let labels: string[] = [];
    try {
      labels = await page.locator(`${selector} option`).allTextContents();
    } catch {
      labels = [];
    }
    result.optionLabels = labels.map(sanitizeString).filter((l) => l !== '');
  }

  return result;
}

async function validateStates(
  page: Page,
  states: AdapterMapView['states'],
): Promise<AdapterStateValidation[]> {
  const entries = Object.entries(states).filter(
    ([, cfg]) => cfg.nextSelector !== null && cfg.nextSelectorStatus !== 'placeholder',
  );
  return Promise.all(
    entries.map(async ([state, cfg]) => ({
      state,
      nextResolvable: (await countNodes(page, cfg.nextSelector as string)) === 1,
    })),
  );
}

/**
 * Check a portal map against a live page: every non-placeholder field mapping
 * must resolve to exactly one node of a matching control kind, and every state
 * with a non-placeholder `nextSelector` must resolve to exactly one node.
 * Placeholder mappings are skipped, so a fully-placeholder map validates
 * vacuously (`ok: true`, empty `fields` / `states`).
 */
export async function validateAdapterAgainstPage(
  page: Page,
  map: AdapterMapView,
): Promise<AdapterValidationReport> {
  const fieldEntries = Object.entries(map.fields).filter(([, m]) => m.status !== 'placeholder');

  const fields = await Promise.all(
    fieldEntries.map(([fieldPath, mapping]) => validateField(page, fieldPath, mapping)),
  );
  const states = await validateStates(page, map.states);

  const ok =
    fields.every((f) => f.resolvable && f.controlMatches) &&
    states.every((s) => s.nextResolvable);

  return {
    adapterVersion: map.adapterVersion,
    mappingRevision: map.mappingRevision,
    ranAt: new Date().toISOString(),
    fields,
    states,
    ok,
  };
}

/** Run {@link validateAdapterAgainstPage} against the real India portal map. */
export function validateIndiaAdapter(page: Page): Promise<AdapterValidationReport> {
  return validateAdapterAgainstPage(page, indiaPortalMap);
}
