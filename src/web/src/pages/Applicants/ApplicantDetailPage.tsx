import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ApplicantDetail } from '../../../../shared/applicant/types';
import { api } from '../../api/client';
import { SEX_OPTIONS, MARITAL_STATUS_OPTIONS, YES_NO_OPTIONS } from '../../lib/applicantOptions';
import { CompletenessHeader } from './CompletenessHeader';
import { SectionCard, type SectionField } from './SectionCard';
import { TravelSection } from './TravelSection';
import { ReferenceSection } from './ReferenceSection';
import { DocumentsSubsection } from './DocumentsSubsection';
import { ApplicationsSubsection } from './ApplicationsSubsection';

const IDENTITY_FIELDS: SectionField[] = [
  { key: 'surname', label: 'Surname' },
  { key: 'givenNames', label: 'Given names' },
  { key: 'fullNameAsInPassport', label: 'Full name as in passport' },
  { key: 'dateOfBirth', label: 'Date of birth', type: 'date' },
  { key: 'sex', label: 'Sex', type: 'select', options: SEX_OPTIONS },
  { key: 'placeOfBirth', label: 'Place of birth' },
  { key: 'nationality', label: 'Nationality' },
  { key: 'otherNationalities', label: 'Other nationalities' },
];
const PASSPORT_FIELDS: SectionField[] = [
  { key: 'documentType', label: 'Document type' },
  { key: 'number', label: 'Passport number' },
  { key: 'issuingState', label: 'Issuing state' },
  { key: 'issueDate', label: 'Issue date', type: 'date' },
  { key: 'expiryDate', label: 'Expiry date', type: 'date' },
  { key: 'placeOfIssue', label: 'Place of issue' },
  { key: 'issuingAuthority', label: 'Issuing authority' },
];
const CONTACT_FIELDS: SectionField[] = [
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'phone', label: 'Phone' },
  { key: 'altPhone', label: 'Alternate phone' },
];
const ADDRESS_FIELDS: SectionField[] = [
  { key: 'line1', label: 'Address line 1' },
  { key: 'line2', label: 'Address line 2' },
  { key: 'city', label: 'City' },
  { key: 'region', label: 'Region / state' },
  { key: 'postalCode', label: 'Postal code' },
  { key: 'country', label: 'Country' },
];
const FAMILY_FIELDS: SectionField[] = [
  { key: 'fatherName', label: "Father's name" },
  { key: 'fatherNationality', label: "Father's nationality" },
  { key: 'fatherPrevNationality', label: "Father's previous nationality" },
  { key: 'fatherPlaceOfBirth', label: "Father's place of birth" },
  { key: 'motherName', label: "Mother's name" },
  { key: 'motherNationality', label: "Mother's nationality" },
  { key: 'motherPrevNationality', label: "Mother's previous nationality" },
  { key: 'motherPlaceOfBirth', label: "Mother's place of birth" },
  { key: 'maritalStatus', label: 'Marital status', type: 'select', options: MARITAL_STATUS_OPTIONS },
  { key: 'spouseName', label: "Spouse's name" },
  { key: 'spouseNationality', label: "Spouse's nationality" },
  { key: 'spousePrevNationality', label: "Spouse's previous nationality" },
  { key: 'spousePlaceOfBirth', label: "Spouse's place of birth" },
  { key: 'pakistanAncestry', label: 'Pakistan ancestry', type: 'select', options: YES_NO_OPTIONS },
];
const OCCUPATION_FIELDS: SectionField[] = [
  { key: 'occupation', label: 'Occupation' },
  { key: 'employerName', label: 'Employer name' },
  { key: 'employerAddress', label: 'Employer address' },
  { key: 'designation', label: 'Designation' },
  { key: 'militaryPolice', label: 'Military / police background', type: 'select', options: YES_NO_OPTIONS },
];

export function ApplicantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<ApplicantDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await api.getApplicant(id);
      setDetail(res.applicant);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load applicant');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (loading) return <p>Loading…</p>;
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!detail || !id) return <p>Applicant not found.</p>;

  const saveSection = (key: 'identity' | 'passport' | 'contact' | 'address' | 'family' | 'occupation') =>
    async (patch: Record<string, string | null>) => {
      await api.updateApplicant(id, { [key]: patch });
      await reload();
    };

  const verifyField = async (fieldPath: string, verified: boolean) => {
    try {
      await api.setFieldMeta(id, { fieldPath, verified });
      await reload();
    } catch (e) {
      // Re-thrown rather than set on the page: the SectionCard that owns the
      // control renders it in its own inline error slot, so the rest of the
      // profile stays on screen (a page-level error replaces the whole view).
      throw e instanceof Error ? e : new Error('Failed to update verification');
    }
  };

  async function duplicate() {
    const res = await api.duplicateApplicant(id!);
    navigate(`/applicants/${res.applicant.id}`);
  }
  async function remove() {
    if (!window.confirm(`Delete applicant "${detail!.displayName}"?`)) return;
    await api.deleteApplicant(id!);
    navigate('/applicants');
  }

  return (
    <section>
      <p><Link to="/applicants">← All applicants</Link></p>
      <div className="section-head">
        <h2>{detail.displayName}</h2>
        <div className="row-actions">
          <button onClick={duplicate}>Duplicate</button>
          <button className="danger" onClick={remove}>Delete</button>
        </div>
      </div>

      <CompletenessHeader detail={detail} />

      <SectionCard title="Identity" sectionKey="identity" fields={IDENTITY_FIELDS}
        values={detail.identity as unknown as Record<string, string | null>}
        fieldMeta={detail.fieldMeta} onSave={saveSection('identity')} onVerify={verifyField} />
      <SectionCard title="Passport" sectionKey="passport" fields={PASSPORT_FIELDS}
        values={detail.passport as unknown as Record<string, string | null>}
        fieldMeta={detail.fieldMeta} onSave={saveSection('passport')} onVerify={verifyField} />
      <SectionCard title="Contact" sectionKey="contact" fields={CONTACT_FIELDS}
        values={detail.contact as unknown as Record<string, string | null>}
        fieldMeta={detail.fieldMeta} onSave={saveSection('contact')} onVerify={verifyField} />
      <SectionCard title="Address" sectionKey="address" fields={ADDRESS_FIELDS}
        values={detail.address as unknown as Record<string, string | null>}
        fieldMeta={detail.fieldMeta} onSave={saveSection('address')} onVerify={verifyField} />
      <SectionCard title="Family" sectionKey="family" fields={FAMILY_FIELDS}
        values={detail.family as unknown as Record<string, string | null>}
        fieldMeta={detail.fieldMeta} onSave={saveSection('family')} onVerify={verifyField} />
      <SectionCard title="Occupation" sectionKey="occupation" fields={OCCUPATION_FIELDS}
        values={detail.occupation as unknown as Record<string, string | null>}
        fieldMeta={detail.fieldMeta} onSave={saveSection('occupation')} onVerify={verifyField} />

      <TravelSection applicantId={id} records={detail.travel} onChange={reload} />
      <ReferenceSection applicantId={id} records={detail.references} onChange={reload} />
      <DocumentsSubsection applicantId={id} />
      <ApplicationsSubsection applicantId={id} />
    </section>
  );
}
