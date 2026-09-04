import { useMemo, useState } from 'react';
import {
  checkEligibility, getCategoriesForMode, getDocumentRequirements, getVersion,
  type ApplicationMode, type EligibilityCondition, type VisaCategory,
} from '../../../../shared/visa-kb/index';

const NATIONALITY = 'BGD';

function formatCondition(c: EligibilityCondition): string {
  switch (c.type) {
    case 'custom': return c.text;
    case 'not_endorsed_on_relative_passport': return 'Applicant holds their own passport (not endorsed on a relative’s).';
    case 'requires_supporting_institution_letter': return 'A supporting letter from the sponsoring institution is required.';
    case 'passport_type_in': return `Passport type is one of: ${c.value.join(', ')}.`;
    case 'passport_type_not_in': return `Passport type must not be: ${c.value.join(', ')}.`;
    case 'no_prohibited_background': return `No background in: ${c.value.join(', ')}.`;
    case 'purpose_in': return `Trip purpose is one of: ${c.value.join(', ')}.`;
    case 'purpose_not_in': return `Trip purpose must not be: ${c.value.join(', ')}.`;
    case 'min_age': return `Minimum age ${c.value}.`;
    case 'max_age': return `Maximum age ${c.value}.`;
    case 'passport_validity_months_min': return `Passport valid for at least ${c.value} months.`;
    case 'salary_min_inr_per_annum': return `Minimum annual salary ₹${c.value.toLocaleString('en-IN')}.`;
    default: { const _exhaustive: never = c; return _exhaustive; }
  }
}

type EligibilityStatus = 'eligible' | 'conditional' | 'ineligible' | 'not_offered';

/** Green only for a clean pass, amber only for "yes, but"; a refusal must never look like either. */
function badgeVariant(status: EligibilityStatus): 'verified' | 'partial' | 'unverified' {
  switch (status) {
    case 'eligible': return 'verified';
    case 'conditional': return 'partial';
    case 'ineligible':
    case 'not_offered': return 'unverified';
    default: { const _exhaustive: never = status; return _exhaustive; }
  }
}

export function VisaRulesPage() {
  const version = useMemo(() => getVersion(), []);
  const [mode, setMode] = useState<ApplicationMode>('evisa');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const categories = useMemo(() => getCategoriesForMode(mode), [mode]);
  const selected = useMemo<VisaCategory | null>(
    () => categories.find((c) => c.id === selectedId) ?? null,
    [categories, selectedId],
  );

  function switchMode(next: ApplicationMode) {
    setMode(next);
    setSelectedId(null);
  }

  return (
    <section className="visa-rules">
      <div className="section-head">
        <h2>India visa rules</h2>
        <span className="muted">
          KB version {version.kbVersion} · revised {version.revisionDate}
        </span>
      </div>

      <div className="visa-rules__modes" role="group" aria-label="Application mode">
        <button
          className={mode === 'evisa' ? 'active' : ''}
          aria-pressed={mode === 'evisa'}
          onClick={() => switchMode('evisa')}
        >
          e-Visa
        </button>
        <button
          className={mode === 'regular' ? 'active' : ''}
          aria-pressed={mode === 'regular'}
          onClick={() => switchMode('regular')}
        >
          Regular / Paper
        </button>
      </div>

      <div className="visa-rules__body">
        <ul className="visa-rules__list">
          {categories.map((c) => (
            <li key={c.id}>
              <button
                className={selectedId === c.id ? 'active' : ''}
                onClick={() => setSelectedId(c.id)}
              >
                <strong>{c.displayName}</strong>
                <span className="muted">
                  {c.validity.amount} {c.validity.unit} · {c.entries} entry · {c.officialCode ?? '—'}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {selected && <VisaCategoryDetail category={selected} mode={mode} />}
      </div>
    </section>
  );
}

function VisaCategoryDetail({ category, mode }: { category: VisaCategory; mode: ApplicationMode }) {
  const docs = getDocumentRequirements(category.id);
  const eligibility = checkEligibility(NATIONALITY, mode, category.id);

  return (
    <div className="visa-rules__detail">
      <h3>{category.displayName}</h3>

      <dl>
        <dt>Purpose</dt><dd>{category.purpose.join(', ')}</dd>
        <dt>Validity</dt>
        <dd>{category.validity.amount} {category.validity.unit} from {category.validity.from.replace(/_/g, ' ')}
          {category.validity.notes ? ` — ${category.validity.notes}` : ''}</dd>
        <dt>Entries</dt><dd>{category.entries}</dd>
        <dt>Stay</dt>
        <dd>
          {[
            category.stayLimitations.perVisitDays && `${category.stayLimitations.perVisitDays} days per visit`,
            category.stayLimitations.perCalendarYearDays && `${category.stayLimitations.perCalendarYearDays} days per calendar year`,
            category.stayLimitations.aggregateDays && `${category.stayLimitations.aggregateDays} days aggregate`,
            category.stayLimitations.notes,
          ].filter(Boolean).join(' · ') || '—'}
        </dd>
        <dt>Application timing</dt>
        <dd>
          {[
            category.applicationTiming.minLeadDays != null && `at least ${category.applicationTiming.minLeadDays} days before travel`,
            category.applicationTiming.maxLeadDays != null && `up to ${category.applicationTiming.maxLeadDays} days ahead`,
            category.applicationTiming.notes,
          ].filter(Boolean).join(' · ') || '—'}
        </dd>
        <dt>Extendable / convertible</dt>
        <dd>{category.extendable ? 'Extendable' : 'Not extendable'} · {category.convertible ? 'Convertible' : 'Not convertible'}</dd>
      </dl>

      <h4>Required documents</h4>
      <ul>{(docs?.required ?? []).map((d) => <li key={d.id}>{d.label}{d.notes ? ` — ${d.notes}` : ''}</li>)}</ul>
      {docs && docs.optional.length > 0 && (
        <>
          <h4>Optional / conditional documents</h4>
          <ul>{docs.optional.map((d) => <li key={d.id}>{d.label}</li>)}</ul>
        </>
      )}

      {category.specialConditions.length > 0 && (
        <>
          <h4>Special conditions</h4>
          <ul>{category.specialConditions.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </>
      )}
      {category.restrictions.length > 0 && (
        <>
          <h4>Restrictions</h4>
          <ul>{category.restrictions.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </>
      )}

      <h4>Bangladesh eligibility</h4>
      {eligibility.status === 'unknown' ? (
        <p className="warning">No Bangladesh eligibility rule recorded for this category.</p>
      ) : (
        <>
          <p><span className={`badge badge--${badgeVariant(eligibility.status)}`}>{eligibility.status}</span> {eligibility.basis}</p>
          {eligibility.conditions.length > 0 && (
            <ul>
              {eligibility.conditions.map((c, i) => <li key={i}>{formatCondition(c)}</li>)}
            </ul>
          )}
        </>
      )}

      <p className="muted">
        <a href={category.source.officialUrl} target="_blank" rel="noreferrer">Official source</a>
        {' · '}retrieved {category.source.retrievedAt}
        {category.source.notes ? ` · ${category.source.notes}` : ''}
      </p>
    </div>
  );
}
