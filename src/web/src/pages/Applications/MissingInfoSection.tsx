import type { MissingItem } from '../../../../shared/application/types';
import { SourceLine } from './provenance';

/**
 * Where a missing item belongs on this page. `missing[]` is a flat roll-up; each
 * item is either a form field (surfaced in "Required information") or a document
 * (surfaced in "Required documents"). We anchor to those two top-level dashboard
 * sections — `MissingItem.sectionId` names an engine `SectionPlan`, which is not
 * a DOM id, so it cannot be a link target here.
 */
function anchorFor(item: MissingItem): { href: string; label: string } {
  return item.kind === 'document'
    ? { href: '#required-documents', label: 'Required documents' }
    : { href: '#required-information', label: 'Required information' };
}

export function MissingInfoSection({ missing }: { missing: MissingItem[] }) {
  if (missing.length === 0) {
    return <p className="hint">Nothing required is missing from the current data.</p>;
  }

  return (
    <ul className="missing-list">
      {missing.map((item) => {
        const anchor = anchorFor(item);
        return (
          <li key={`${item.kind}:${item.id}`} className="missing-item">
            <div className="missing-item__head">
              <span className="missing-item__label">{item.label}</span>
              <span className={`req-chip req-chip--${item.kind}`}>{item.kind}</span>
            </div>
            <p className="missing-item__where">
              Belongs in <a href={anchor.href}>{anchor.label}</a>
            </p>
            <SourceLine source={item.source} />
          </li>
        );
      })}
    </ul>
  );
}
