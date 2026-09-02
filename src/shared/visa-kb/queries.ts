import { loadKnowledgeBase } from './loader.js';
import type { ApplicationMode, KnowledgeBase, VisaCategory, VisaCategoryName } from './schema.js';

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
