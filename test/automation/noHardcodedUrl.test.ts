import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

it('automation engine contains no hard-coded http(s) URL literal', () => {
  const files = walk(path.join('src', 'server', 'automation'));
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const src = readFileSync(file, 'utf8')
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src, `${file} must not embed a URL literal`).not.toMatch(
      /https?:\/\/[^\s'"`]+/,
    );
  }
});

it('no source file outside docs/tests references a known government visa host', () => {
  const roots = ['src'];
  const banned = /indianvisaonline|\bvisa[a-z0-9.-]*\.gov\b/i;
  for (const root of roots) {
    for (const file of walk(root)) {
      const src = readFileSync(file, 'utf8');
      expect(src, `${file} must not name a specific gov visa host`).not.toMatch(banned);
    }
  }
});
