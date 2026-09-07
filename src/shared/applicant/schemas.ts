import { z } from 'zod';
import { FIELD_SOURCES, isOcrSource, isValidFieldPath } from './fieldPaths.js';

/**
 * Section bodies are TRUE partial patches: a key the caller did not send must stay
 * `undefined` all the way through parsing, so the writers can tell "clear this to
 * NULL" (explicit `null` / `''`) apart from "leave this alone" (absent).
 *
 *   absent    -> undefined  (not written; sibling value and its field-meta survive)
 *   null | '' -> null       (explicitly cleared)
 *   '  x  '   -> 'x'        (trimmed)
 *
 * A `ZodObject` omits a key from its output entirely when the key was absent from
 * the input and the parsed value is `undefined`, so `identitySchema.parse({})` is
 * `{}` — `Object.entries` over it yields nothing to write.
 */
const blankToNull = (v: string | null | undefined): string | null | undefined => {
  if (v === undefined) return undefined;
  const s = (v ?? '').trim();
  return s.length > 0 ? s : null;
};

/** null | '' -> null; absent -> absent; otherwise trimmed string, max length enforced. */
const nstr = (max = 200) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform(blankToNull)
    .pipe(z.string().max(max).nullable().optional());

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `Date.parse` alone accepts impossible calendar dates in some engines and, more
 * importantly, silently rolls over out-of-range days. Round-tripping through
 * `toISOString()` rejects `2026-02-31`, `2026-13-01` and friends.
 */
export function isRealCalendarDate(s: string): boolean {
  if (!ISO_DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === s;
}

const isoDate = () =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform(blankToNull)
    .pipe(
      z
        .string()
        .regex(ISO_DATE_RE, 'must be YYYY-MM-DD')
        .refine(isRealCalendarDate, 'not a real date')
        .nullable()
        .optional(),
    );

const emailField = () =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform(blankToNull)
    .pipe(z.string().email('must be an email address').max(200).nullable().optional());

const phoneField = () => nstr(40);

export const identitySchema = z.object({
  surname: nstr(120),
  givenNames: nstr(120),
  fullNameAsInPassport: nstr(240),
  dateOfBirth: isoDate(),
  sex: z.union([z.enum(['M', 'F', 'X']), z.null()]).optional(),
  placeOfBirth: nstr(120),
  nationality: nstr(80),
  otherNationalities: nstr(200),
  religion: nstr(80),
  education: nstr(160),
  nationalId: nstr(80),
  visibleMarks: nstr(300),
  nationalityAtBirth: nstr(80),
});

export const passportSchema = z.object({
  documentType: nstr(40),
  number: nstr(40),
  issuingState: nstr(80),
  issueDate: isoDate(),
  expiryDate: isoDate(),
  placeOfIssue: nstr(120),
  issuingAuthority: nstr(120),
});

export const contactSchema = z.object({
  email: emailField(),
  phone: phoneField(),
  altPhone: phoneField(),
});

export const addressSchema = z.object({
  line1: nstr(160),
  line2: nstr(160),
  city: nstr(120),
  region: nstr(120),
  postalCode: nstr(40),
  country: nstr(80),
});

export const familySchema = z.object({
  fatherName: nstr(160),
  fatherNationality: nstr(80),
  fatherPrevNationality: nstr(80),
  fatherPlaceOfBirth: nstr(120),
  motherName: nstr(160),
  motherNationality: nstr(80),
  motherPrevNationality: nstr(80),
  motherPlaceOfBirth: nstr(120),
  maritalStatus: z.union([z.enum(['single', 'married', 'divorced', 'widowed']), z.null()]).optional(),
  spouseName: nstr(160),
  spouseNationality: nstr(80),
  spousePrevNationality: nstr(80),
  spousePlaceOfBirth: nstr(120),
  pakistanAncestry: z.union([z.enum(['yes', 'no']), z.null()]).optional(),
});

export const occupationSchema = z.object({
  occupation: nstr(160),
  employerName: nstr(160),
  employerAddress: nstr(300),
  designation: nstr(120),
  militaryPolice: z.union([z.enum(['yes', 'no']), z.null()]).optional(),
});

export const travelSchema = z.object({
  tripType: nstr(60),
  purpose: nstr(200),
  destinationCountry: nstr(80),
  cities: nstr(300),
  arrivalDate: isoDate(),
  departureDate: isoDate(),
  portOfEntry: nstr(120),
  portOfExit: nstr(120),
  accommodation: nstr(300),
  previousTravel: nstr(1000),
  notes: nstr(1000),
});

export const referenceSchema = z.object({
  kind: z
    .enum(['emergency_contact', 'employer', 'in_country_host', 'sponsor', 'other'])
    .default('other'),
  name: nstr(160),
  relationship: nstr(80),
  organization: nstr(160),
  phone: phoneField(),
  email: emailField(),
  address: nstr(300),
});

export const fieldMetaInputSchema = z
  .object({
    fieldPath: z.string().trim().refine(isValidFieldPath, 'invalid field path'),
    // No `.default('manual')`: an omitted `source` must stay `undefined` so
    // `upsertFieldMeta` can keep an existing row's provenance instead of resetting
    // it. The 'manual' default is applied there, for genuinely new rows only.
    source: z
      .string()
      .refine((s) => (FIELD_SOURCES as readonly string[]).includes(s), 'unknown source')
      .optional(),
    confidence: z.union([z.number().min(0).max(1), z.null()]).optional(),
    rawValue: z.union([z.string().max(4000), z.null()]).optional(),
    verified: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    const ocr = v.source !== undefined && isOcrSource(v.source);
    if (v.confidence != null && !ocr) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['confidence'],
        message: 'confidence is only allowed for OCR sources',
      });
    }
    // An OCR/MRZ reading is a machine guess; "verified" means a human checked it.
    // A write may not claim both at once — confirm the value in a separate call
    // (which omits `source`, so the OCR provenance is preserved).
    if (ocr && v.verified === true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['verified'],
        message: 'an OCR value cannot be marked verified in the same write; confirm it separately',
      });
    }
  });

export const applicantCreateSchema = z.object({
  displayName: z.string().trim().min(1, 'display name is required').max(120),
  identity: identitySchema.optional(),
  passport: passportSchema.optional(),
  contact: contactSchema.optional(),
  address: addressSchema.optional(),
  family: familySchema.optional(),
  occupation: occupationSchema.optional(),
});

export const applicantPutSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  status: z.enum(['draft', 'archived']).optional(),
  identity: identitySchema.optional(),
  passport: passportSchema.optional(),
  contact: contactSchema.optional(),
  address: addressSchema.optional(),
  family: familySchema.optional(),
  occupation: occupationSchema.optional(),
});

// Parsed (server-side) shapes — what the service layer receives after `safeParse`.
export type IdentityPatch = z.infer<typeof identitySchema>;
export type PassportPatch = z.infer<typeof passportSchema>;
export type ContactPatch = z.infer<typeof contactSchema>;
export type AddressPatch = z.infer<typeof addressSchema>;
export type FamilyPatch = z.infer<typeof familySchema>;
export type OccupationPatch = z.infer<typeof occupationSchema>;
export type TravelInput = z.infer<typeof travelSchema>;
export type ReferenceInput = z.infer<typeof referenceSchema>;
export type FieldMetaInput = z.infer<typeof fieldMetaInputSchema>;
export type ApplicantCreate = z.infer<typeof applicantCreateSchema>;
export type ApplicantPut = z.infer<typeof applicantPutSchema>;

// Request-body (client-side) shapes — what a caller may SEND, before parsing.
// The API client takes these so callers need no casts: pre-parse a section value
// may be a raw `''`, an explicit `null`, or simply absent.
export type IdentityPatchInput = z.input<typeof identitySchema>;
export type PassportPatchInput = z.input<typeof passportSchema>;
export type ContactPatchInput = z.input<typeof contactSchema>;
export type AddressPatchInput = z.input<typeof addressSchema>;
export type FamilyPatchInput = z.input<typeof familySchema>;
export type OccupationPatchInput = z.input<typeof occupationSchema>;
export type TravelPatchInput = z.input<typeof travelSchema>;
export type ReferencePatchInput = z.input<typeof referenceSchema>;
export type FieldMetaPatchInput = z.input<typeof fieldMetaInputSchema>;
export type ApplicantCreateInput = z.input<typeof applicantCreateSchema>;
export type ApplicantPutInput = z.input<typeof applicantPutSchema>;
