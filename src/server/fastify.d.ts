import type { DatabaseSync } from 'node:sqlite';
import type { OcrEngine } from './documents/ocrEngine.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: DatabaseSync;
    ocr: OcrEngine;
  }
}
