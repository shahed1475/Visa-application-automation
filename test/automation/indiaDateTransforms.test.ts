import { describe, expect, it } from 'vitest';
import {
  DateFormatError,
  isoToDMY,
  isoToDdMonYyyy,
  isoToMDY,
  isoToYMD,
  parseDMY,
  parseDdMonYyyy,
  parseIso,
  parseMDY,
  parseYMD,
} from '../../src/server/automation/adapters/india/transforms.js';

const ISO = '2026-10-15';

describe('forward transforms (ISO -> portal string)', () => {
  it('render the documented shapes', () => {
    expect(isoToDMY(ISO)).toBe('15/10/2026');
    expect(isoToMDY(ISO)).toBe('10/15/2026');
    expect(isoToYMD(ISO)).toBe('2026/10/15');
    expect(isoToDdMonYyyy(ISO)).toBe('15 Oct 2026');
  });

  it('reject non-ISO input (no guessing)', () => {
    expect(() => isoToDMY('15/10/2026')).toThrow(DateFormatError);
    expect(() => isoToDMY('2026-13-01')).toThrow(DateFormatError);
    expect(() => isoToDMY('2026-02-30')).toThrow(DateFormatError);
    expect(() => isoToDMY('')).toThrow(DateFormatError);
    expect(() => isoToDMY('2026-1-5')).toThrow(DateFormatError);
  });
});

describe('inverse parsers — one shape each, strict', () => {
  it('round-trip every pair', () => {
    for (const [fwd, back] of [
      [isoToDMY, parseDMY],
      [isoToMDY, parseMDY],
      [isoToYMD, parseYMD],
      [isoToDdMonYyyy, parseDdMonYyyy],
    ] as const) {
      expect(back(fwd(ISO))).toBe(ISO);
    }
  });

  it('parseDMY rejects an impossible day/month, the wrong separator, and other shapes', () => {
    expect(() => parseDMY('10/15/2026')).toThrow(DateFormatError); // month 15
    expect(() => parseDMY('32/01/2026')).toThrow(DateFormatError); // day 32
    expect(() => parseDMY('15-10-2026')).toThrow(DateFormatError); // dashes
    expect(() => parseDMY('2026-10-15')).toThrow(DateFormatError); // ISO
    expect(() => parseDMY('15/10/26')).toThrow(DateFormatError); // 2-digit year
  });

  it('parseMDY / parseYMD are shape-strict too', () => {
    expect(parseMDY('10/15/2026')).toBe(ISO);
    expect(() => parseMDY('15/10/2026')).toThrow(DateFormatError); // month 15
    expect(parseYMD('2026/10/15')).toBe(ISO);
    expect(() => parseYMD('15/10/2026')).toThrow(DateFormatError); // year 15
  });

  it('parseDdMonYyyy is case-insensitive on the month token, strict on shape', () => {
    expect(parseDdMonYyyy('15 oct 2026')).toBe(ISO);
    expect(parseDdMonYyyy('15 OCT 2026')).toBe(ISO);
    expect(() => parseDdMonYyyy('15 October 2026')).toThrow(DateFormatError);
    expect(() => parseDdMonYyyy('15/Oct/2026')).toThrow(DateFormatError);
    expect(() => parseDdMonYyyy('15 Foo 2026')).toThrow(DateFormatError);
  });

  it('parseIso validates + canonicalises an ISO date and rejects anything else', () => {
    expect(parseIso('2026-10-15')).toBe(ISO);
    expect(() => parseIso('2026/10/15')).toThrow(DateFormatError);
    expect(() => parseIso('15/10/2026')).toThrow(DateFormatError);
    expect(() => parseIso('2026-02-30')).toThrow(DateFormatError);
  });
});
