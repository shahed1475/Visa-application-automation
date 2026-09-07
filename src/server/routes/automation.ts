/**
 * Phase 5 §14 automation routes. Thin translation layer over Task 12's
 * AutomationService (`app.automation`): Zod validation -> service call ->
 * sanitized envelope. No business logic here. Raw field values never appear in
 * any response — `getLive` returns only the in-memory `mismatches[]`.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  AnotherRunActiveError,
  ApplicationNotFoundError,
  CheckpointStillPresentError,
  ConflictDecisionRequiredError,
  NoActivePortalError,
  NotReadyError,
  NotWaitingError,
  RunInProgressError,
  RunNotFoundError,
  ToSNotAcknowledgedError,
} from '../automation/automationService.js';
import { errorBody, notFoundError, validationError } from './errors.js';

const idParamSchema = z.object({ id: z.string().min(1) });
const eventsQuerySchema = z.object({
  after: z.coerce.number().int().min(0).optional(),
});
// A body-less resume POST is legitimate (checkpoint / value_mismatch waits carry
// no decision) — parse `req.body ?? {}` so an absent body is valid, not a 400.
const resumeBodySchema = z.object({
  decision: z.enum(['use_application', 'keep_portal']).optional(),
});

function mapAutomationError(e: unknown, reply: FastifyReply): FastifyReply | undefined {
  if (e instanceof ApplicationNotFoundError) {
    return reply.code(404).send(notFoundError('application'));
  }
  if (e instanceof NotReadyError) {
    return reply
      .code(409)
      .send({
        ...errorBody('NOT_READY', 'this application is not ready for automation'),
        blockers: e.blockers,
      });
  }
  if (e instanceof RunInProgressError) {
    return reply
      .code(409)
      .send(errorBody('RUN_IN_PROGRESS', 'a run is already in progress for this application'));
  }
  if (e instanceof AnotherRunActiveError) {
    return reply
      .code(409)
      .send(errorBody('ANOTHER_RUN_ACTIVE', 'an automation run is active for another application'));
  }
  if (e instanceof NoActivePortalError) {
    return reply
      .code(409)
      .send(errorBody('NO_ACTIVE_PORTAL', 'configure a portal in Settings before starting automation'));
  }
  if (e instanceof ToSNotAcknowledgedError) {
    return reply
      .code(409)
      .send(
        errorBody(
          'TOS_NOT_ACKNOWLEDGED',
          'acknowledge the portal Terms of Service before starting automation',
        ),
      );
  }
  if (e instanceof RunNotFoundError) {
    return reply.code(404).send(notFoundError('automation run'));
  }
  if (e instanceof NotWaitingError) {
    return reply.code(409).send(errorBody('NOT_WAITING', 'the run is not waiting for user action'));
  }
  if (e instanceof CheckpointStillPresentError) {
    return reply
      .code(409)
      .send(
        errorBody(
          'CHECKPOINT_STILL_PRESENT',
          'the challenge is still on the page — complete it, then resume',
        ),
      );
  }
  if (e instanceof ConflictDecisionRequiredError) {
    return reply
      .code(400)
      .send(
        errorBody(
          'DECISION_REQUIRED',
          'this run is paused on a value conflict — resume with a decision',
        ),
      );
  }
  return undefined;
}

export async function registerAutomationRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string } }>(
    '/api/applications/:id/automation-runs',
    async (req, reply) => {
      const parsed = idParamSchema.safeParse(req.params);
      if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
      try {
        const run = await app.automation.startRun(app.db, parsed.data.id);
        return reply.code(201).send({ run });
      } catch (e) {
        const mapped = mapAutomationError(e, reply);
        if (mapped) return mapped;
        throw e;
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/applications/:id/automation-runs',
    async (req) => ({
      runs: app.automation.listRunsForApplication(app.db, req.params.id),
    }),
  );

  app.get<{ Params: { id: string } }>('/api/automation-runs/:id', async (req, reply) => {
    const result = app.automation.getRun(app.db, req.params.id);
    if (!result) return reply.code(404).send(notFoundError('automation run'));
    return result;
  });

  app.get<{ Params: { id: string } }>(
    '/api/automation-runs/:id/events',
    async (req, reply) => {
      const parsed = eventsQuerySchema.safeParse(req.query);
      if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
      const result = app.automation.getRun(app.db, req.params.id);
      if (!result) return reply.code(404).send(notFoundError('automation run'));
      return { events: app.automation.listEvents(app.db, req.params.id, parsed.data.after) };
    },
  );

  app.get<{ Params: { id: string } }>('/api/automation-runs/:id/live', async (req, reply) => {
    const live = app.automation.getLive(req.params.id);
    if (!live) {
      return reply
        .code(409)
        .send(errorBody('NOT_ACTIVE', 'this run is not currently loaded in memory'));
    }
    return live;
  });

  app.post<{ Params: { id: string } }>(
    '/api/automation-runs/:id/resume',
    async (req, reply) => {
      const parsed = resumeBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
      try {
        const run = await app.automation.resumeRun(app.db, req.params.id, parsed.data.decision);
        return reply.code(202).send({ run });
      } catch (e) {
        const mapped = mapAutomationError(e, reply);
        if (mapped) return mapped;
        throw e;
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/automation-runs/:id/abort',
    async (req, reply) => {
      try {
        const run = await app.automation.abortRun(app.db, req.params.id);
        return reply.code(202).send({ run });
      } catch (e) {
        const mapped = mapAutomationError(e, reply);
        if (mapped) return mapped;
        throw e;
      }
    },
  );
}
