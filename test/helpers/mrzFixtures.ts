// ICAO Doc 9303 Part 3 public specimen — invented holder "ANNA MARIA ERIKSSON", state "UTO".
export const ICAO_SPECIMEN = {
  line1: 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
  line2: 'L898902C36UTO7408122F1204159ZE184226B<<<<<10',
} as const;

import { computeCheckDigit } from '../../src/shared/mrz/checkDigit.js';

interface BuildOpts {
  documentCode?: string;        // default 'P<'
  issuingState?: string;        // default 'BGD'
  surname: string;
  givenNames: string;
  documentNumber: string;       // <=9 chars, will be '<'-padded
  nationality?: string;         // default 'BGD'
  dateOfBirth: string;          // YYMMDD
  sex: 'M' | 'F' | '<';
  expiryDate: string;           // YYMMDD
  optionalData?: string;        // default '' → all filler
}

const pad = (s: string, n: number) => (s + '<'.repeat(n)).slice(0, n);

export function buildTd3(o: BuildOpts): { line1: string; line2: string } {
  const documentCode = pad(o.documentCode ?? 'P<', 2);
  const issuingState = pad(o.issuingState ?? 'BGD', 3);
  const name = pad(`${o.surname.toUpperCase()}<<${o.givenNames.toUpperCase().replace(/ /g, '<')}`, 39);
  const line1 = documentCode + issuingState + name;

  const num = pad(o.documentNumber.toUpperCase(), 9);
  const numCd = String(computeCheckDigit(num));
  const nat = pad(o.nationality ?? 'BGD', 3);
  const dobCd = String(computeCheckDigit(o.dateOfBirth));
  const expCd = String(computeCheckDigit(o.expiryDate));
  const opt = pad(o.optionalData ?? '', 14);
  const optCd = String(computeCheckDigit(opt));
  const beforeComposite = num + numCd + nat + o.dateOfBirth + dobCd + o.sex + o.expiryDate + expCd + opt + optCd;
  const compositeInput = beforeComposite.slice(0, 10) + beforeComposite.slice(13, 20) + beforeComposite.slice(21, 43);
  const compCd = String(computeCheckDigit(compositeInput));
  return { line1, line2: beforeComposite + compCd };
}
