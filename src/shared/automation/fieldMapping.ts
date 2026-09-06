import type { MappedField, PortalFieldMap } from './types.js';
import type { SectionPlan } from '../application/types.js';

/**
 * Pure projection of Phase 4 `SectionPlan[]` onto portal control specs.
 *
 * A section contributes fields only when it is `applicable` and its id is in
 * `activeSectionIds`. Within such a section, every field that is neither
 * `not_applicable` nor an `appliesTo: null` synthetic row becomes a
 * `MappedField`; unmapped field paths surface with `spec: null` / `expected: null`
 * so the caller can report the gap.
 */
export function mapFields(
  sections: readonly SectionPlan[],
  fieldMap: PortalFieldMap,
  activeSectionIds: readonly string[],
): MappedField[] {
  const out: MappedField[] = [];
  for (const section of sections) {
    if (!section.applicable || !activeSectionIds.includes(section.id)) continue;
    for (const field of section.fields) {
      if (field.effectiveRequirement === 'not_applicable') continue;
      if (field.appliesTo === null) continue;
      const spec = fieldMap[field.appliesTo] ?? null;
      const canonical = field.value ?? '';
      let expected: string | null = null;
      if (spec !== null && field.present) {
        expected = spec.transform ? spec.transform(canonical) : canonical;
      }
      out.push({
        fieldPath: field.appliesTo,
        label: field.label,
        sectionId: field.sectionId,
        required: field.effectiveRequirement === 'required',
        present: field.present,
        verified: field.verified,
        spec,
        expected,
      });
    }
  }
  return out;
}
