import type { DatabaseSync } from 'node:sqlite';
import type { OcrEngine } from './documents/ocrEngine.js';
import type { AutomationService } from './automation/automationService.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: DatabaseSync;
    ocr: OcrEngine;
    automation: AutomationService;
  }
}
