import { z } from 'zod';
import { isHttpUrl } from './url.js';

const blankToNull = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null));

export const portalInputSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(120),
  url: z
    .string()
    .trim()
    .min(1, 'url is required')
    .max(2048)
    .refine(isHttpUrl, 'url must be a valid http(s) URL'),
  portalType: z.enum(['regular', 'evisa', 'custom']),
  country: blankToNull(100),
  applicationType: blankToNull(100),
  notes: blankToNull(2000),
  enabled: z.boolean().default(true),
});

export type PortalInput = z.infer<typeof portalInputSchema>;

export const activePortalSchema = z.object({
  portalId: z.string().min(1).nullable(),
});
