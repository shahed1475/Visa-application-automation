import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

const DISCOVERY_DIR = 'src/server/automation/discovery';

/** Every `.ts` under `discovery/` (recursive) so a NEW module added during
 *  Track B cannot silently escape the read-only guard. */
function discoveryFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...discoveryFiles(full));
    else if (entry.name.endsWith('.ts')) out.push(full.split(path.sep).join('/'));
  }
  return out;
}

const CONTROLLER = `${DISCOVERY_DIR}/discoveryController.ts`;
const FILES = [
  ...discoveryFiles(DISCOVERY_DIR),
  // The adapter self-diagnostic runs against the same live discovery page and
  // must be equally read-only (spec §7.4 / global constraint).
  'src/server/automation/adapters/india/validateAdapter.ts',
];
const strip = (s: string) => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
// page-mutating APIs a read-only discovery module must never call
const FORBIDDEN = [
  /\.fill\s*\(/, /\.click\s*\(/, /\.type\s*\(/, /\.press\s*\(/, /\.check\s*\(/, /\.uncheck\s*\(/,
  /\.selectOption\s*\(/, /\.setInputFiles\s*\(/, /\.hover\s*\(/, /\.dragTo\s*\(/,
  /form\s*=>\s*form\.submit\(\)/, /\.tap\s*\(/, /keyboard\./, /mouse\./,
];

it('the discovery modules contain no page-mutating call', () => {
  // Guard against an empty walk (a bad DISCOVERY_DIR would make this vacuous).
  expect(FILES.length).toBeGreaterThan(3);
  expect(FILES).toContain(CONTROLLER);
  for (const f of FILES) {
    const src = strip(readFileSync(f, 'utf8'));
    for (const re of FORBIDDEN) expect(src, `${f} matches ${re}`).not.toMatch(re);
  }
});

it('discoveryController has at most ONE page.goto and it targets only the resolved portal URL', () => {
  const src = strip(readFileSync(CONTROLLER, 'utf8'));
  const gotos = src.match(/\.goto\s*\(/g) ?? [];
  expect(gotos.length).toBeLessThanOrEqual(1);
  if (gotos.length === 1) expect(src).toMatch(/\.goto\(\s*portal(Url)?\b/); // the URL argument, not a literal
});

it('the guard is non-vacuous', () => {
  const strip1 = strip("await page.fill('#x','y')");
  expect(/\.fill\s*\(/.test(strip1)).toBe(true);
});
