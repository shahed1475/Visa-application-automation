import type { FastifyInstance } from 'fastify';
import {
  applicantCreateSchema,
  applicantPutSchema,
  fieldMetaInputSchema,
  referenceSchema,
  travelSchema,
} from '../../shared/applicant/schemas.js';
import * as svc from '../services/applicantService.js';
import { notFoundError, validationError } from './errors.js';

export async function registerApplicantRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { q?: string } }>('/api/applicants', async (req) => ({
    applicants: svc.listApplicants(app.db, req.query.q),
  }));

  app.post('/api/applicants', async (req, reply) => {
    const parsed = applicantCreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
    return reply.code(201).send({ applicant: svc.createApplicant(app.db, parsed.data) });
  });

  app.get<{ Params: { id: string } }>('/api/applicants/:id', async (req, reply) => {
    const applicant = svc.getApplicantDetail(app.db, req.params.id);
    if (!applicant) return reply.code(404).send(notFoundError('applicant'));
    return { applicant };
  });

  app.put<{ Params: { id: string } }>('/api/applicants/:id', async (req, reply) => {
    const parsed = applicantPutSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
    const applicant = svc.updateApplicant(app.db, req.params.id, parsed.data);
    if (!applicant) return reply.code(404).send(notFoundError('applicant'));
    return { applicant };
  });

  app.delete<{ Params: { id: string } }>('/api/applicants/:id', async (req, reply) => {
    if (!svc.deleteApplicant(app.db, req.params.id)) {
      return reply.code(404).send(notFoundError('applicant'));
    }
    return { deleted: true };
  });

  app.post<{ Params: { id: string } }>(
    '/api/applicants/:id/duplicate',
    async (req, reply) => {
      const applicant = svc.duplicateApplicant(app.db, req.params.id);
      if (!applicant) return reply.code(404).send(notFoundError('applicant'));
      return reply.code(201).send({ applicant });
    },
  );

  // --- travel ---
  app.post<{ Params: { id: string } }>('/api/applicants/:id/travel', async (req, reply) => {
    const parsed = travelSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
    const travel = svc.addTravel(app.db, req.params.id, parsed.data);
    if (!travel) return reply.code(404).send(notFoundError('applicant'));
    return reply.code(201).send({ travel });
  });

  app.put<{ Params: { id: string; travelId: string } }>(
    '/api/applicants/:id/travel/:travelId',
    async (req, reply) => {
      const parsed = travelSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
      const travel = svc.updateTravel(app.db, req.params.id, req.params.travelId, parsed.data);
      if (!travel) return reply.code(404).send(notFoundError('travel record'));
      return { travel };
    },
  );

  app.delete<{ Params: { id: string; travelId: string } }>(
    '/api/applicants/:id/travel/:travelId',
    async (req, reply) => {
      if (!svc.deleteTravel(app.db, req.params.id, req.params.travelId)) {
        return reply.code(404).send(notFoundError('travel record'));
      }
      return { deleted: true };
    },
  );

  // --- references ---
  app.post<{ Params: { id: string } }>('/api/applicants/:id/references', async (req, reply) => {
    const parsed = referenceSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
    const reference = svc.addReference(app.db, req.params.id, parsed.data);
    if (!reference) return reply.code(404).send(notFoundError('applicant'));
    return reply.code(201).send({ reference });
  });

  app.put<{ Params: { id: string; refId: string } }>(
    '/api/applicants/:id/references/:refId',
    async (req, reply) => {
      const parsed = referenceSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
      const reference = svc.updateReference(app.db, req.params.id, req.params.refId, parsed.data);
      if (!reference) return reply.code(404).send(notFoundError('reference'));
      return { reference };
    },
  );

  app.delete<{ Params: { id: string; refId: string } }>(
    '/api/applicants/:id/references/:refId',
    async (req, reply) => {
      if (!svc.deleteReference(app.db, req.params.id, req.params.refId)) {
        return reply.code(404).send(notFoundError('reference'));
      }
      return { deleted: true };
    },
  );

  // --- field meta ---
  app.put<{ Params: { id: string } }>('/api/applicants/:id/field-meta', async (req, reply) => {
    const parsed = fieldMetaInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
    const fieldMeta = svc.upsertFieldMeta(app.db, req.params.id, parsed.data);
    if (!fieldMeta) return reply.code(404).send(notFoundError('applicant'));
    return { fieldMeta };
  });
}
