import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ApplicationPlan, VisaApplication } from '../../../../shared/application/types';
import { api } from '../../api/client';
import {
  Chip,
  STUB_CHIP,
  chipForEligibility,
  chipForRequiredInfo,
  chipForVisaSelection,
  type StatusChip,
} from './chips';
import { SourceLine } from './provenance';
import { VisaSelectionSection } from './VisaSelectionSection';
import { EligibilitySection } from './EligibilitySection';
import { RequiredInfoSection } from './RequiredInfoSection';

interface Loaded {
  application: VisaApplication;
  plan: ApplicationPlan;
}

function DashboardSection({
  id,
  title,
  chip,
  children,
}: {
  id: string;
  title: string;
  chip: StatusChip;
  children: ReactNode;
}) {
  return (
    <section id={id} className="dashboard-section" aria-labelledby={`${id}-heading`}>
      <div className="dashboard-section__head">
        <h2 id={`${id}-heading`}>{title}</h2>
        <Chip status={chip} />
      </div>
      {children}
    </section>
  );
}

export function ApplicationDashboardPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await api.getApplication(id);
      setData(res);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load the application');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (loading && !data) return <p>Loading…</p>;
  if (error && !data)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  if (!data || !id) return <p>Application not found.</p>;

  const { application, plan } = data;
  const categoryName = plan.category?.displayName ?? plan.selection.categoryId;

  return (
    <section className="application-dashboard">
      <p>
        <Link to={`/applicants/${application.applicantId}`}>← Back to applicant</Link>
      </p>

      <div className="section-head">
        <h1>{categoryName}</h1>
        <span className="muted">
          {application.applicationMode} · status {application.status} · KB {application.kbVersion}
        </span>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {plan.warnings.length > 0 && (
        <ul className="plan-warnings">
          {plan.warnings.map((w, i) => (
            <li key={i} className={`plan-warning plan-warning--${w.severity}`}>
              <span className="plan-warning__severity">{w.severity}</span> {w.text}{' '}
              <SourceLine source={w.source} />
            </li>
          ))}
        </ul>
      )}

      <p className="hint">
        Prepared against the current knowledge base. This dashboard does not submit or approve
        anything.
      </p>

      <DashboardSection id="visa-selection" title="Visa selection" chip={chipForVisaSelection(plan)}>
        <VisaSelectionSection application={application} onSaved={reload} />
      </DashboardSection>

      <DashboardSection id="eligibility" title="Eligibility" chip={chipForEligibility(plan.eligibility)}>
        <EligibilitySection eligibility={plan.eligibility} />
      </DashboardSection>

      <DashboardSection
        id="required-information"
        title="Required information"
        chip={chipForRequiredInfo(plan.sections)}
      >
        <RequiredInfoSection
          sections={plan.sections}
          applicationId={application.id}
          applicantId={application.applicantId}
          onChanged={reload}
        />
      </DashboardSection>

      <DashboardSection id="required-documents" title="Required documents" chip={STUB_CHIP}>
        <p className="hint">Added in Task 18.</p>
      </DashboardSection>

      <DashboardSection id="missing-information" title="Missing information" chip={STUB_CHIP}>
        <p className="hint">Added in Task 18.</p>
      </DashboardSection>

      <DashboardSection id="verification" title="Verification" chip={STUB_CHIP}>
        <p className="hint">Added in Task 18.</p>
      </DashboardSection>

      <DashboardSection id="ready-for-automation" title="Ready for automation" chip={STUB_CHIP}>
        <p className="hint">Added in Task 18.</p>
      </DashboardSection>
    </section>
  );
}
