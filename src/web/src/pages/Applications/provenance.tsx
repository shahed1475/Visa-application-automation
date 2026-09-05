import type { Source } from '../../../../shared/visa-kb/schema';

const CONFIDENCE_WORDS: Record<Source['confidence'], string> = {
  official_verbatim: 'official verbatim',
  official_derived: 'official derived',
  secondary_guidance: 'secondary guidance',
  unverified: 'unverified',
};

/** The provenance confidence as words — never a bare number or "%". */
export function confidenceLabel(source: Source): string {
  return `confidence: ${CONFIDENCE_WORDS[source.confidence]}`;
}

/**
 * Provenance for one rule decision: a real link to the official page plus the
 * confidence rendered as a labelled string (spec §8 hard invariant).
 */
export function SourceLine({ source }: { source: Source | null }) {
  if (!source) return <span className="muted">no recorded source</span>;
  return (
    <span className="source-line">
      <a href={source.officialUrl} target="_blank" rel="noreferrer">
        official source
      </a>{' '}
      <span className="confidence-chip">{confidenceLabel(source)}</span>
    </span>
  );
}
