/**
 * Zod request-body schemas for the Phase 3 document routes (design §13).
 *
 * `uploadMetaSchema` validates the non-file part of the `POST /api/documents`
 * multipart body; `fieldPathBodySchema` validates the `{ fieldPath }` body of
 * the held-field `apply` / `dismiss` routes. Matches the house Zod style in
 * `src/shared/applicant/schemas.ts` (`.trim()`, `.refine`).
 *
 * Shared layer: Zod is the only permitted runtime dependency here (design §2).
 */

import { z } from 'zod';
import { isValidFieldPath } from '../applicant/fieldPaths.js';

/** Non-file fields of the upload multipart body. `applicantId` may be assigned later. */
export const uploadMetaSchema = z.object({
  applicantId: z.string().trim().min(1).optional(),
});

/** `{ fieldPath }` body for `POST /api/documents/:id/fields/{apply,dismiss}`. */
export const fieldPathBodySchema = z.object({
  fieldPath: z.string().trim().refine(isValidFieldPath, 'invalid field path'),
});

export type UploadMeta = z.infer<typeof uploadMetaSchema>;
export type FieldPathBody = z.infer<typeof fieldPathBodySchema>;
