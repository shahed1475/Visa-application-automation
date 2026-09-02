import { afterEach, describe, expect, it } from 'vitest';
import evisa from '../../../src/shared/visa-kb/data/india/evisa-categories.json' with { type: 'json' };
import regular from '../../../src/shared/visa-kb/data/india/regular-categories.json' with { type: 'json' };
import { visaCategorySchema } from '../../../src/shared/visa-kb/schema.js';
import { loadKnowledgeBase, reload } from '../../../src/shared/visa-kb/loader.js';
import { getVersion } from '../../../src/shared/visa-kb/queries.js';

describe('e-Visa seed data', () => {
  it('is a non-empty array of schema-valid categories, all applicationMode "evisa"', () => {
    expect(Array.isArray(evisa)).toBe(true);
    expect(evisa.length).toBeGreaterThanOrEqual(8);
    for (const entry of evisa) {
      const parsed = visaCategorySchema.safeParse(entry);
      expect(parsed.success, JSON.stringify(entry) + '\n' + JSON.stringify(parsed.error?.issues)).toBe(true);
      expect((entry as { applicationMode: string }).applicationMode).toBe('evisa');
    }
  });
  it('every entry has a real official source URL and a retrieval date', () => {
    for (const e of evisa as { source: { officialUrl: string; retrievedAt: string } }[]) {
      expect(e.source.officialUrl).toMatch(/^https?:\/\/(www\.)?(indianvisaonline\.gov\.in|mha\.gov\.in|boi\.gov\.in)/);
      expect(e.source.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
  it('covers the e-Tourist 30d / 1y / 5y split and e-Business / e-Medical', () => {
    const ids = new Set((evisa as { id: string }[]).map((e) => e.id));
    for (const id of ['evisa.tourist.30d', 'evisa.tourist.1y', 'evisa.tourist.5y', 'evisa.business', 'evisa.medical']) {
      expect(ids.has(id), `missing ${id}`).toBe(true);
    }
  });
});

describe('Regular/Paper seed data', () => {
  it('is a non-empty array of schema-valid categories, all applicationMode "regular"', () => {
    expect(regular.length).toBeGreaterThanOrEqual(7);
    for (const entry of regular) {
      expect(visaCategorySchema.safeParse(entry).success, JSON.stringify(entry)).toBe(true);
      expect((entry as { applicationMode: string }).applicationMode).toBe('regular');
    }
  });
  it('covers tourist / business / medical / employment / student', () => {
    const ids = new Set((regular as { id: string }[]).map((e) => e.id));
    for (const id of ['regular.tourist', 'regular.business', 'regular.medical', 'regular.employment', 'regular.student']) {
      expect(ids.has(id), `missing ${id}`).toBe(true);
    }
  });
  it('the tourist entry records the India–Bangladesh bilateral provision', () => {
    const t = (regular as { id: string; specialConditions: string[] }[]).find((e) => e.id === 'regular.tourist');
    expect(t && t.specialConditions.join(' ')).toMatch(/bilateral|multiple[- ]entry|travel arrangement/i);
  });
  it('every entry has an official source URL (HCI Dhaka / indianvisaonline / MHA / IVAC BD)', () => {
    for (const e of regular as { source: { officialUrl: string } }[]) {
      expect(e.source.officialUrl).toMatch(/hcidhaka\.gov\.in|indianvisaonline\.gov\.in|mha\.gov\.in|ivacbd\.com|boi\.gov\.in/);
    }
  });
});

afterEach(() => reload());

describe('the shipped India KB — integrity & versioning', () => {
  it('loads without error (all cross-checks pass)', () => {
    expect(() => loadKnowledgeBase()).not.toThrow();
  });

  it('every category has exactly one Bangladesh eligibility record', () => {
    const kb = loadKnowledgeBase();
    const bgd = kb.eligibility.filter((e) => e.nationality === 'BGD');
    const covered = new Map<string, number>();
    for (const e of bgd) covered.set(e.categoryId, (covered.get(e.categoryId) ?? 0) + 1);
    for (const c of kb.categories) {
      expect(covered.get(c.id), `no BGD eligibility record for ${c.id}`).toBe(1);
    }
    expect(bgd.length).toBe(kb.categories.length);
  });

  it('every e-Visa eligibility record encodes the universal exclusions', () => {
    const kb = loadKnowledgeBase();
    for (const e of kb.eligibility.filter((x) => x.applicationMode === 'evisa')) {
      const types = e.conditions.map((c) => c.type);
      expect(types, e.categoryId).toContain('passport_type_not_in');
      expect(types, e.categoryId).toContain('no_prohibited_background');
    }
  });

  it('getVersion reports the meta version, and every entry carries provenance', () => {
    const kb = loadKnowledgeBase();
    const v = getVersion(kb);
    expect(v.kbVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(v.schemaVersion).toBeGreaterThanOrEqual(1);
    for (const entry of [...kb.categories, ...kb.eligibility]) {
      expect(entry.source.officialUrl).toMatch(/^https?:\/\//);
      expect(entry.source.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('every Regular eligibility record sourced to hcidhaka.gov.in discloses that the fetch was not live', () => {
    const kb = loadKnowledgeBase();
    const hci = kb.eligibility.filter((e) => e.source.officialUrl.includes('hcidhaka.gov.in'));
    expect(hci.length).toBeGreaterThan(0);
    for (const e of hci) {
      // `retrievedAt` on these records must not read as "we pulled this category page";
      // the note has to carry the retrieval caveat and the re-verify instruction.
      expect(e.source.notes, `${e.categoryId} has no source.notes`).toBeTruthy();
      expect(e.source.notes, e.categoryId).toMatch(/not machine-retrievable/i);
      expect(e.source.notes, e.categoryId).toMatch(/re-verify/i);
    }
  });

  it('no eligibility record silently implies eligibility for a category that has none', () => {
    // sanity: there is no category without a record (covered above); this asserts the guarantee explicitly
    const kb = loadKnowledgeBase();
    const recorded = new Set(kb.eligibility.map((e) => `${e.nationality}|${e.applicationMode}|${e.categoryId}`));
    for (const c of kb.categories) {
      expect(recorded.has(`BGD|${c.applicationMode}|${c.id}`)).toBe(true);
    }
  });
});
