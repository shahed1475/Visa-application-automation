import { afterEach, describe, expect, it } from 'vitest';
import evisa from '../../../src/shared/visa-kb/data/india/evisa-categories.json' with { type: 'json' };
import regular from '../../../src/shared/visa-kb/data/india/regular-categories.json' with { type: 'json' };
import { visaCategorySchema, FORM_SECTION_IDS, SOURCE_CONFIDENCE } from '../../../src/shared/visa-kb/schema.js';
import { loadKnowledgeBase, reload } from '../../../src/shared/visa-kb/loader.js';
import { getFormModel, getVersion } from '../../../src/shared/visa-kb/queries.js';
import { isValidFieldPath } from '../../../src/shared/applicant/fieldPaths.js';

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

  it('is schema v2 and ships a form model with at least one section', () => {
    expect(loadKnowledgeBase().meta.schemaVersion).toBe(2);
    expect(getFormModel().sections.length).toBeGreaterThanOrEqual(1);
  });

  it('every category carries formRules and conditionalDocuments, and every source a confidence', () => {
    const kb = loadKnowledgeBase();
    for (const c of kb.categories) {
      expect(Array.isArray(c.formRules.applicableSections), c.id).toBe(true);
      expect(Array.isArray(c.formRules.fieldRules), c.id).toBe(true);
      expect(Array.isArray(c.conditionalDocuments), c.id).toBe(true);
    }
    for (const entry of [...kb.categories, ...kb.eligibility]) {
      expect(entry.source.confidence).toBeTruthy();
    }
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

describe('the real India form-model catalog (schema v2, Task 2)', () => {
  it('has all 11 canonical sections, each with at least one field', () => {
    const { sections } = getFormModel();
    const ids = sections.map((s) => s.id);
    for (const id of FORM_SECTION_IDS) {
      expect(ids, `missing section ${id}`).toContain(id);
    }
    expect(ids.length).toBe(FORM_SECTION_IDS.length);
    for (const s of sections) {
      expect(s.fields.length, `${s.id} has no fields`).toBeGreaterThanOrEqual(1);
    }
  });

  it('every FormField.appliesTo is null, an application.* path, or a syntactically valid profile path', () => {
    const { sections } = getFormModel();
    for (const s of sections) {
      for (const f of s.fields) {
        if (f.appliesTo === null) continue;
        const ok = f.appliesTo.startsWith('application.') || isValidFieldPath(f.appliesTo);
        expect(ok, `${s.id}.${f.id} appliesTo "${f.appliesTo}"`).toBe(true);
      }
    }
  });

  it('every section and field source.confidence is a member of SOURCE_CONFIDENCE', () => {
    const { sections } = getFormModel();
    for (const s of sections) {
      expect(SOURCE_CONFIDENCE, s.id).toContain(s.source.confidence);
      for (const f of s.fields) {
        expect(SOURCE_CONFIDENCE, `${s.id}.${f.id}`).toContain(f.source.confidence);
      }
    }
  });

  it('the form model never claims official_verbatim (Phase-4 ceiling is official_derived)', () => {
    const { sections } = getFormModel();
    for (const s of sections) {
      expect(s.source.confidence, s.id).not.toBe('official_verbatim');
      for (const f of s.fields) {
        expect(f.source.confidence, `${s.id}.${f.id}`).not.toBe('official_verbatim');
      }
    }
  });

  it('the plan-named representative fields exist with the right appliesTo', () => {
    const byId = new Map(getFormModel().sections.map((s) => [s.id, s]));

    const family = byId.get('family');
    const spouseName = family?.fields.find((f) => f.id === 'spouse_name');
    expect(spouseName?.appliesTo).toBe('family.spouseName');

    const business = byId.get('business_details');
    const indiaCompanyName = business?.fields.find((f) => f.id === 'india_company_name');
    expect(indiaCompanyName?.appliesTo).toBe('application.indiaCompanyName');

    const references = byId.get('references');
    expect(references?.fields.find((f) => f.id === 'home_country_reference')?.appliesTo).toBeNull();
    // `india_references_min` is count-driven, has no visible form field, and is synthesised by
    // the engine from its FieldRule alone. Listing it here too produced two plan entries under
    // one id (duplicate React key, verification rollup disagreeing with the rendered rows), so
    // form-model.json must NOT carry it.
    expect(references?.fields.map((f) => f.id)).not.toContain('india_references_min');

    const personal = byId.get('personal_particulars');
    const standardBlock = personal?.fields.find((f) => f.id === 'standard_personal_block');
    expect(standardBlock?.appliesTo).toBeNull();
    expect(standardBlock?.standardBlock).toBe(true);

    const visaDetails = byId.get('visa_details');
    const purpose = visaDetails?.fields.find((f) => f.id === 'purpose');
    expect(purpose?.appliesTo).toBe('application.purpose');

    const previousVisits = byId.get('previous_visits');
    const visitedBefore = previousVisits?.fields.find((f) => f.id === 'visited_india_before');
    expect(visitedBefore?.appliesTo).toBe('application.visitedIndiaBefore');
  });

  it('every source across the whole KB (categories + eligibility) has a confidence in the enum', () => {
    const kb = loadKnowledgeBase();
    for (const c of kb.categories) {
      expect(SOURCE_CONFIDENCE, c.id).toContain(c.source.confidence);
    }
    for (const e of kb.eligibility) {
      expect(SOURCE_CONFIDENCE, `${e.categoryId}(${e.nationality})`).toContain(e.source.confidence);
    }
  });
});

describe('per-category formRules & conditionalDocuments (Task 3, spec §4.3/§4.4/§11.2/§11.3)', () => {
  function byId(id: string) {
    const kb = loadKnowledgeBase();
    const c = kb.categories.find((x) => x.id === id);
    if (!c) throw new Error(`missing category ${id}`);
    return c;
  }

  it('every category has a non-empty formRules.applicableSections', () => {
    const kb = loadKnowledgeBase();
    for (const c of kb.categories) {
      expect(c.formRules.applicableSections.length, c.id).toBeGreaterThan(0);
    }
  });

  it('regular.business names business_details/family/occupation, requires the 3 India-business fields, and requires 2 India references', () => {
    const c = byId('regular.business');
    for (const s of ['business_details', 'family', 'occupation']) {
      expect(c.formRules.applicableSections, c.id).toContain(s);
    }
    const rule = (fieldId: string) =>
      c.formRules.fieldRules.find((r) => r.sectionId === 'business_details' && r.fieldId === fieldId);
    for (const fieldId of ['india_company_name', 'india_company_address', 'nature_of_business']) {
      expect(rule(fieldId)?.requirement, fieldId).toBe('required');
    }
    const refRule = c.formRules.fieldRules.find(
      (r) => r.sectionId === 'references' && r.fieldId === 'india_references_min',
    );
    expect(refRule?.requirement).toBe('required');
    expect(refRule?.count).toBe(2);
  });

  it('regular.student names study_details and requires institution_name', () => {
    const c = byId('regular.student');
    expect(c.formRules.applicableSections).toContain('study_details');
    const rule = c.formRules.fieldRules.find(
      (r) => r.sectionId === 'study_details' && r.fieldId === 'institution_name',
    );
    expect(rule?.requirement).toBe('required');
  });

  it('regular.medical names medical_details and requires hospital_name', () => {
    const c = byId('regular.medical');
    expect(c.formRules.applicableSections).toContain('medical_details');
    const rule = c.formRules.fieldRules.find(
      (r) => r.sectionId === 'medical_details' && r.fieldId === 'hospital_name',
    );
    expect(rule?.requirement).toBe('required');
  });

  it('regular.transit stays minimal — no business_details/study_details/family/occupation', () => {
    const c = byId('regular.transit');
    for (const s of ['business_details', 'study_details', 'family', 'occupation']) {
      expect(c.formRules.applicableSections, s).not.toContain(s);
    }
  });

  it('evisa.tourist.30d keeps return_ticket in optionalDocuments and adds no redundant ticket conditionalDocuments entry', () => {
    const c = byId('evisa.tourist.30d');
    expect(c.optionalDocuments.some((d) => d.id === 'return_ticket')).toBe(true);
    expect(c.conditionalDocuments.some((d) => d.id.includes('ticket'))).toBe(false);
  });

  it('regular.tourist and evisa.tourist.30d gate spouse_name on marriage and father_name on minor age', () => {
    for (const id of ['regular.tourist', 'evisa.tourist.30d']) {
      const c = byId(id);
      const spouse = c.formRules.fieldRules.find(
        (r) => r.sectionId === 'family' && r.fieldId === 'spouse_name',
      );
      expect(spouse?.requirement, id).toBe('conditional');
      expect(spouse?.condition?.type, id).toBe('applicant_married');

      const guardian = c.formRules.fieldRules.find(
        (r) => r.sectionId === 'family' && r.fieldId === 'father_name',
      );
      expect(guardian?.requirement, id).toBe('conditional');
      expect(guardian?.condition?.type, id).toBe('age_lt');
      expect(guardian?.condition && 'value' in guardian.condition ? guardian.condition.value : undefined, id).toBe(18);
    }
  });

  it('regular.tourist has a conditionalDocuments entry gated on purpose_in family_visit', () => {
    const c = byId('regular.tourist');
    const entry = c.conditionalDocuments.find((d) => d.condition.type === 'purpose_in');
    expect(entry).toBeTruthy();
    expect(entry?.condition.type === 'purpose_in' ? entry.condition.value : []).toContain('family_visit');
  });

  it('every FieldRule and conditionalDoc source.confidence is secondary_guidance (not a higher claim)', () => {
    const kb = loadKnowledgeBase();
    for (const c of kb.categories) {
      for (const r of c.formRules.fieldRules) {
        expect(r.source.confidence, `${c.id} fieldRule ${r.sectionId}.${r.fieldId}`).toBe('secondary_guidance');
      }
      for (const d of c.conditionalDocuments) {
        expect(d.source.confidence, `${c.id} conditionalDoc ${d.id}`).toBe('secondary_guidance');
      }
    }
  });
});
