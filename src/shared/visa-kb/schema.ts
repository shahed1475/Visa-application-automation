import { z } from 'zod';
import { isHttpUrl } from '../url.js';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Rejects `2026-02-31`, `2026-13-01`, etc. — `Date.parse` alone rolls these over. */
export function isRealCalendarDate(s: string): boolean {
  if (!ISO_DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const isoDate = z
  .string()
  .regex(ISO_DATE_RE, 'must be YYYY-MM-DD')
  .refine(isRealCalendarDate, 'not a real calendar date');

const alpha3 = z.string().regex(/^[A-Z]{3}$/, 'must be an ISO 3166-1 alpha-3 code');

export const APPLICATION_MODES = ['evisa', 'regular'] as const;
export const VISA_CATEGORIES = [
  'tourist', 'business', 'medical', 'medical_attendant', 'conference', 'student',
  'employment', 'transit', 'entry_x', 'journalist', 'research', 'other',
] as const;
export const PURPOSE_TAGS = [
  'recreation', 'sightseeing', 'casual_visit', 'business', 'medical_treatment',
  'medical_attendant', 'conference', 'study', 'employment', 'transit',
  'family_visit', 'yoga_short_course', 'voluntary_work_short', 'other',
] as const;
export const ENTRY_TYPES = ['single', 'double', 'multiple'] as const;
export const ELIGIBILITY_STATUSES = ['eligible', 'conditional', 'ineligible', 'not_offered'] as const;
export const PASSPORT_TYPES = ['ordinary', 'diplomatic', 'official', 'service'] as const;
export const KNOWN_SCHEMA_VERSIONS = [1] as const;

export const sourceSchema = z
  .object({
    officialUrl: z.string().refine(isHttpUrl, 'must be an http(s) URL'),
    retrievedAt: isoDate,
    documentDate: isoDate.optional(),
    notes: z.string().min(1).optional(),
  })
  .strict();

export const docSchema = z
  .object({ id: z.string().min(1), label: z.string().min(1), notes: z.string().min(1).optional() })
  .strict();

export const validitySchema = z
  .object({
    amount: z.number().int().positive(),
    unit: z.enum(['days', 'months', 'years']),
    from: z.enum(['issue', 'first_arrival', 'eta_grant']),
    notes: z.string().min(1).optional(),
  })
  .strict();

export const stayLimitationsSchema = z
  .object({
    perVisitDays: z.number().int().positive().optional(),
    perCalendarYearDays: z.number().int().positive().optional(),
    aggregateDays: z.number().int().positive().optional(),
    notes: z.string().min(1).optional(),
  })
  .strict();

export const applicationTimingSchema = z
  .object({
    minLeadDays: z.number().int().nonnegative().optional(),
    maxLeadDays: z.number().int().positive().optional(),
    notes: z.string().min(1).optional(),
  })
  .strict();

export const travelRequirementsSchema = z
  .object({
    passportValidityMonthsMin: z.number().int().nonnegative().optional(),
    passportBlankPagesMin: z.number().int().nonnegative().optional(),
    onwardOrReturnTicket: z.boolean().optional(),
    portsOfEntry: z.array(z.string().min(1)).nullable().optional(),
    notes: z.string().min(1).optional(),
  })
  .strict();

export const visaCategorySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*(?:\.[a-z0-9]+(?:_[a-z0-9]+)*)+$/, 'id must be dot-separated lowercase slugs'),
    applicationMode: z.enum(APPLICATION_MODES),
    category: z.enum(VISA_CATEGORIES),
    subCategory: z.string().min(1).nullable(),
    officialCode: z.string().min(1).nullable(),
    displayName: z.string().min(1),
    purpose: z.array(z.enum(PURPOSE_TAGS)).min(1),
    validity: validitySchema,
    entries: z.enum(ENTRY_TYPES),
    stayLimitations: stayLimitationsSchema,
    extendable: z.boolean(),
    convertible: z.boolean(),
    applicationTiming: applicationTimingSchema,
    travelRequirements: travelRequirementsSchema,
    requiredDocuments: z.array(docSchema),
    optionalDocuments: z.array(docSchema),
    specialConditions: z.array(z.string().min(1)),
    restrictions: z.array(z.string().min(1)),
    source: sourceSchema,
    lastVerified: isoDate,
  })
  .strict();

export const conditionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('passport_type_in'), value: z.array(z.enum(PASSPORT_TYPES)).min(1) }).strict(),
  z.object({ type: z.literal('passport_type_not_in'), value: z.array(z.enum(PASSPORT_TYPES)).min(1) }).strict(),
  z.object({ type: z.literal('no_prohibited_background'), value: z.array(z.string().min(1)).min(1) }).strict(),
  z.object({ type: z.literal('purpose_in'), value: z.array(z.enum(PURPOSE_TAGS)).min(1) }).strict(),
  z.object({ type: z.literal('purpose_not_in'), value: z.array(z.enum(PURPOSE_TAGS)).min(1) }).strict(),
  z.object({ type: z.literal('not_endorsed_on_relative_passport') }).strict(),
  z.object({ type: z.literal('min_age'), value: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('max_age'), value: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('passport_validity_months_min'), value: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('requires_supporting_institution_letter') }).strict(),
  z.object({ type: z.literal('salary_min_inr_per_annum'), value: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('custom'), text: z.string().min(1) }).strict(),
]);

export const eligibilityRecordSchema = z
  .object({
    nationality: alpha3,
    applicationMode: z.enum(APPLICATION_MODES),
    categoryId: z.string().min(1),
    status: z.enum(ELIGIBILITY_STATUSES),
    conditions: z.array(conditionSchema),
    basis: z.string().min(1),
    source: sourceSchema,
    lastVerified: isoDate,
  })
  .strict();

export const metaSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    kbVersion: z.string().min(1),
    destination: alpha3,
    revisionDate: isoDate,
    notes: z.string().min(1).optional(),
  })
  .strict();

export const knowledgeBaseSchema = z
  .object({
    meta: metaSchema,
    categories: z.array(visaCategorySchema),
    eligibility: z.array(eligibilityRecordSchema),
  })
  .strict();

export type Source = z.infer<typeof sourceSchema>;
export type VisaDocument = z.infer<typeof docSchema>;
export type VisaValidity = z.infer<typeof validitySchema>;
export type StayLimitations = z.infer<typeof stayLimitationsSchema>;
export type ApplicationTiming = z.infer<typeof applicationTimingSchema>;
export type TravelRequirements = z.infer<typeof travelRequirementsSchema>;
export type VisaCategory = z.infer<typeof visaCategorySchema>;
export type EligibilityCondition = z.infer<typeof conditionSchema>;
export type EligibilityRecord = z.infer<typeof eligibilityRecordSchema>;
export type KnowledgeBaseMeta = z.infer<typeof metaSchema>;
export type KnowledgeBase = z.infer<typeof knowledgeBaseSchema>;
export type ApplicationMode = (typeof APPLICATION_MODES)[number];
export type VisaCategoryName = (typeof VISA_CATEGORIES)[number];
export type PurposeTag = (typeof PURPOSE_TAGS)[number];
