import { describe, expect, it } from 'vitest';
import { buildApplicationPlan } from '../../../src/shared/application/buildApplicationPlan.js';
import { loadKnowledgeBase } from '../../../src/shared/visa-kb/loader.js';
import { listCategories } from '../../../src/shared/visa-kb/queries.js';
import { SOURCE_CONFIDENCE } from '../../../src/shared/visa-kb/schema.js';
import type { Source } from '../../../src/shared/visa-kb/schema.js';
import type {
  ApplicationPlan,
  BuildApplicationPlanInput,
  FlatApplicant,
} from '../../../src/shared/application/types.js';
import { emptyDocumentCoverage, syntheticApplicant } from '../../helpers/applicationFixtures.js';

/**
 * Design §8 / §32: the provenance invariant. EVERY rule the engine surfaces — every
 * section, field, document, eligibility condition, missing item, and blocker — carries
 * a `source` back to an official URL. `null` is allowed only in the two places the
 * spec names (a plan-level non-blocker warning on an allow-list; a `kind: 'warning'`
 * blocker). This test builds a plan for EVERY KB category (× a married and a minor
 * applicant) and fails if any surfaced rule is unsourced — so a future category that
 * introduces an unsourced rule cannot land silently.
 */

const kb = loadKnowledgeBase();
const NOW = new Date('2026-09-05T00:00:00.000Z');
const ARRIVAL = new Date(NOW.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const CONFIDENCE_VALUES = new Set<string>(SOURCE_CONFIDENCE);

/** Plan-level warnings that are legitimately allowed to have `source: null`. */
const NULL_SOURCE_WARNING_ALLOWLIST: RegExp[] = [
  /was not found in the knowledge base/i,
  /knowledge base is pinned to/i,
];

function assertSource(source: Source, where: string): void {
  expect(source, `${where}: source must be an object`).toBeTruthy();
  expect(typeof source.officialUrl, `${where}: officialUrl must be a string`).toBe('string');
  expect(source.officialUrl, `${where}: officialUrl must be a non-empty http(s) URL`).toMatch(
    /^https?:\/\/\S+/,
  );
  expect(source.retrievedAt, `${where}: retrievedAt must be YYYY-MM-DD`).toMatch(
    /^\d{4}-\d{2}-\d{2}$/,
  );
  expect(
    CONFIDENCE_VALUES.has(source.confidence),
    `${where}: confidence '${source.confidence}' not one of ${[...CONFIDENCE_VALUES].join(', ')}`,
  ).toBe(true);
}

function walkPlanSources(plan: ApplicationPlan, label: string): void {
  for (const section of plan.sections) {
    assertSource(section.source, `${label} section '${section.id}'`);
    for (const field of section.fields) {
      assertSource(field.source, `${label} field '${section.id}.${field.id}'`);
    }
  }

  for (const doc of plan.documents) {
    assertSource(doc.source, `${label} document '${doc.id}'`);
  }

  for (const item of plan.missing) {
    assertSource(item.source, `${label} missing '${item.kind}:${item.id}'`);
  }

  for (const w of plan.warnings) {
    if (w.source === null) {
      expect(w.severity, `${label} warning "${w.text}" with null source must not be a blocker`).not.toBe(
        'blocker',
      );
      expect(
        NULL_SOURCE_WARNING_ALLOWLIST.some((re) => re.test(w.text)),
        `${label} warning "${w.text}" has a null source but is not on the allow-list`,
      ).toBe(true);
    } else {
      assertSource(w.source, `${label} warning "${w.text}"`);
    }
  }

  // Eligibility: source is null only for the 'unknown' status (no recorded rule).
  if (plan.eligibility.status === 'unknown') {
    expect(plan.eligibility.source, `${label} eligibility(unknown) source`).toBeNull();
  } else {
    expect(
      plan.eligibility.source,
      `${label} eligibility(${plan.eligibility.status}) must have a source`,
    ).not.toBeNull();
    assertSource(plan.eligibility.source as Source, `${label} eligibility`);
  }
  for (const cond of plan.eligibility.conditions) {
    assertSource(cond.source, `${label} eligibility condition '${cond.condition.type}'`);
  }

  for (const b of plan.readyForAutomation.blockers) {
    if (b.source === null) {
      expect(
        b.kind,
        `${label} blocker "${b.text}" may only have a null source when kind === 'warning'`,
      ).toBe('warning');
    } else {
      assertSource(b.source, `${label} blocker(${b.kind}) "${b.text}"`);
    }
  }
}

function baseInput(applicant: FlatApplicant, categoryId: string): BuildApplicationPlanInput {
  const category = listCategories({}, kb).find((c) => c.id === categoryId)!;
  return {
    applicant,
    documentCoverage: emptyDocumentCoverage(),
    selection: {
      destination: 'IND',
      applicationMode: category.applicationMode,
      categoryId,
      purpose: category.purpose[0] ?? null,
      entryType: 'single',
      intendedArrivalDate: ARRIVAL,
      intendedStayDays: 10,
      portOfArrival: 'Delhi',
    },
    applicationValues: {},
    kb,
    now: NOW,
  };
}

const marriedApplicant = syntheticApplicant();
const minorApplicant = syntheticApplicant({
  identity: { ...syntheticApplicant().identity, dateOfBirth: '2012-01-01' },
  family: { ...syntheticApplicant().family, maritalStatus: 'single', spouseName: null },
});

const APPLICANTS: { name: string; applicant: FlatApplicant }[] = [
  { name: 'married-adult', applicant: marriedApplicant },
  { name: 'minor', applicant: minorApplicant },
];

const categories = listCategories({}, kb);

it('the KB has categories to check', () => {
  expect(categories.length).toBeGreaterThan(0);
});

describe('every KB category surfaces only sourced rules', () => {
  for (const category of categories) {
    for (const { name, applicant } of APPLICANTS) {
      it(`${category.id} (${name})`, () => {
        const plan = buildApplicationPlan(baseInput(applicant, category.id));
        walkPlanSources(plan, `${category.id}/${name}`);
      });
    }
  }
});
