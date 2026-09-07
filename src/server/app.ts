import path from 'node:path';
import { existsSync } from 'node:fs';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyError,
  type FastifyInstance,
} from 'fastify';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { env } from './env.js';
import { logger } from './logger.js';
import { openDatabase } from './db/connection.js';
import { runMigrations } from './db/migrations.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerPortalRoutes } from './routes/portals.js';
import { registerApplicantRoutes } from './routes/applicants.js';
import { registerApplicationRoutes } from './routes/applications.js';
import { registerAutomationRoutes } from './routes/automation.js';
import { registerDiscoveryRoutes } from './routes/discovery.js';
import { registerDocumentRoutes } from './routes/documents.js';
import { errorBody, notFoundError } from './routes/errors.js';
import { createTesseractEngine } from './documents/tesseractEngine.js';
import { MAX_DOCUMENT_BYTES } from './documents/fileType.js';
import type { OcrEngine } from './documents/ocrEngine.js';
import { AutomationService } from './automation/automationService.js';
import { DiscoveryController } from './automation/discovery/discoveryController.js';

export interface BuildServerOptions {
  dbPath: string;
  /** Test seam: swap the shared pino instance (e.g. for one writing to a capture
   *  stream, so log output can be asserted on). Production always uses `logger`. */
  loggerInstance?: FastifyBaseLogger;
  /** Test seam: swap the OCR engine. Production uses a real tesseract.js engine. */
  ocr?: OcrEngine;
  /** Test seam: swap the automation service. Production uses a real one. */
  automation?: AutomationService;
  /** Test seam: swap the discovery controller. Production uses a real one. */
  discovery?: DiscoveryController;
}

export async function buildServer(
  opts: BuildServerOptions,
): Promise<FastifyInstance> {
  // fastify 5.12 / pino 9.14: a concrete pino instance passed as `loggerInstance`
  // narrows the server's logger generic and no longer matches `FastifyBaseLogger`
  // (pino's `BaseLogger` requires `msgPrefix`). Runtime behaviour is unchanged.
  const app = Fastify({
    loggerInstance: opts.loggerInstance ?? (logger as unknown as FastifyBaseLogger),
  });

  // JSON body parser that never throws a raw framework error at the client.
  // The stock parser throws FST_ERR_CTP_EMPTY_JSON_BODY / _INVALID_JSON_BODY,
  // which bypass the sanitizer below and leak Fastify internals. A missing or
  // unparseable payload becomes "no body" here, so route-level Zod validation
  // produces the normal sanitized VALIDATION_ERROR envelope. (A body-less
  // POST /portals/:id/test-connection is legitimate and must succeed.)
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => {
      const text = typeof body === 'string' ? body.trim() : '';
      if (text.length === 0) {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(text));
      } catch {
        done(null, undefined);
      }
    },
  );

  const db = openDatabase(opts.dbPath);
  runMigrations(db);
  app.decorate('db', db);
  app.addHook('onClose', async () => {
    db.close();
  });

  const ocr = opts.ocr ?? createTesseractEngine();
  app.decorate('ocr', ocr);
  app.addHook('onClose', async () => {
    await ocr.dispose().catch(() => undefined);
  });

  await registerHealthRoutes(app);
  await registerPortalRoutes(app);
  await registerApplicantRoutes(app);
  await registerApplicationRoutes(app);

  const automation = opts.automation ?? new AutomationService();
  app.decorate('automation', automation);
  app.addHook('onClose', async () => {
    await automation.dispose().catch(() => undefined);
  });
  await registerAutomationRoutes(app);

  const discovery = opts.discovery ?? new DiscoveryController();
  app.decorate('discovery', discovery);
  app.addHook('onClose', async () => {
    await discovery.dispose().catch(() => undefined);
  });
  await registerDiscoveryRoutes(app);

  await app.register(multipart, {
    // Signal an oversize file via `file.truncated` (→ route returns a sanitized
    // 400) rather than letting the plugin throw its own 413.
    throwFileSizeLimit: false,
    limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1, fields: 4 },
  });
  await registerDocumentRoutes(app);

  if (env.NODE_ENV === 'production') {
    // Serve the built React app from Fastify — no Vite dev server in production.
    const webRoot = path.resolve('dist/web');
    const indexPath = path.join(webRoot, 'index.html');
    if (!existsSync(indexPath)) {
      throw new Error(
        `Production build not found at ${webRoot}. Run "npm run build" before "npm start".`,
      );
    }
    // wildcard:false so unmatched non-/api paths fall through to the SPA fallback
    // below instead of a @fastify/static 404.
    await app.register(fastifyStatic, { root: webRoot, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api')) {
        return reply.code(404).send(notFoundError('route'));
      }
      return reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((_req, reply) =>
      reply.code(404).send(notFoundError('route')),
    );
  }

  app.setErrorHandler((err: FastifyError, req, reply) => {
    req.log.error({ err }, 'unhandled route error');
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    // Never leak internal detail to the client.
    reply.code(status).send(errorBody('INTERNAL', 'Internal server error'));
  });

  return app;
}
