import { expect, it } from 'vitest';
import { classifyDocument } from '../../../src/shared/documents/classify.js';

it('valid passport MRZ → passport, high', () => {
  const r = classifyDocument({ mrzDetected: true, mrzDocType: 'P', mrzOverallValid: true, ocrText: '' });
  expect(r.kind).toBe('passport');
  expect(r.confidence).toBeGreaterThanOrEqual(0.95);
});
it('MRZ present but invalid → passport, lower', () => {
  const r = classifyDocument({ mrzDetected: true, mrzDocType: 'P', mrzOverallValid: false, ocrText: '' });
  expect(r.kind).toBe('passport');
  expect(r.confidence).toBeLessThan(0.95);
});
it('no MRZ, passport keywords → passport, weak', () => {
  const r = classifyDocument({ mrzDetected: false, mrzDocType: null, mrzOverallValid: false, ocrText: 'REPUBLIC OF X\nPASSPORT\nP<' });
  expect(r.kind).toBe('passport');
  expect(r.confidence).toBeLessThan(0.7);
});
it('nothing passport-like → unknown', () => {
  const r = classifyDocument({ mrzDetected: false, mrzDocType: null, mrzOverallValid: false, ocrText: 'BANK STATEMENT\nAccount balance' });
  expect(r.kind).toBe('unknown');
});
