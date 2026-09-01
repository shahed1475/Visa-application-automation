import type { DatabaseSync } from 'node:sqlite';

declare module 'fastify' {
  interface FastifyInstance {
    db: DatabaseSync;
  }
}
