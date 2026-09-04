import evisaCategories from './data/india/evisa-categories.json' with { type: 'json' };
import regularCategories from './data/india/regular-categories.json' with { type: 'json' };
import eligibilityBgd from './data/india/eligibility.bgd.json' with { type: 'json' };
import meta from './data/india/meta.json' with { type: 'json' };
import formModel from './data/india/form-model.json' with { type: 'json' };
import { PROFILE_FIELD_PATHS } from '../applicant/fieldPaths.js';
import { knowledgeBaseSchema, KNOWN_SCHEMA_VERSIONS, type KnowledgeBase } from './schema.js';

export class KnowledgeBaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KnowledgeBaseError';
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

export function parseKnowledgeBase(raw: unknown): KnowledgeBase {
  const parsed = knowledgeBaseSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new KnowledgeBaseError(`visa-kb: schema validation failed — ${detail}`);
  }
  const kb = parsed.data;

  if (!(KNOWN_SCHEMA_VERSIONS as readonly number[]).includes(kb.meta.schemaVersion)) {
    throw new KnowledgeBaseError(
      `visa-kb: unknown schemaVersion ${kb.meta.schemaVersion} (known: ${KNOWN_SCHEMA_VERSIONS.join(', ')})`,
    );
  }
  if (kb.meta.destination !== 'IND') {
    throw new KnowledgeBaseError(`visa-kb: meta.destination must be "IND", got "${kb.meta.destination}"`);
  }

  const ids = new Set<string>();
  for (const c of kb.categories) {
    if (ids.has(c.id)) throw new KnowledgeBaseError(`visa-kb: duplicate category id "${c.id}"`);
    ids.add(c.id);

    // The id prefix is load-bearing: callers and the UI read "evisa."/"regular." off the id,
    // so it must not disagree with the authoritative applicationMode field.
    const expectedPrefix = `${c.applicationMode}.`;
    if (!c.id.startsWith(expectedPrefix)) {
      throw new KnowledgeBaseError(
        `visa-kb: category "${c.id}" has applicationMode "${c.applicationMode}" so its id must start with "${expectedPrefix}"`,
      );
    }
  }

  const byId = new Map(kb.categories.map((c) => [c.id, c]));
  const seenTuples = new Set<string>();
  for (const e of kb.eligibility) {
    const target = byId.get(e.categoryId);
    if (!target) {
      throw new KnowledgeBaseError(`visa-kb: eligibility record points at missing category "${e.categoryId}"`);
    }
    if (target.applicationMode !== e.applicationMode) {
      throw new KnowledgeBaseError(
        `visa-kb: eligibility for "${e.categoryId}" has mode "${e.applicationMode}" but the category is "${target.applicationMode}"`,
      );
    }
    const tuple = `${e.nationality}|${e.applicationMode}|${e.categoryId}`;
    if (seenTuples.has(tuple)) {
      throw new KnowledgeBaseError(`visa-kb: duplicate eligibility record for (${tuple.replace(/\|/g, ', ')})`);
    }
    seenTuples.add(tuple);
  }

  // ---- schema v2: form model + form rules cross-checks ----
  // Field ids the KB may reference in a fieldRule without listing them in a section
  // (count-based / section-level requirements the engine synthesises).
  const SYNTHETIC_FIELD_IDS = new Set(['india_references_min']);

  const sectionIds = new Set<string>();
  const fieldIdsBySection = new Map<string, Set<string>>();
  for (const s of kb.formModel.sections) {
    if (sectionIds.has(s.id)) throw new KnowledgeBaseError(`visa-kb: duplicate form section id "${s.id}"`);
    sectionIds.add(s.id);
    const fieldIds = new Set<string>();
    for (const f of s.fields) {
      if (fieldIds.has(f.id)) {
        throw new KnowledgeBaseError(`visa-kb: duplicate field id "${f.id}" in form section "${s.id}"`);
      }
      fieldIds.add(f.id);
      if (f.appliesTo !== null) {
        const ok = f.appliesTo.startsWith('application.') || PROFILE_FIELD_PATHS.has(f.appliesTo);
        if (!ok) {
          throw new KnowledgeBaseError(
            `visa-kb: form field "${s.id}.${f.id}" has an invalid appliesTo "${f.appliesTo}"`,
          );
        }
      }
    }
    fieldIdsBySection.set(s.id, fieldIds);
  }

  for (const c of kb.categories) {
    for (const sid of c.formRules.applicableSections) {
      if (!sectionIds.has(sid)) {
        throw new KnowledgeBaseError(
          `visa-kb: category "${c.id}" formRules.applicableSections names unknown section "${sid}"`,
        );
      }
    }
    for (const r of c.formRules.fieldRules) {
      const known = fieldIdsBySection.get(r.sectionId);
      if (!known) {
        throw new KnowledgeBaseError(
          `visa-kb: category "${c.id}" fieldRule names unknown section "${r.sectionId}"`,
        );
      }
      if (!known.has(r.fieldId) && !SYNTHETIC_FIELD_IDS.has(r.fieldId)) {
        throw new KnowledgeBaseError(
          `visa-kb: category "${c.id}" fieldRule names unknown field "${r.sectionId}.${r.fieldId}"`,
        );
      }
    }
  }

  return deepFreeze(kb);
}

let cached: KnowledgeBase | null = null;

export function loadKnowledgeBase(): KnowledgeBase {
  if (!cached) {
    cached = parseKnowledgeBase({
      meta,
      categories: [...evisaCategories, ...regularCategories],
      eligibility: eligibilityBgd,
      formModel,
    });
  }
  return cached;
}

export function reload(): void {
  cached = null;
}
