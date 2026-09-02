import { z } from 'zod';
import { FIELD_SOURCES, isOcrSource, isValidFieldPath } from './fieldPaths.js';

/** null | absent | '' -> null; otherwise trimmed string, max length enforced. */
const nstr = (max = 200) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => {
      const s = (v ?? '').trim();
      return s.length > 0 ? s : null;
    })
    .pipe(z.string().max(max).nullable());

const isoDate = () =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => {
      const s = (v ?? '').trim();
      return s.length > 0 ? s : null;
    })
    .pipe(
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
        .refine((s) => !Number.isNaN(Date.parse(s)), 'not a real date')
        .nullable(),
    );

const emailField = () =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => {
      const s = (v ?? '').trim();
      return s.length > 0 ? s : null;
    })
    .pipe(z.string().email('must be an email address').max(200).nullable());

const phoneField = () => nstr(40);

export const identitySchema = z.object({
  surname: nstr(120),
  givenNames: nstr(120),
  fullNameAsInPassport: nstr(240),
  dateOfBirth: isoDate(),
  sex: z
    .union([z.enum(['M', 'F', 'X']), z.null()])
    .optional()
    .transform((v) => v ?? null),
  placeOfBirth: nstr(120),
  nationality: nstr(80),
  otherNationalities: nstr(200),
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
    source: z
      .string()
      .refine((s) => (FIELD_SOURCES as readonly string[]).includes(s), 'unknown source')
      .default('manual'),
    confidence: z
      .union([z.number().min(0).max(1), z.null()])
      .optional()
      .transform((v) => v ?? null),
    rawValue: z
      .union([z.string().max(4000), z.null()])
      .optional()
      .transform((v) => v ?? null),
    verified: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.confidence !== null && !isOcrSource(v.source)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['confidence'],
        message: 'confidence is only allowed for OCR sources',
      });
    }
  });

export const applicantCreateSchema = z.object({
  displayName: z.string().trim().min(1, 'display name is required').max(120),
  identity: identitySchema.optional(),
  passport: passportSchema.optional(),
  contact: contactSchema.optional(),
  address: addressSchema.optional(),
});

export const applicantPutSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  status: z.enum(['draft', 'archived']).optional(),
  identity: identitySchema.optional(),
  passport: passportSchema.optional(),
  contact: contactSchema.optional(),
  address: addressSchema.optional(),
});

export type IdentityPatch = z.infer<typeof identitySchema>;
export type PassportPatch = z.infer<typeof passportSchema>;
export type ContactPatch = z.infer<typeof contactSchema>;
export type AddressPatch = z.infer<typeof addressSchema>;
export type TravelInput = z.infer<typeof travelSchema>;
export type ReferenceInput = z.infer<typeof referenceSchema>;
export type FieldMetaInput = z.infer<typeof fieldMetaInputSchema>;
export type ApplicantCreate = z.infer<typeof applicantCreateSchema>;
export type ApplicantPut = z.infer<typeof applicantPutSchema>;
