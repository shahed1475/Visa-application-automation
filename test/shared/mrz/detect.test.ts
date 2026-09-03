import { describe, expect, it } from 'vitest';
import { detectMrzLines } from '../../../src/shared/mrz/detect.js';
import { ICAO_SPECIMEN } from '../../helpers/mrzFixtures.js';

const line = (text: string, confidence = 90) => ({ text, confidence });

describe('detectMrzLines', () => {
  it('finds the MRZ among page noise', () => {
    const got = detectMrzLines([
      line('REPUBLIC OF ELBONIA'), line('Passport No  A01234567'),
      line(ICAO_SPECIMEN.line1), line(ICAO_SPECIMEN.line2), line('  '),
    ]);
    expect(got?.line1).toBe(ICAO_SPECIMEN.line1);
    expect(got?.line2).toBe(ICAO_SPECIMEN.line2);
  });
  it('tolerates spaces and lowercase from OCR', () => {
    const got = detectMrzLines([
      line(ICAO_SPECIMEN.line1.toLowerCase().replace(/(.{10})/g, '$1 ')),
      line(ICAO_SPECIMEN.line2.toLowerCase()),
    ]);
    expect(got?.line1).toBe(ICAO_SPECIMEN.line1);
  });
  it('returns null when there is no MRZ', () => {
    expect(detectMrzLines([line('Name: John Smith'), line('DOB: 1990-01-01')])).toBeNull();
  });
});
