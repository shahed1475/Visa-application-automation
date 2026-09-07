/**
 * Phase 4 §9.2 application routes. Thin translation layer over Task 13's
 * applicationService: Zod validation -> service call -> sanitized envelope.
 * No business logic here.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  applicationCreateSchema,
  applicationFieldValueSchema,
  applicationPutSchema,
} from '../../shared/application/schemas.js';
import * as svc from '../services/applicationService.js';
import { ApplicationServiceError } from '../services/applicationService.js';
import { errorBody, notFoundError, validationError } from './errors.js';

function mapApplicationError(e: unknown, reply: FastifyReply): FastifyReply | undefined {
  if (!(e instanceof ApplicationServiceError)) return undefined;
  switch (e.code) {
    case 'no_applicant':
      return reply.code(404).send(notFoundError('applicant'));
    case 'invalid_category':
      return reply.code(400).send(errorBody('INVALID_CATEGORY', e.message));
    case 'mode_mismatch':
      return reply.code(409).send(errorBody('MODE_MISMATCH', e.message));
    case 'invalid_field':
      return reply.code(400).send(errorBody('INVALID_FIELD', e.message));
    case 'not_found':
      return reply.code(404).send(notFoundError('application'));
    default: {
      const _exhaustive: never = e.code;
      return _exhaustive;
    }
  }
}

export async function registerApplicationRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string } }>('/api/applicants/:id/applications', async (req, reply) => {
    const parsed = applicationCreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
    try {
      const application = svc.createApplication(app.db, req.params.id, parsed.data);
      return reply.code(201).send({ application });
    } catch (e) {
      const mapped = mapApplicationError(e, reply);
      if (mapped) return mapped;
      throw e;
    }
  });

  app.get<{ Params: { id: string } }>('/api/applicants/:id/applications', async (req) => ({
    applications: svc.listApplications(app.db, req.params.id),
  }));

  app.get<{ Params: { id: string } }>('/api/applications/:id', async (req, reply) => {
    try {
      const result = svc.getApplication(app.db, req.params.id);
      if (!result) return reply.code(404).send(notFoundError('application'));
      return result;
    } catch (e) {
      const mapped = mapApplicationError(e, reply);
      if (mapped) return mapped;
      throw e;
    }
  });

  app.put<{ Params: { id: string } }>('/api/applications/:id', async (req, reply) => {
    const parsed = applicationPutSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
    try {
      const result = svc.updateApplication(app.db, req.params.id, parsed.data);
      if (!result) return reply.code(404).send(notFoundError('application'));
      return result;
    } catch (e) {
      const mapped = mapApplicationError(e, reply);
      if (mapped) return mapped;
      throw e;
    }
  });

  app.put<{ Params: { id: string } }>('/api/applications/:id/field-values', async (req, reply) => {
    const parsed = applicationFieldValueSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
    try {
      const result = svc.setApplicationFieldValue(app.db, req.params.id, parsed.data.fieldPath, {
        value: parsed.data.value,
        verified: parsed.data.verified,
      });
      if (!result) return reply.code(404).send(notFoundError('application'));
      return result;
    } catch (e) {
      const mapped = mapApplicationError(e, reply);
      if (mapped) return mapped;
      throw e;
    }
  });

  app.delete<{ Params: { id: string } }>('/api/applications/:id', async (req, reply) => {
    if (!svc.deleteApplication(app.db, req.params.id)) {
      return reply.code(404).send(notFoundError('application'));
    }
    return { deleted: true };
  });
}
