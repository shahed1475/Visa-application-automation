/**
 * Phase 3 document routes (design §13). Eight endpoints under `/api`, all error
 * responses via `routes/errors.ts` (sanitized envelope). No request body or file
 * content is ever logged (Phase 2 route-layer pattern).
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import * as svc from '../documents/documentService.js';
import { DocumentServiceError } from '../documents/documentService.js';
import { UploadError } from '../documents/fileType.js';
import { ENGINE_DETAIL } from '../documents/tesseractEngine.js';
import {
  fieldPathBodySchema,
  uploadMetaSchema,
} from '../../shared/documents/schemas.js';
import { errorBody, notFoundError, validationError } from './errors.js';

const UPLOAD_ERROR_MESSAGE: Record<UploadError['code'], string> = {
  too_large: 'file exceeds the size limit',
  empty: 'file is empty',
  unsupported_type: 'unsupported file type (JPEG, PNG or PDF only)',
};

export async function registerDocumentRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/documents', async (req, reply) => {
    let mp;
    try {
      mp = await req.file();
    } catch {
      return reply.code(400).send(errorBody('VALIDATION_ERROR', 'file is required'));
    }
    if (!mp) {
      return reply.code(400).send(errorBody('VALIDATION_ERROR', 'file is required'));
    }

    const bytes = await mp.toBuffer();
    if (mp.file.truncated) {
      return reply
        .code(400)
        .send(errorBody('VALIDATION_ERROR', 'file exceeds the size limit'));
    }

    const field = mp.fields.applicantId;
    const applicantIdValue =
      field && !Array.isArray(field) && field.type === 'field' && typeof field.value === 'string'
        ? field.value
        : undefined;
    const parsedMeta = uploadMetaSchema.safeParse(
      applicantIdValue === undefined || applicantIdValue.trim().length === 0
        ? {}
        : { applicantId: applicantIdValue },
    );
    if (!parsedMeta.success) {
      return reply.code(400).send(validationError(parsedMeta.error));
    }

    try {
      const document = svc.createDocument(app.db, {
        applicantId: parsedMeta.data.applicantId ?? null,
        originalName: mp.filename ?? null,
        bytes,
      });
      return reply.code(201).send({ document });
    } catch (e) {
      if (e instanceof UploadError) {
        return reply
          .code(400)
          .send(errorBody('VALIDATION_ERROR', UPLOAD_ERROR_MESSAGE[e.code]));
      }
      throw e;
    }
  });

  app.post<{ Params: { id: string } }>(
    '/api/documents/:id/extract',
    async (req, reply) => {
      try {
        const document = await svc.runExtraction(app.db, req.params.id, {
          ocr: app.ocr,
          engineDetail: ENGINE_DETAIL,
        });
        return { document };
      } catch (e) {
        if (e instanceof DocumentServiceError) {
          if (e.code === 'not_found') {
            return reply.code(404).send(notFoundError('document'));
          }
          if (e.code === 'no_applicant') {
            return reply
              .code(409)
              .send(errorBody('CONFLICT', 'assign the document to an applicant first'));
          }
        }
        throw e;
      }
    },
  );

  app.get<{ Querystring: { applicantId?: string } }>(
    '/api/documents',
    async (req) => ({
      documents: svc.listDocuments(app.db, req.query.applicantId),
    }),
  );

  app.get<{ Params: { id: string } }>('/api/documents/:id', async (req, reply) => {
    const document = svc.getDocument(app.db, req.params.id);
    if (!document) return reply.code(404).send(notFoundError('document'));
    return { document };
  });

  app.get<{ Params: { id: string } }>(
    '/api/documents/:id/file',
    async (req, reply) => {
      const file = svc.getDocumentFile(app.db, req.params.id);
      if (!file) return reply.code(404).send(notFoundError('document'));
      return reply
        .type(file.mimeType)
        .header('content-disposition', 'inline')
        .send(file.bytes);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/documents/:id/fields/apply',
    async (req, reply) => {
      const parsed = fieldPathBodySchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
      try {
        return { document: svc.applyHeldField(app.db, req.params.id, parsed.data.fieldPath) };
      } catch (e) {
        const mapped = mapFieldError(e, reply);
        if (mapped) return mapped;
        throw e;
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/documents/:id/fields/dismiss',
    async (req, reply) => {
      const parsed = fieldPathBodySchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
      try {
        return { document: svc.dismissField(app.db, req.params.id, parsed.data.fieldPath) };
      } catch (e) {
        const mapped = mapFieldError(e, reply);
        if (mapped) return mapped;
        throw e;
      }
    },
  );

  app.delete<{ Params: { id: string } }>('/api/documents/:id', async (req, reply) => {
    if (!svc.deleteDocument(app.db, req.params.id)) {
      return reply.code(404).send(notFoundError('document'));
    }
    return { deleted: true };
  });
}

function mapFieldError(e: unknown, reply: FastifyReply): FastifyReply | undefined {
  if (!(e instanceof DocumentServiceError)) return undefined;
  switch (e.code) {
    case 'not_found':
      return reply.code(404).send(notFoundError('document'));
    case 'no_applicant':
      return reply
        .code(409)
        .send(errorBody('CONFLICT', 'assign the document to an applicant first'));
    case 'field_not_held':
      return reply
        .code(409)
        .send(errorBody('CONFLICT', 'field is not awaiting a decision'));
    case 'field_has_no_value':
      return reply
        .code(409)
        .send(errorBody('CONFLICT', 'field has no usable value'));
    default:
      return undefined;
  }
}
