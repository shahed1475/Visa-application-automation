import { describe, expect, it } from 'vitest';
import evisa from '../../../src/shared/visa-kb/data/india/evisa-categories.json' with { type: 'json' };
import regular from '../../../src/shared/visa-kb/data/india/regular-categories.json' with { type: 'json' };
import { visaCategorySchema } from '../../../src/shared/visa-kb/schema.js';

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
