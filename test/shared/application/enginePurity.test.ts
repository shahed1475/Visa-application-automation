import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

/**
 * Design §2 / §11: the application-plan engine under `src/shared/application/` is a
 * PURE library. It must never import a runtime (`node:*`, `fastify`, `react`), never
 * reach into the server (`../server`), and never read process/import-meta env. This
 * is a source-grep guard — comments are stripped first so a doc-comment mentioning
 * `process.env` or `react` does not trip it. Mirrors `documentsNoNetwork.test.ts`.
 */

const SCAN_DIR = path.join('src', 'shared', 'application');

/** Bare module specifiers the engine must never depend on. */
const FORBIDDEN_MODULES = [
  'node:fs',
  'node:path',
  'node:crypto',
  'node:http',
  'node:https',
  'node:os',
  'node:child_process',
  'node:process',
  'fastify',
  'react',
  'react-dom',
  'react-router-dom',
  'better-sqlite3',
];

/** Any `node:`-prefixed import at all is forbidden (the list above is not exhaustive). */
const NODE_BUILTIN_IMPORT = /from\s+['"]node:[a-z/]+['"]|require\(\s*['"]node:[a-z/]+['"]\s*\)|import\(\s*['"]node:[a-z/]+['"]/;

/** Reaching up into the server tree from `src/shared/application/`. */
const SERVER_REACH = /from\s+['"](?:\.\.\/)+server\//;

const ENV_ACCESS = [/\bprocess\.env\b/, /\bimport\.meta\.env\b/];

function walk(dir: string): string[] {
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

const files = walk(SCAN_DIR);
const scanned = `scanned ${files.length} files:\n${files.join('\n')}`;

it('scans a non-empty set of engine source files', () => {
  expect(files.length, scanned).toBeGreaterThan(0);
});

it('never imports a Node builtin', () => {
  for (const file of files) {
    const src = stripComments(readFileSync(file, 'utf8'));
    expect(src, `${file} must not import any node: builtin\n${scanned}`).not.toMatch(
      NODE_BUILTIN_IMPORT,
    );
  }
});

it('never imports a runtime framework or the server tree', () => {
  for (const file of files) {
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const mod of FORBIDDEN_MODULES) {
      const esc = mod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(src, `${file} must not import '${mod}'\n${scanned}`).not.toMatch(
        new RegExp(`from ['"]${esc}['"]`),
      );
      expect(src, `${file} must not require('${mod}')\n${scanned}`).not.toMatch(
        new RegExp(`require\\(\\s*['"]${esc}['"]\\s*\\)`),
      );
      expect(src, `${file} must not dynamic import('${mod}')\n${scanned}`).not.toMatch(
        new RegExp(`import\\(\\s*['"]${esc}['"]`),
      );
    }
    expect(src, `${file} must not reach into ../server\n${scanned}`).not.toMatch(SERVER_REACH);
  }
});

it('never reads process.env / import.meta.env', () => {
  for (const file of files) {
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const re of ENV_ACCESS) {
      expect(src, `${file} must not reference ${re}\n${scanned}`).not.toMatch(re);
    }
  }
});
