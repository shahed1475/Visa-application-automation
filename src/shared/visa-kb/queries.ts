import { loadKnowledgeBase } from './loader.js';
import type {
  ApplicationMode,
  EligibilityCondition,
  EligibilityRecord,
  KnowledgeBase,
  Source,
  VisaCategory,
  VisaCategoryName,
  VisaDocument,
} from './schema.js';

export function getVersion(kb: KnowledgeBase = loadKnowledgeBase()): {
  schemaVersion: number;
  kbVersion: string;
  revisionDate: string;
  destination: string;
} {
  const { schemaVersion, kbVersion, revisionDate, destination } = kb.meta;
  return { schemaVersion, kbVersion, revisionDate, destination };
}

export function listCategories(
  opts: { applicationMode?: ApplicationMode; category?: VisaCategoryName } = {},
  kb: KnowledgeBase = loadKnowledgeBase(),
): VisaCategory[] {
  return kb.categories.filter(
    (c) =>
      (opts.applicationMode === undefined || c.applicationMode === opts.applicationMode) &&
      (opts.category === undefined || c.category === opts.category),
  );
}

export function getCategory(id: string, kb: KnowledgeBase = loadKnowledgeBase()): VisaCategory | null {
  return kb.categories.find((c) => c.id === id) ?? null;
}

export function getCategoriesForMode(
  mode: ApplicationMode,
  kb: KnowledgeBase = loadKnowledgeBase(),
): VisaCategory[] {
  return kb.categories.filter((c) => c.applicationMode === mode);
}

export type EligibilityResult =
  | {
      status: 'eligible' | 'conditional' | 'ineligible' | 'not_offered';
      conditions: EligibilityCondition[];
      basis: string;
      source: Source;
      lastVerified: string;
    }
  | { status: 'unknown'; reason: string };

function findEligibility(
  kb: KnowledgeBase,
  nationality: string,
  mode: ApplicationMode,
  categoryId: string,
): EligibilityRecord | undefined {
  return kb.eligibility.find(
    (e) => e.nationality === nationality && e.applicationMode === mode && e.categoryId === categoryId,
  );
}

export function checkEligibility(
  nationality: string,
  mode: ApplicationMode,
  categoryId: string,
  kb: KnowledgeBase = loadKnowledgeBase(),
): EligibilityResult {
  const rec = findEligibility(kb, nationality, mode, categoryId);
  if (!rec) {
    return {
      status: 'unknown',
      reason: `no eligibility rule recorded for ${nationality} × ${mode} × ${categoryId}`,
    };
  }
  return {
    status: rec.status,
    conditions: rec.conditions,
    basis: rec.basis,
    source: rec.source,
    lastVerified: rec.lastVerified,
  };
}

export function listEligibleCategories(
  nationality: string,
  mode: ApplicationMode,
  kb: KnowledgeBase = loadKnowledgeBase(),
): { category: VisaCategory; eligibility: EligibilityRecord }[] {
  const out: { category: VisaCategory; eligibility: EligibilityRecord }[] = [];
  for (const e of kb.eligibility) {
    if (e.nationality !== nationality || e.applicationMode !== mode) continue;
    if (e.status !== 'eligible' && e.status !== 'conditional') continue;
    const category = getCategory(e.categoryId, kb);
    if (category) out.push({ category, eligibility: e });
  }
  return out;
}

export function getDocumentRequirements(
  categoryId: string,
  kb: KnowledgeBase = loadKnowledgeBase(),
): { required: VisaDocument[]; optional: VisaDocument[] } | null {
  const c = getCategory(categoryId, kb);
  if (!c) return null;
  return { required: [...c.requiredDocuments], optional: [...c.optionalDocuments] };
}
