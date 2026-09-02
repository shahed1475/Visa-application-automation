import type { VisaPortal } from '../../../../shared/types';

export interface PortalFormProps {
  initial?: VisaPortal;
  onCancel: () => void;
  onSaved: (portal: VisaPortal) => void | Promise<void>;
}

// Stub — replaced with the real implementation in Task 9.
export function PortalForm(_props: PortalFormProps) {
  return null;
}
