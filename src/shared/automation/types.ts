export type RunStatus = 'pending' | 'running' | 'waiting_for_user' | 'paused' | 'review_ready' | 'failed' | 'aborted';
export type WaitingReason = 'otp' | 'captcha' | 'mfa' | 'anti_bot' | 'unknown_page' | 'missing_field_mapping' | 'value_mismatch' | 'document_upload_required' | 'session_expired' | 'validation_error' | 'user_paused';
export type PortalState = string; // adapter-defined; 'UNKNOWN' is reserved
export const UNKNOWN_STATE = 'UNKNOWN';
export type ControlKind = 'text' | 'textarea' | 'native_select' | 'custom_select' | 'radio' | 'checkbox' | 'date' | 'number' | 'autocomplete' | 'searchable_select';
export type SelectorConfidence = 'stable' | 'moderate' | 'fragile';
export interface PortalFieldSpec {
  selector: string;
  fallbackSelector?: string;
  control: ControlKind;
  selectorConfidence: SelectorConfidence;
  transform?: (canonical: string) => string;
  optionMatch?: 'exact' | 'label' | 'value';
}
export type PortalFieldMap = Record<string, PortalFieldSpec>; // key = FieldPlan.appliesTo
export interface SignalMatch { kind: 'url' | 'title' | 'heading' | 'label' | 'field' | 'marker'; matched: boolean; detail: string }
export interface PageIdentity { state: PortalState; confidence: number; signals: SignalMatch[] }
export interface MappedField {
  fieldPath: string;            // FieldPlan.appliesTo (non-null)
  label: string;
  sectionId: string;
  required: boolean;            // effectiveRequirement === 'required'
  present: boolean;
  verified: boolean;
  spec: PortalFieldSpec | null; // null => unmapped
  expected: string | null;     // spec.transform applied; null when !present
}
export type VerificationOutcome = 'verified' | 'mismatch' | 'unreadable' | 'skipped_no_value';
export interface VerificationResult { fieldPath: string; outcome: VerificationOutcome }
export interface RunSummary { fieldsTotal: number; fieldsVerified: number; documentsTotal: number; documentsReady: number; unverifiedFields: string[]; unmappedFields: string[] }
export interface AutomationRunRow {
  id: string; application_id: string; portal_id: string | null; portal_url_snapshot: string;
  adapter_id: string; status: RunStatus; waiting_reason: WaitingReason | null;
  current_portal_state: string | null; current_section_id: string | null;
  fields_total: number; fields_verified: number; documents_total: number; documents_ready: number;
  error_code: string | null; error_message: string | null;
  started_at: string; updated_at: string; ended_at: string | null;
}
export interface AutomationEventRow {
  id: string; run_id: string; seq: number; created_at: string;
  type: string; portal_state: string | null; field_path: string | null;
  status: string | null; message: string; evidence_path: string | null;
}
