import { z } from 'zod';
import { APPLICATION_MODES, ENTRY_TYPES, PURPOSE_TAGS } from '../visa-kb/schema.js';
import { isValidFieldPath } from '../applicant/fieldPaths.js';

const blankToNull = (v: string | null | undefined): string | null | undefined => {
  if (v === undefined) return undefined;
  const s = (v ?? '').trim();
  return s.length > 0 ? s : null;
};

const nstr = (max = 200) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform(blankToNull)
    .pipe(z.string().max(max).nullable().optional());

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealCalendarDate(s: string): boolean {
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

export const selectionSchema = z.object({
  destination: nstr(3),
  applicationMode: z.enum(APPLICATION_MODES),
  categoryId: z.string().trim().min(1, 'categoryId is required'),
  purpose: z.union([z.enum(PURPOSE_TAGS), z.null()]).optional(),
  entryType: z.union([z.enum(ENTRY_TYPES), z.null()]).optional(),
  intendedArrivalDate: isoDate(),
  intendedStayDays: z.union([z.number().int().positive(), z.null()]).optional(),
  portOfArrival: nstr(120),
});

/** POST body for creating an application — mode + categoryId required, rest optional. */
export const applicationCreateSchema = selectionSchema;

/** PUT body for updating an application — every field optional (partial patch). */
export const applicationPutSchema = selectionSchema.partial();

export const applicationFieldValueSchema = z.object({
  fieldPath: z
    .string()
    .trim()
    .refine((p) => p.startsWith('application.') && isValidFieldPath(p), 'invalid application field path'),
  value: z.union([z.string(), z.null()]).optional(),
  verified: z.boolean().optional(),
});

export type SelectionInput = z.infer<typeof selectionSchema>;
export type ApplicationCreate = z.infer<typeof applicationCreateSchema>;
export type ApplicationPut = z.infer<typeof applicationPutSchema>;
export type ApplicationFieldValueInput = z.infer<typeof applicationFieldValueSchema>;
