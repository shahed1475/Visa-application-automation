import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

/**
 * Design §12 / §15 guard: the document-extraction + MRZ modules must never reach
 * the network and must never write `verified = 1`. This is a source-grep test —
 * comments are stripped first so provenance notes ("never a URL", "NO path that
 * writes verified = 1") do not trip it.
 */

const SCAN_DIRS = [
  path.join('src', 'server', 'documents'),
  path.join('src', 'shared', 'mrz'),
  path.join('src', 'shared', 'documents'),
];

const NETWORK_MODULES = ['node:http', 'node:https', 'http', 'https', 'undici', 'node-fetch', 'axios'];

const VERIFY_LITERALS = [
  'verified: 1',
  'verified:1',
  'verified: true',
  'verified:true',
  'verified = 1',
];

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

const files = SCAN_DIRS.flatMap(walk);
const scanned = `scanned ${files.length} files:\n${files.join('\n')}`;

it('scans a non-empty set of document/mrz source files', () => {
  expect(files.length, scanned).toBeGreaterThan(0);
});

it('never imports an http/https/fetch client', () => {
  for (const file of files) {
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const mod of NETWORK_MODULES) {
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
  }
});

it('never calls a bare fetch()', () => {
  for (const file of files) {
    const src = stripComments(readFileSync(file, 'utf8'));
    expect(src, `${file} must not call fetch()\n${scanned}`).not.toMatch(/\bfetch\s*\(/);
  }
});

it('contains no verified:1 / verified:true literal (never auto-verify)', () => {
  for (const file of files) {
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const literal of VERIFY_LITERALS) {
      expect(src, `${file} must not contain "${literal}"\n${scanned}`).not.toContain(literal);
    }
  }
});
