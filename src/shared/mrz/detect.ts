import type { DetectedMrz, OcrLine } from './types.js';

const clean = (s: string) => s.toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9<]/g, '');
const looksLikeMrz = (s: string) => {
  const c = clean(s);
  return c.length >= 40 && c.length <= 46 && /^[A-Z0-9<]+$/.test(c) && (c.match(/</g)?.length ?? 0) >= 3;
};

export function detectMrzLines(lines: OcrLine[]): DetectedMrz | null {
  for (let i = 0; i < lines.length - 1; i += 1) {
    const a = lines[i]!, b = lines[i + 1]!;
    if (looksLikeMrz(a.text) && looksLikeMrz(b.text)) {
      const pad = (s: string) => (clean(s) + '<'.repeat(44)).slice(0, 44);
      return {
        line1: pad(a.text),
        line2: pad(b.text),
        lineConfidence: (a.confidence + b.confidence) / 2,
      };
    }
  }
  return null;
}
