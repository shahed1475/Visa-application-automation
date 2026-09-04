import { describe, expect, it } from 'vitest';
import { extractFieldsFromOcr } from '../../../src/shared/documents/ocrFieldExtract.js';
import { scoreOcrField, penalizeUnnormalized } from '../../../src/shared/documents/confidence.js';
import type { OcrLine } from '../../../src/shared/mrz/types.js';

const line = (text: string, confidence = 90): OcrLine => ({ text, confidence });
const ref = new Date('2024-01-01T00:00:00Z');

const find = (fields: ReturnType<typeof extractFieldsFromOcr>, path: string) =>
  fields.find((f) => f.fieldPath === path);

describe('extractFieldsFromOcr — label extraction', () => {
  it('passport number on the label line is an anchored passport.number', () => {
    const lines = [line('Passport No: A01234567', 70)];
    const fields = extractFieldsFromOcr('Passport No: A01234567', lines, 'passport', ref);
    const f = find(fields, 'passport.number');
    expect(f).toBeDefined();
    expect(f?.value).toBe('A01234567');
    expect(f?.raw).toBe('A01234567');
    expect(f?.source).toBe('passport_ocr');
    expect(f?.checkDigitOk).toBeNull();
    expect(f?.normalizationNote).toBeNull();
    expect(f?.confidence).toBe(scoreOcrField({ anchored: true, lineConfidence: 70 }));
  });

  it('parses a DD/MM/YYYY date of birth to ISO', () => {
    const lines = [line('Date of Birth  15/01/1990', 88)];
    const fields = extractFieldsFromOcr('', lines, 'passport', ref);
    const f = find(fields, 'identity.dateOfBirth');
    expect(f?.value).toBe('1990-01-15');
    expect(f?.confidence).toBe(scoreOcrField({ anchored: true, lineConfidence: 88 }));
  });

  it('parses a "DD MON YYYY" date of issue to ISO', () => {
    const fields = extractFieldsFromOcr('', [line('Date of Issue 03 MAR 2016')], 'passport', ref);
    expect(find(fields, 'passport.issueDate')?.value).toBe('2016-03-03');
  });

  it('takes a value from the line after the label as an unanchored match', () => {
    const lines = [line('Surname', 88), line('ERIKSSON', 60)];
    const fields = extractFieldsFromOcr('', lines, 'passport', ref);
    const f = find(fields, 'identity.surname');
    expect(f?.value).toBe('ERIKSSON');
    expect(f?.confidence).toBe(scoreOcrField({ anchored: false, lineConfidence: 60 }));
  });

  it('kind "unknown" tags the source document_ocr', () => {
    const fields = extractFieldsFromOcr('', [line('Nationality: BANGLADESHI')], 'unknown', ref);
    const f = find(fields, 'identity.nationality');
    expect(f?.value).toBe('BANGLADESHI');
    expect(f?.source).toBe('document_ocr');
  });

  it('an unparseable date is emitted with value null, raw kept, a note, halved score', () => {
    const lines = [line('Date of Birth: 45/67/8901', 90)];
    const fields = extractFieldsFromOcr('', lines, 'passport', ref);
    const f = find(fields, 'identity.dateOfBirth');
    expect(f).toBeDefined();
    expect(f?.value).toBeNull();
    expect(f?.raw).toBe('45/67/8901');
    expect(f?.normalizationNote).not.toBeNull();
    expect(f?.confidence).toBe(
      penalizeUnnormalized(scoreOcrField({ anchored: true, lineConfidence: 90 })),
    );
  });

  it('skips a label with no value on the line and no following line', () => {
    const fields = extractFieldsFromOcr('', [line('Given Names')], 'passport', ref);
    expect(find(fields, 'identity.givenNames')).toBeUndefined();
  });

  it('place of issue / authority maps to passport.placeOfIssue', () => {
    const fields = extractFieldsFromOcr('', [line('Issuing Authority: DHAKA')], 'passport', ref);
    expect(find(fields, 'passport.placeOfIssue')?.value).toBe('DHAKA');
  });

  it('de-dupes per field path, an anchored match beating a later loose one', () => {
    const lines = [
      line('Date of Expiry 14/02/2030', 80),
      line('Expiry'),
      line('99/99/9999', 40),
    ];
    const fields = extractFieldsFromOcr('', lines, 'passport', ref);
    const hits = fields.filter((f) => f.fieldPath === 'passport.expiryDate');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.value).toBe('2030-02-14');
  });

  it('falls back to splitting the raw text when no lines are supplied', () => {
    const text = 'PASSPORT\nDate of Birth 20/06/1985\n';
    const fields = extractFieldsFromOcr(text, [], 'passport', ref);
    expect(find(fields, 'identity.dateOfBirth')?.value).toBe('1985-06-20');
  });
});
