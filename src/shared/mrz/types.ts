export interface OcrLine {
  text: string;
  confidence: number;
}

export interface Td3CheckDigit {
  input: string;
  expected: number;
  actual: string;
  ok: boolean;
}

export interface Td3Field {
  raw: string;
  checkDigit: Td3CheckDigit | null;
}

export interface Td3Result {
  documentCode: string;
  issuingState: string;
  surname: string;
  givenNames: string;
  documentNumber: Td3Field;
  nationality: string;
  dateOfBirth: Td3Field;
  sex: string;
  expiryDate: Td3Field;
  optionalData: Td3Field;
  composite: Td3CheckDigit;
  overallValid: boolean;
  line1: string;
  line2: string;
}

export interface DetectedMrz {
  line1: string;
  line2: string;
  lineConfidence: number;
}
