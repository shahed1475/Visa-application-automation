import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

/**
 * Phase 5 architecture isolation (spec §3 / §5 / §11):
 *
 *  - `src/shared/automation/**` is PURE: portable types + pure helpers only. No
 *    Node built-ins, no Playwright, no Fastify, no React, no reach back into
 *    `src/server/**`. It must be importable from server, web and tests alike.
 *  - The engine run loop (`automationEngine.ts`) is adapter-agnostic: it depends
 *    only on the `PortalAdapter` *type* from `baseAdapter.js`. It must never
 *    import a concrete adapter (India or generic) by value.
 *  - India portal knowledge (category-id literals, portal URLs) lives ONLY under
 *    `src/server/automation/adapters/india/**`. Task 20 adds that directory and
 *    re-runs this guard; the path exclusion below is already in place so the
 *    guard keeps passing once it exists.
 *
 * Source-grep guard; comments are stripped first.
 */

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * URL-safe comment strip: removes block comments only. The normal `//` strip
 * truncates every `https://…` literal at the `//`, which would make the
 * portal-URL guard vacuous. A `//`-line-comment that itself names a portal host
 * is not a runnable URL, so leaving line comments in is acceptable here.
 */
function stripBlockCommentsOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '');
}

const SHARED_DIR = path.join('src', 'shared', 'automation');
const SERVER_DIR = path.join('src', 'server', 'automation');
const ENGINE_DIR = path.join(SERVER_DIR, 'engine');

it('src/shared/automation is pure', () => {
  const files = walk(SHARED_DIR);
  expect(files.length, `scanned ${files.length} files under ${SHARED_DIR}`).toBeGreaterThan(0);
  const banned: RegExp[] = [
    /from\s+['"]node:/,
    /from\s+['"]playwright['"]/,
    /from\s+['"]fastify['"]/,
    /from\s+['"]react/,
    /from\s+['"](\.\.\/)+server\//,
  ];
  for (const file of files) {
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const pattern of banned) {
      expect(src, `${file} matches ${pattern} — src/shared/automation must stay portable`).not.toMatch(
        pattern,
      );
    }
    expect(src, `${file} require()s a node: builtin — src/shared/automation must stay portable`).not.toMatch(
      /require\(\s*['"]node:/,
    );
  }
});

it('the engine loop imports no concrete adapter', () => {
  const src = stripComments(
    readFileSync(path.join(ENGINE_DIR, 'automationEngine.ts'), 'utf8'),
  );
  // A value import of a concrete adapter (indiaAdapter / genericAdapter) is
  // forbidden. `import type { PortalAdapter } from '../adapters/baseAdapter.js'`
  // is fine and expected.
  expect(src, 'automationEngine.ts imports from adapters/india/').not.toMatch(
    /from\s+['"].*adapters\/india\//,
  );
  expect(src, 'automationEngine.ts value-imports a concrete adapter').not.toMatch(
    /import\s+\{[^}]*\b(indiaAdapter|genericAdapter)\b[^}]*\}\s+from/,
  );
});

it('India portal knowledge lives only under adapters/india', () => {
  /** A KB category id in a string literal: `"evisa.…"` / `"regular.…"`. */
  const INDIA_LITERAL = /['"](evisa|regular)\.[a-z0-9_][a-z0-9_.]*['"]/;
  /** An embedded India portal URL: any http(s) URL whose host/path names a visa
   *  portal or an Indian-government host. Matched against block-comment-stripped
   *  source (see `stripBlockCommentsOnly` — the normal `//` strip eats `https://`). */
  const PORTAL_URL_LITERAL = /https?:\/\/[^'"\s)]*(?:visa|gov\.in|nic\.in)[^'"\s)]*/i;

  const indiaSegment = `${path.sep}india${path.sep}`;
  // Task 20 adds `src/server/automation/adapters/india/` and re-runs this guard;
  // that directory is excluded here already. `walk` tolerates it not existing yet.
  const files = walk(SERVER_DIR).filter((f) => !f.includes(indiaSegment));
  const scanned = `scanned ${files.length} files under ${SERVER_DIR} (excluding adapters/india)`;

  // Own non-emptiness guard: `walk` returns [] for a mistyped dir, which would
  // make this whole check pass vacuously.
  expect(files.length, scanned).toBeGreaterThan(5);

  for (const file of files) {
    const raw = readFileSync(file, 'utf8');
    const cat = stripComments(raw).match(INDIA_LITERAL);
    expect(
      cat,
      `${file} hard-codes a KB category id ${cat ? `(${cat[0]})` : ''} — ` +
        `India knowledge belongs under adapters/india/.\n${scanned}`,
    ).toBeNull();
    const url = stripBlockCommentsOnly(raw).match(PORTAL_URL_LITERAL);
    expect(
      url,
      `${file} embeds a portal URL literal ${url ? `(${url[0]})` : ''} — ` +
        `the portal URL comes from settings; India knowledge belongs under adapters/india/.\n${scanned}`,
    ).toBeNull();
  }
});

it('the portal-URL guard is non-vacuous', () => {
  const URL_PATTERN = /https?:\/\/[^'"\s)]*(?:visa|gov\.in|nic\.in)[^'"\s)]*/i;
  expect(URL_PATTERN.test("const u = 'https://indianvisaonline.gov.in/apply'")).toBe(true);
  expect(URL_PATTERN.test("await page.goto('https://www.visa.gov.in/step1')")).toBe(true);
  // a benign third-party URL must NOT trip it
  expect(URL_PATTERN.test("import x from 'https://example.com/thing'")).toBe(false);
});

it('has a non-empty engine scan set', () => {
  const names = walk(ENGINE_DIR).map((f) => path.basename(f));
  for (const expected of [
    'automationEngine.ts',
    'pageActions.ts',
    'pageDetector.ts',
    'checkpointDetector.ts',
    'fieldActions.ts',
  ]) {
    expect(names, `engine dir walk found: ${names.join(', ')}`).toContain(expected);
  }
});
