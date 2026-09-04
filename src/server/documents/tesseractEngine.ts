/**
 * The one real `OcrEngine` (spec §6): tesseract.js WASM, language `eng`,
 * running **fully offline**.
 *
 * Every resource is a local filesystem path — never a URL, never the network:
 *  - the language model is the vendored `vendor/tessdata/eng.traineddata`
 *    (`tessdata_fast`), resolved relative to this file;
 *  - the WASM core and the worker script are resolved out of `node_modules`.
 *
 * The worker is created lazily on the first `recognize()` call and reused for
 * every call after; `dispose()` terminates it. The tessdata cache lives under
 * the OS temp dir, so a test run never dirties the working tree.
 *
 * `recognize()` never puts image bytes (or paths) into a thrown error — a
 * failure surfaces as a bare `Error('OCR failed')`, which the extraction
 * pipeline (Task 12) maps to `ExtractionError('unreadable')`.
 */
import { createRequire } from 'node:module';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createWorker, PSM, type Worker } from 'tesseract.js';
import type { OcrEngine, OcrResult } from './ocrEngine.js';

const require = createRequire(import.meta.url);

// tesseract.js version, read from its own package manifest (not hard-coded).
const { version: TESSERACT_VERSION } = require('tesseract.js/package.json') as {
  version: string;
};

/** Library version + model source, for `engine_detail` provenance. */
export const ENGINE_DETAIL = `tesseract.js@${TESSERACT_VERSION} / eng (tessdata_fast)`;

// WASM core dir (local node_modules) — a directory, not a file, not a URL.
const CORE_PATH = dirname(
  require.resolve('tesseract.js-core/tesseract-core-simd.wasm.js'),
);

// Worker script (local node_modules file). Prefer the readable source entry,
// fall back to the bundled build if the package layout differs.
let WORKER_PATH: string;
try {
  WORKER_PATH = require.resolve('tesseract.js/src/worker-script/node/index.js');
} catch {
  WORKER_PATH = require.resolve('tesseract.js/dist/worker.min.js');
}

// From src/server/documents/ the repo root is three levels up.
const DEFAULT_LANG_PATH = fileURLToPath(
  new URL('../../../vendor/tessdata/', import.meta.url),
);

// Cache the compiled model outside the repo so `git status` stays clean.
const CACHE_PATH = join(tmpdir(), 'visa-autofill-tessdata-cache');

function assertTraineddataDir(langPath: string): void {
  try {
    if (statSync(join(langPath, 'eng.traineddata')).isFile()) return;
  } catch {
    /* fall through to the throw below */
  }
  throw new Error(
    `tesseract eng.traineddata not found under langPath: ${langPath}`,
  );
}

export function createTesseractEngine(opts?: { langPath?: string }): OcrEngine {
  const langPath = opts?.langPath ?? DEFAULT_LANG_PATH;
  let workerPromise: Promise<Worker> | undefined;

  function getWorker(): Promise<Worker> {
    if (!workerPromise) {
      workerPromise = (async () => {
        assertTraineddataDir(langPath);
        const worker = await createWorker('eng', 1, {
          langPath, // local dir holding eng.traineddata — NOT a URL
          cachePath: CACHE_PATH, // OS temp, NOT the repo
          gzip: false, // the vendored file is uncompressed
          corePath: CORE_PATH, // local node_modules dir — NOT a URL
          workerPath: WORKER_PATH, // local node_modules file
          logger: () => {}, // silence progress chatter
        });
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
        return worker;
      })();
    }
    return workerPromise;
  }

  return {
    async recognize(image: Uint8Array): Promise<OcrResult> {
      const worker = await getWorker();
      let data;
      try {
        ({ data } = await worker.recognize(Buffer.from(image)));
      } catch {
        throw new Error('OCR failed');
      }
      return {
        text: data.text,
        lines: data.lines.map((l) => ({
          text: l.text.trim(),
          confidence: l.confidence,
        })),
        meanConfidence: data.confidence,
      };
    },

    async dispose(): Promise<void> {
      if (!workerPromise) return;
      const worker = await workerPromise;
      workerPromise = undefined;
      await worker.terminate();
    },
  };
}
