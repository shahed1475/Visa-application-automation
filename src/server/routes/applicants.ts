import type { FastifyInstance } from 'fastify';
import {
  applicantCreateSchema,
  applicantPutSchema,
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
}
