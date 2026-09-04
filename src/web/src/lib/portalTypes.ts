import type { PortalType } from '../../../shared/types';

export const PORTAL_TYPE_OPTIONS: { value: PortalType; label: string }[] = [
  { value: 'regular', label: 'Regular Visa' },
  { value: 'evisa', label: 'e-Visa' },
  { value: 'custom', label: 'Custom' },
];
