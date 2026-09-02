import type { FastifyInstance } from 'fastify';
import { activePortalSchema, portalInputSchema } from '../../shared/schemas.js';
import * as svc from '../services/portalService.js';
import { PortalDisabledError, PortalNotFoundError } from '../services/errors.js';
import { errorBody, notFoundError, validationError } from './errors.js';
import { runConnectionTest } from '../automation/discovery/testConnection.js';

export async function registerPortalRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/portals', async () => ({ portals: svc.listPortals(app.db) }));

  app.post('/api/portals', async (req, reply) => {
    const parsed = portalInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
    return reply.code(201).send({ portal: svc.createPortal(app.db, parsed.data) });
  });

  app.get<{ Params: { id: string } }>('/api/portals/:id', async (req, reply) => {
    const portal = svc.getPortal(app.db, req.params.id);
    if (!portal) return reply.code(404).send(notFoundError('portal'));
    return { portal };
  });

  app.put<{ Params: { id: string } }>('/api/portals/:id', async (req, reply) => {
    const parsed = portalInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
    const portal = svc.updatePortal(app.db, req.params.id, parsed.data);
    if (!portal) return reply.code(404).send(notFoundError('portal'));
    return { portal };
  });

  app.delete<{ Params: { id: string } }>('/api/portals/:id', async (req, reply) => {
    const removed = svc.deletePortal(app.db, req.params.id);
    if (!removed) return reply.code(404).send(notFoundError('portal'));
    return { deleted: true };
  });

  app.get('/api/settings/active-portal', async () => ({
    activePortalId: svc.getActivePortalId(app.db),
    portal: svc.getActivePortal(app.db),
  }));

  app.put('/api/settings/active-portal', async (req, reply) => {
    const parsed = activePortalSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
    try {
      svc.setActivePortal(app.db, parsed.data.portalId);
    } catch (err) {
      if (err instanceof PortalNotFoundError) {
        return reply.code(404).send(notFoundError('portal'));
      }
      if (err instanceof PortalDisabledError) {
        return reply
          .code(409)
          .send(errorBody('PORTAL_DISABLED', 'Cannot activate a disabled portal'));
      }
      throw err;
    }
    return {
      activePortalId: svc.getActivePortalId(app.db),
      portal: svc.getActivePortal(app.db),
    };
  });

  app.post<{ Params: { id: string } }>(
    '/api/portals/:id/test-connection',
    async (req, reply) => {
      const portal = svc.getPortal(app.db, req.params.id);
      if (!portal) return reply.code(404).send(notFoundError('portal'));
      const result = await runConnectionTest(portal.url); // URL sourced only from the DB row
      return { result };
    },
  );
}
