import { describe, expect, it } from 'vitest';
import { mapFields } from '../../src/shared/automation/fieldMapping.js';
import type { SectionPlan } from '../../src/shared/application/types.js';
import type { PortalFieldMap } from '../../src/shared/automation/types.js';

const src = { officialUrl: 'https://x.test/', retrievedAt: '2026-01-01', confidence: 'secondary_guidance' } as const;
function field(over: Partial<import('../../src/shared/application/types.js').FieldPlan>) {
  return { id: 'f', label: 'F', sectionId: 's1', requirement: 'required', condition: null, conditionMet: null,
    effectiveRequirement: 'required', appliesTo: 'identity.surname', value: 'RANA', present: true, verified: false, source: src, ...over } as any;
}
const sections: SectionPlan[] = [
  { id: 's1', label: 'S1', applicable: true, source: src as any, fields: [
    field({ appliesTo: 'identity.surname', value: 'RANA' }),
    field({ id: 'g', appliesTo: 'identity.givenNames', value: 'MITHU', effectiveRequirement: 'optional' }),
    field({ id: 'na', appliesTo: 'identity.religion', effectiveRequirement: 'not_applicable' }),
    field({ id: 'syn', appliesTo: null }),
    field({ id: 'nomap', appliesTo: 'application.purpose', value: 'business' }),
  ] },
  { id: 's2', label: 'S2', applicable: true, source: src as any, fields: [ field({ id: 'x', sectionId: 's2' }) ] },
  { id: 's3', label: 'S3', applicable: false, source: src as any, fields: [ field({ id: 'y', sectionId: 's3' }) ] },
];
const fieldMap: PortalFieldMap = {
  'identity.surname': { selector: '#surname', control: 'text', selectorConfidence: 'stable' },
  'identity.givenNames': { selector: '#given', control: 'text', selectorConfidence: 'stable' },
  'identity.religion': { selector: '#rel', control: 'text', selectorConfidence: 'stable' },
  'application.purpose': undefined as any, // deliberately absent below
};
delete (fieldMap as any)['application.purpose'];

describe('mapFields', () => {
  it('maps present fields in active applicable sections, applying transform', () => {
    const withTransform: PortalFieldMap = { ...fieldMap, 'identity.surname': { selector: '#s', control: 'text', selectorConfidence: 'stable', transform: (v) => v.toLowerCase() } };
    const out = mapFields(sections, withTransform, ['s1']);
    const surname = out.find((m) => m.fieldPath === 'identity.surname')!;
    expect(surname.expected).toBe('rana');
    expect(surname.required).toBe(true);
    expect(surname.spec?.selector).toBe('#s');
  });
  it('excludes not_applicable fields and appliesTo:null synthetic rows', () => {
    const out = mapFields(sections, fieldMap, ['s1']);
    expect(out.map((m) => m.fieldPath)).not.toContain('identity.religion');
    expect(out.some((m) => m.fieldPath === null as any)).toBe(false);
  });
  it('includes an unmapped required field with spec:null, expected:null', () => {
    const out = mapFields(sections, fieldMap, ['s1']);
    const p = out.find((m) => m.fieldPath === 'application.purpose')!;
    expect(p.spec).toBeNull();
    expect(p.expected).toBeNull();
    expect(p.required).toBe(true);
  });
  it('excludes sections not in activeSectionIds and non-applicable sections', () => {
    const out = mapFields(sections, fieldMap, ['s1']);
    expect(out.every((m) => m.sectionId === 's1')).toBe(true);
  });
  it('expected is null for a mapped-but-absent field', () => {
    const out = mapFields([{ ...sections[0]!, fields: [ field({ present: false, value: null }) ] }], fieldMap, ['s1']);
    expect(out[0]!.expected).toBeNull();
    expect(out[0]!.present).toBe(false);
  });
});
