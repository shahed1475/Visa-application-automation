/**
 * Phase 6 §5.4 discovery routes. Thin translation layer over Task 5's
 * DiscoveryController (`app.discovery`) and Task 2's discoverySessionStore:
 * Zod validation -> controller/store call -> sanitized envelope. No business
 * logic and no DB SQL here. The store rows are already value-free structure;
 * these handlers add nothing to them.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  DiscoverySessionActiveError,
  DiscoverySessionNotActiveError,
  DiscoverySessionNotFoundError,
} from '../automation/discovery/discoveryController.js';
import { ToSNotAcknowledgedError, recordPolicyAck } from '../automation/discovery/policyGate.js';
import { NoActivePortalError } from '../automation/automationService.js';
import {
  DiscoveryCandidateNotFoundError,
  getIndiaMappingStatus,
  getIndiaMappings,
  promoteCandidate,
  renderPromotedBundle,
} from '../automation/adapters/india/indiaMappingRegistry.js';
import { getIndiaDiagnostics } from '../automation/adapters/india/diagnostics.js';
import { renderFieldTablesMarkdown } from '../automation/adapters/india/fieldTablesMarkdown.js';
import { indiaPortalMap } from '../automation/adapters/india/indiaPortalMap.js';
import { PortalNotFoundError } from '../services/errors.js';
import { getPortal } from '../services/portalService.js';
import { validateIndiaAdapter } from '../automation/adapters/india/validateAdapter.js';
import {
  getDiscoverySession,
  listDiscoveryPages,
  listDiscoverySessions,
  updateDiscoverySession,
} from '../automation/discovery/discoverySessionStore.js';
import { errorBody, notFoundError, validationError } from './errors.js';

const idParamSchema = z.object({ id: z.string().min(1) });

const promoteBodySchema = z.object({
  pageSeq: z.number().int().positive(),
  candidateIndex: z.number().int().nonnegative(),
  canonicalFieldPath: z.string().min(1),
});

const promoteBundleBodySchema = z.object({
  picks: z.array(promoteBodySchema).min(1),
});

function mapDiscoveryError(e: unknown, reply: FastifyReply): FastifyReply | undefined {
  if (e instanceof DiscoverySessionActiveError) {
    return reply
      .code(409)
      .send(errorBody('SESSION_ACTIVE', 'a discovery session is already active for this portal'));
  }
  if (e instanceof ToSNotAcknowledgedError) {
    return reply
      .code(409)
      .send(
        errorBody(
          'TOS_NOT_ACKNOWLEDGED',
          'acknowledge the portal Terms of Service before starting discovery',
        ),
      );
  }
  if (e instanceof NoActivePortalError) {
    return reply
      .code(409)
      .send(errorBody('NO_ACTIVE_PORTAL', 'configure a portal in Settings before starting discovery'));
  }
  if (e instanceof DiscoverySessionNotActiveError) {
    return reply.code(409).send(errorBody('SESSION_NOT_ACTIVE', 'this discovery session is not active'));
  }
  if (e instanceof DiscoverySessionNotFoundError) {
    return reply.code(404).send(notFoundError('discovery session'));
  }
  if (e instanceof DiscoveryCandidateNotFoundError) {
    return reply.code(404).send(notFoundError('discovery candidate'));
  }
  if (e instanceof PortalNotFoundError) {
    return reply.code(404).send(notFoundError('portal'));
  }
  return undefined;
}

export async function registerDiscoveryRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string } }>(
    '/api/portals/:id/discovery-sessions',
    async (req, reply) => {
      const parsed = idParamSchema.safeParse(req.params);
      if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
      if (!getPortal(app.db, parsed.data.id)) {
        return reply.code(404).send(notFoundError('portal'));
      }
      try {
        const session = await app.discovery.start(app.db, parsed.data.id);
        return reply.code(201).send({ session });
      } catch (e) {
        const mapped = mapDiscoveryError(e, reply);
        if (mapped) return mapped;
        throw e;
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/portals/:id/discovery-sessions',
    async (req) => ({
      sessions: listDiscoverySessions(app.db, { portalId: req.params.id }),
    }),
  );

  app.get<{ Params: { id: string } }>('/api/discovery-sessions/:id', async (req, reply) => {
    const session = getDiscoverySession(app.db, req.params.id);
    if (!session) return reply.code(404).send(notFoundError('discovery session'));
    return { session, pages: listDiscoveryPages(app.db, req.params.id) };
  });

  app.post<{ Params: { id: string } }>(
    '/api/discovery-sessions/:id/capture',
    async (req, reply) => {
      const parsed = idParamSchema.safeParse(req.params);
      if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
      try {
        const page = await app.discovery.capture(app.db, parsed.data.id);
        return reply.code(201).send({ page });
      } catch (e) {
        const mapped = mapDiscoveryError(e, reply);
        if (mapped) return mapped;
        throw e;
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/discovery-sessions/:id/end',
    async (req, reply) => {
      try {
        const session = await app.discovery.end(app.db, req.params.id);
        return reply.code(202).send({ session });
      } catch (e) {
        const mapped = mapDiscoveryError(e, reply);
        if (mapped) return mapped;
        throw e;
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/discovery-sessions/:id/abort',
    async (req, reply) => {
      try {
        const session = await app.discovery.abort(app.db, req.params.id);
        return reply.code(202).send({ session });
      } catch (e) {
        const mapped = mapDiscoveryError(e, reply);
        if (mapped) return mapped;
        throw e;
      }
    },
  );

  // Adapter-mappings read model (Phase 6 §7.3). Value-free view of the India
  // canonical→portal mapping table plus its lifecycle status counts. The map is
  // adapter-level, not portal-specific — `:id` is accepted for URL symmetry with
  // the other portal routes but does not scope the result.
  app.get('/api/portals/:id/adapter-mappings', async () => ({
    mappings: getIndiaMappings(),
    status: getIndiaMappingStatus(),
  }));

  // Adapter self-diagnostics assembly (Phase 6 §7.4 / §13.21). Value-free health
  // snapshot of the India adapter — contract version, discovery progress, mapping
  // lifecycle counts, unknown-page tally, last adapter-validation outcome. Lenient
  // GET like `/adapter-mappings`: `:id` is accepted for URL symmetry but the
  // result is adapter-level, so there is no 404 on an unknown portal id. The SQL
  // lives in `diagnostics.ts`, not here.
  app.get<{ Params: { id: string } }>(
    '/api/portals/:id/adapter-diagnostics',
    async (req) => ({ diagnostics: getIndiaDiagnostics(app.db, req.params.id) }),
  );

  // Promote a discovered selector candidate to a paste-ready indiaPortalMap.ts
  // edit (§13.12). Returns a TS string for a human to review and paste — the app
  // never writes adapter source.
  app.post<{ Params: { id: string } }>(
    '/api/discovery-sessions/:id/promote',
    async (req, reply) => {
      const parsedParams = idParamSchema.safeParse(req.params);
      if (!parsedParams.success) return reply.code(400).send(validationError(parsedParams.error));
      const parsedBody = promoteBodySchema.safeParse(req.body);
      if (!parsedBody.success) return reply.code(400).send(validationError(parsedBody.error));
      try {
        const mappingEdit = promoteCandidate(app.db, parsedParams.data.id, parsedBody.data);
        return reply.send({ mappingEdit });
      } catch (e) {
        const mapped = mapDiscoveryError(e, reply);
        if (mapped) return mapped;
        throw e;
      }
    },
  );

  // Promote several discovered candidates in one shot — the operator's "copy all
  // promoted" action. Same rules as `/promote`: returns a TS string to review and
  // paste, writes no source. (§13.12)
  app.post<{ Params: { id: string } }>(
    '/api/discovery-sessions/:id/promote-bundle',
    async (req, reply) => {
      const parsedParams = idParamSchema.safeParse(req.params);
      if (!parsedParams.success) return reply.code(400).send(validationError(parsedParams.error));
      const parsedBody = promoteBundleBodySchema.safeParse(req.body);
      if (!parsedBody.success) return reply.code(400).send(validationError(parsedBody.error));
      try {
        const bundle = renderPromotedBundle(app.db, parsedParams.data.id, parsedBody.data.picks);
        return reply.send({ bundle });
      } catch (e) {
        const mapped = mapDiscoveryError(e, reply);
        if (mapped) return mapped;
        throw e;
      }
    },
  );

  // Render the docs/portals/india.md "Field support tables" from persisted
  // discovery (`portal_discovery_pages`) + the live `indiaPortalMap` — the
  // operator pastes the markdown instead of transcribing it (Phase 8 §11). The
  // formatter is pure and value-free; the DB reads live here. Adapter-level
  // result, but scoped to a session for its captured pages, so a 404 guard.
  app.get<{ Params: { id: string } }>(
    '/api/discovery-sessions/:id/field-tables',
    async (req, reply) => {
      const parsed = idParamSchema.safeParse(req.params);
      if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
      if (!getDiscoverySession(app.db, parsed.data.id)) {
        return reply.code(404).send(notFoundError('discovery session'));
      }
      const markdown = renderFieldTablesMarkdown({
        mappings: getIndiaMappings(),
        mappingRevision: indiaPortalMap.mappingRevision,
        discoveryPages: listDiscoveryPages(app.db, parsed.data.id).map((p) => ({
          state_guess: p.state_guess,
          candidates_json: p.candidates_json,
        })),
      });
      return { markdown };
    },
  );

  // Adapter self-diagnostics (Phase 6 §7.4). Runs `validateIndiaAdapter` against
  // the live discovery page: every non-placeholder mapping resolves to exactly
  // one node of a matching control kind, every state's `nextSelector` resolves.
  // The report is value-free (option labels pass the §5.3 sanitizer) and is
  // persisted to `portal_discovery_sessions.last_validation_json`.
  app.post<{ Params: { id: string } }>(
    '/api/discovery-sessions/:id/validate-adapter',
    async (req, reply) => {
      const parsed = idParamSchema.safeParse(req.params);
      if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
      try {
        const session = getDiscoverySession(app.db, parsed.data.id);
        if (!session) throw new DiscoverySessionNotFoundError(parsed.data.id);
        if (session.status !== 'active') {
          throw new DiscoverySessionNotActiveError(parsed.data.id);
        }
        const page = app.discovery.activePage;
        if (!page) throw new DiscoverySessionNotActiveError(parsed.data.id);

        const report = await validateIndiaAdapter(page);
        updateDiscoverySession(
          app.db,
          parsed.data.id,
          { last_validation_json: JSON.stringify(report) },
          new Date().toISOString(),
        );
        return reply.send({ report });
      } catch (e) {
        const mapped = mapDiscoveryError(e, reply);
        if (mapped) return mapped;
        throw e;
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/portals/:id/policy-ack',
    async (req, reply) => {
      const parsed = idParamSchema.safeParse(req.params);
      if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
      if (!getPortal(app.db, parsed.data.id)) {
        return reply.code(404).send(notFoundError('portal'));
      }
      return { status: recordPolicyAck(app.db, parsed.data.id) };
    },
  );
}
