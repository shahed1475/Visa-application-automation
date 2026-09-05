import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

/**
 * Design §3 / §11.7: India-specific visa rules live ONLY in the knowledge base
 * (`src/shared/visa-kb/**` data + schema). The engine, the service, the REST layer,
 * and the dashboard UI must be category-agnostic — no hard-coded KB category-id
 * string literal (`'evisa.tourist.30d'`, `'regular.business'`, …) anywhere in them.
 * Everything a consumer needs is already on the `ApplicationPlan`.
 *
 * Source-grep guard; comments are stripped first so a doc-comment example like
 * "e.g. regular.business" does not trip it.
 */

/** A KB category id in a string literal: `"evisa.…"` / `"regular.…"`. */
const CATEGORY_LITERAL = /['"](evisa|regular)\.[a-z0-9_][a-z0-9_.]*['"]/;

const SCAN_DIRS_TS = [path.join('src', 'shared', 'application')];
const SCAN_FILES = [
  path.join('src', 'server', 'services', 'applicationService.ts'),
  path.join('src', 'server', 'routes', 'applications.ts'),
];
const SCAN_DIRS_TSX = [path.join('src', 'web', 'src', 'pages', 'Applications')];

function walk(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, ext));
    else if (full.endsWith(ext)) out.push(full);
  }
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

const files = [
  ...SCAN_DIRS_TS.flatMap((d) => walk(d, '.ts')),
  ...SCAN_FILES.filter((f) => existsSync(f)),
  ...SCAN_DIRS_TSX.flatMap((d) => walk(d, '.tsx')),
];
const scanned = `scanned ${files.length} files:\n${files.join('\n')}`;

it('scans the engine, service, routes, and dashboard files', () => {
  // engine dir + the 2 named server files + the Applications page dir
  expect(files.length, scanned).toBeGreaterThanOrEqual(10);
  expect(files, scanned).toContain(
    path.join('src', 'server', 'services', 'applicationService.ts'),
  );
  expect(files, scanned).toContain(path.join('src', 'server', 'routes', 'applications.ts'));
});

it('contains no hard-coded KB category-id literal', () => {
  for (const file of files) {
    const src = stripComments(readFileSync(file, 'utf8'));
    const match = src.match(CATEGORY_LITERAL);
    expect(
      match,
      `${file} hard-codes a KB category id ${match ? `(${match[0]})` : ''} — ` +
        `India rules belong in src/shared/visa-kb/, and consumers read plan.* instead.\n${scanned}`,
    ).toBeNull();
  }
});
