import Fastify, {
  type FastifyBaseLogger,
  type FastifyError,
  type FastifyInstance,
} from 'fastify';
import { logger } from './logger.js';
import { openDatabase } from './db/connection.js';
import { runMigrations } from './db/migrations.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerPortalRoutes } from './routes/portals.js';
import { errorBody } from './routes/errors.js';

export interface BuildServerOptions {
  dbPath: string;
}

export async function buildServer(
  opts: BuildServerOptions,
): Promise<FastifyInstance> {
  // fastify 5.12 / pino 9.14: a concrete pino instance passed as `loggerInstance`
  // narrows the server's logger generic and no longer matches `FastifyBaseLogger`
  // (pino's `BaseLogger` requires `msgPrefix`). Runtime behaviour is unchanged.
  const app = Fastify({ loggerInstance: logger as unknown as FastifyBaseLogger });
  const db = openDatabase(opts.dbPath);
  runMigrations(db);
  app.decorate('db', db);
  app.addHook('onClose', async () => {
    db.close();
  });
  await registerHealthRoutes(app);
  await registerPortalRoutes(app);

  app.setErrorHandler((err: FastifyError, req, reply) => {
    req.log.error({ err }, 'unhandled route error');
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    // Never leak internal detail to the client.
    reply.code(status).send(errorBody('INTERNAL', 'Internal server error'));
  });

  return app;
}
