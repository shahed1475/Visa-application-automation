import { describe, expect, it } from 'vitest';
import type { MappingView } from '../../src/server/automation/adapters/india/indiaMappingRegistry.js';
import { renderFieldTablesMarkdown } from '../../src/server/automation/adapters/india/fieldTablesMarkdown.js';

const REV = '2026-09-07';

// Synthetic MappingView rows — one per lifecycle bucket, matching the real
// MappingView shape (canonicalFieldPath / label / selector / control / status /
// confidence / validatedAt? / discoverySessionRef? / notes?).
const mappings: MappingView[] = [
  {
    canonicalFieldPath: 'identity.surname',
    label: 'identity.surname',
    selector: '#x',
    control: 'text',
    status: 'validated',
    confidence: 'stable',
    validatedAt: '2026-09-08T00:00:00.000Z',
    discoverySessionRef: 'sess-1',
  },
  {
    canonicalFieldPath: 'identity.givenNames',
    label: 'identity.givenNames',
    selector: 'input[name="given"]',
    control: 'text',
    status: 'discovered',
    confidence: 'moderate',
    discoverySessionRef: 'sess-1',
  },
  {
    canonicalFieldPath: 'passport.number',
    label: 'passport.number',
    selector: 'TODO:discover',
    control: 'text',
    status: 'placeholder',
    confidence: 'fragile',
  },
];

const discoveryPages = [
  {
    state_guess: 'PASSPORT',
    candidates_json:
      '[{"primarySelector":"#x","control":"text","selectorConfidence":"stable"}]',
  },
];

const md = renderFieldTablesMarkdown({ mappings, mappingRevision: REV, discoveryPages });

describe('renderFieldTablesMarkdown', () => {
  it('emits three lifecycle sections', () => {
    expect(md).toMatch(/###\s+Validated/);
    expect(md).toMatch(/###\s+Discovered/);
    expect(md).toMatch(/###\s+Placeholder/);
  });

  it('the validated row shows a check mark and the current revision string', () => {
    const line = md.split('\n').find((l) => l.includes('identity.surname'));
    expect(line).toBeTruthy();
    expect(line).toContain('✓');
    expect(line).toContain(REV);
  });

  it('the placeholder row is marked TODO', () => {
    const line = md.split('\n').find((l) => l.includes('passport.number'));
    expect(line).toBeTruthy();
    expect(line).toMatch(/TODO/);
  });

  it('leaks no example value, option label or email address', () => {
    expect(md).not.toMatch(/example|e\.g\.|@/i);
  });

  it('has a row per mapping, keyed by canonicalFieldPath', () => {
    for (const m of mappings) {
      expect(md).toContain(m.canonicalFieldPath);
    }
  });

  it('resolves the portal state from a matching discovery candidate', () => {
    const line = md.split('\n').find((l) => l.includes('identity.surname'));
    expect(line).toContain('PASSPORT');
  });

  it('reports discovery candidate counts per state as a number only', () => {
    expect(md).toMatch(/PASSPORT:\s*1 candidate/);
    // the candidate selector value itself never appears in the counts summary
    expect(md.split('\n').filter((l) => l.includes('candidate')).join('\n')).not.toContain('#x');
  });
});
