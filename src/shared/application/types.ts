import type {
  ApplicationMode,
  EligibilityCondition,
  FormCondition,
  KnowledgeBase,
  PurposeTag,
  Source,
  StayLimitations,
  VisaValidity,
} from '../visa-kb/schema.js';
import type {
  Address,
  Contact,
  Family,
  FieldMeta,
  Identity,
  Occupation,
  Passport,
  Reference,
  TravelRecord,
} from '../applicant/types.js';

export type EntryType = 'single' | 'double' | 'multiple';
export type ApplicationStatus = 'draft' | 'ready' | 'archived';

/** The applicant-side data the pure engine reads. Not the full ApplicantDetail —
 *  no id/displayName/status/completeness/verification/warnings; those are
 *  applicant-record concerns, not engine inputs. */
export interface FlatApplicant {
  identity: Identity;
  passport: Passport;
  contact: Contact;
  address: Address;
  family: Family;
  occupation: Occupation;
  travel: TravelRecord[];
  references: Reference[];
  fieldMeta: FieldMeta[];
}

export interface Selection {
  destination: string | null;
  applicationMode: ApplicationMode;
  categoryId: string;
  purpose: PurposeTag | null;
  entryType: EntryType | null;
  intendedArrivalDate: string | null;
  intendedStayDays: number | null;
  portOfArrival: string | null;
}

export interface DocumentCoverageEntry {
  id: string;
  /** Phase 3 document classification kind, e.g. 'passport' | 'unknown' — kept as
   *  `string` here (not imported from documents/types.ts) to preserve this
   *  module's isolation from the Phase 3 document subsystem. */
  kind: string;
  originalName: string | null;
  fields: { fieldPath: string; verified: boolean }[];
}

/** Assembled by the service layer (Task 13) from Phase 3 document/field-meta data;
 *  the pure engine only ever reads it. */
export interface DocumentCoverage {
  /** Per applicant field path: was a value ever applied from a document, and is it verified. */
  fieldCoverage: Record<string, { applied: boolean; verified: boolean }>;
  documents: DocumentCoverageEntry[];
}

export interface BuildApplicationPlanInput {
  applicant: FlatApplicant;
  documentCoverage: DocumentCoverage;
  selection: Selection;
  /** `application.*` field path -> current value + verification state. */
  applicationValues: Record<string, { value: string | null; verified: boolean }>;
  kb: KnowledgeBase;
  now: Date;
}

export interface EligibilityConditionView {
  condition: EligibilityCondition;
  conditionMet: boolean | null;
  text: string;
  source: Source;
}

export interface EligibilityPlan {
  status: 'eligible' | 'conditional' | 'ineligible' | 'not_offered' | 'unknown';
  reason?: string;
  conditions: EligibilityConditionView[];
  unmetConditions: EligibilityConditionView[];
  warnings: Warning[];
  basis: string | null;
  source: Source | null;
}

export interface FieldPlan {
  id: string;
  label: string;
  sectionId: string;
  requirement: 'required' | 'conditional' | 'optional' | 'not_applicable';
  condition: FormCondition | null;
  conditionMet: boolean | null;
  effectiveRequirement: 'required' | 'optional' | 'not_applicable';
  appliesTo: string | null;
  value: string | null;
  present: boolean;
  verified: boolean;
  source: Source;
}

export interface SectionPlan {
  id: string;
  label: string;
  applicable: boolean;
  source: Source;
  fields: FieldPlan[];
}

export interface DocumentPlan {
  id: string;
  label: string;
  requirement: 'required' | 'optional' | 'conditional';
  condition: FormCondition | null;
  conditionMet: boolean | null;
  effectiveRequirement: 'required' | 'optional' | 'not_applicable';
  uploaded: boolean;
  matchedDocumentId: string | null;
  source: Source;
}

export interface MissingItem {
  kind: 'field' | 'document';
  id: string;
  label: string;
  sectionId?: string;
  appliesTo?: string | null;
  source: Source;
}

export interface Warning {
  text: string;
  severity: 'info' | 'warn' | 'blocker';
  source: Source | null;
}

export interface Blocker {
  text: string;
  kind: 'eligibility' | 'field' | 'document' | 'warning';
  source: Source | null;
}

export interface VerificationRollup {
  requiredVerified: number;
  requiredTotal: number;
  ratio: number;
  label: 'unverified' | 'partial' | 'verified';
  bySection: Record<string, { verified: number; total: number }>;
}

export interface ApplicationPlan {
  selection: Selection;
  /** `null` iff `selection.categoryId` is not found in the KB. */
  category:
    | (Pick<
        import('../visa-kb/schema.js').VisaCategory,
        | 'id'
        | 'displayName'
        | 'applicationMode'
        | 'officialCode'
        | 'subCategory'
        | 'entries'
        | 'extendable'
        | 'convertible'
      > & { validity: VisaValidity; stayLimitations: StayLimitations })
    | null;
  eligibility: EligibilityPlan;
  sections: SectionPlan[];
  documents: DocumentPlan[];
  missing: MissingItem[];
  verification: VerificationRollup;
  readyForAutomation: { ready: boolean; blockers: Blocker[] };
  provenance: { kbVersion: string; kbRevisionDate: string; schemaVersion: number; computedAt: string };
  /** Plan-level warnings, e.g. a stale kb_version pin, or categoryId not found in the KB. */
  warnings: Warning[];
}

/** `visa_applications` DB row, camelCase — mirrors migration 4. */
export interface VisaApplication {
  id: string;
  applicantId: string;
  destination: string;
  applicationMode: ApplicationMode;
  categoryId: string;
  purpose: PurposeTag | null;
  entryType: EntryType | null;
  intendedArrivalDate: string | null;
  intendedStayDays: number | null;
  portOfArrival: string | null;
  status: ApplicationStatus;
  kbVersion: string;
  createdAt: string;
  updatedAt: string;
}

/** Same shape as `VisaApplication` — the table is small and flat, so a list view
 *  needs no lighter projection (contrast `ApplicantSummary`, which trims a much
 *  larger nested detail record). Kept as a distinct alias so callers name their
 *  intent (list vs. single-record read) and either can be widened independently
 *  later without a breaking rename. */
export type VisaApplicationSummary = VisaApplication;
