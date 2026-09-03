const WEIGHTS = [7, 3, 1];

export function charValue(c: string): number {
  if (c.length !== 1) throw new RangeError(`expected one char, got ${JSON.stringify(c)}`);
  if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48;
  if (c >= 'A' && c <= 'Z') return c.charCodeAt(0) - 55; // 'A' → 10
  if (c === '<') return 0;
  throw new RangeError(`invalid MRZ character ${JSON.stringify(c)}`);
}

export function computeCheckDigit(field: string): number {
  let sum = 0;
  for (let i = 0; i < field.length; i += 1) {
    sum += charValue(field[i]!) * WEIGHTS[i % 3]!;
  }
  return sum % 10;
}

export function verifyCheckDigit(field: string, digit: string): boolean {
  if (!/^[0-9]$/.test(digit)) return false;
  return computeCheckDigit(field) === Number(digit);
}
