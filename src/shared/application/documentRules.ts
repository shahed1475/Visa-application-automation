import type { ConditionContext } from './conditions.js';
import { evaluateCondition } from './conditions.js';
import type { DocumentCoverage, DocumentCoverageEntry, DocumentPlan } from './types.js';
import type { VisaCategory, VisaDocument } from '../visa-kb/schema.js';

/** Lowercases and splits on runs of non-alphanumeric characters, dropping empty pieces.
 *  Shared by both sides of `matchDocument`'s Rule B so the tokenization is identical for
 *  an uploaded document's original filename and a KB document id. */
function tokenize(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 0));
}

/** Matches a KB document against an applicant's uploaded documents. Iterates `uploadedDocs`
 *  in array order and returns the first entry's `id` that satisfies either rule; `null` if
 *  none match. This is intentionally the *only* place upload-matching heuristics live -- a
 *  single generic function, not a per-category lookup table. */
export function matchDocument(kbDoc: VisaDocument, uploadedDocs: DocumentCoverageEntry[]): string | null {
  const kbTokens = tokenize(kbDoc.id);
  for (const doc of uploadedDocs) {
    // Rule A (classification-kind match): a Phase 3-classified passport satisfies any
    // passport-family KB document (e.g. 'passport', 'passport_copy').
    if (doc.kind === 'passport' && kbDoc.id.startsWith('passport')) return doc.id;
    // Rule B (token-overlap match): share at least one "distinctive" token (length >= 4)
    // between the uploaded file's original name and the KB document id.
    if (doc.originalName !== null) {
      const nameTokens = tokenize(doc.originalName);
      for (const token of nameTokens) {
        if (token.length >= 4 && kbTokens.has(token)) return doc.id;
      }
    }
  }
  return null;
}

/** The requirement/condition/effectiveRequirement/source portion of a `DocumentPlan`. */
interface DocResolution {
  requirement: DocumentPlan['requirement'];
  condition: DocumentPlan['condition'];
  conditionMet: DocumentPlan['conditionMet'];
  effectiveRequirement: DocumentPlan['effectiveRequirement'];
  source: DocumentPlan['source'];
}

function buildPlan(doc: VisaDocument, resolution: DocResolution, uploadedDocs: DocumentCoverageEntry[]): DocumentPlan {
  const matchedDocumentId = matchDocument(doc, uploadedDocs);
  return {
    id: doc.id,
    label: doc.label,
    uploaded: matchedDocumentId !== null,
    matchedDocumentId,
    ...resolution,
  };
}

/** Pure document-rule resolver: turns a category's required/optional/conditional documents
 *  plus uploaded-document coverage into `DocumentPlan[]` per spec §4.4/§6.2. Deterministic
 *  and side-effect free -- condition evaluation is delegated to Task 7's `evaluateCondition`. */
export function resolveDocumentPlans(input: {
  category: VisaCategory;
  ctx: ConditionContext;
  documentCoverage: DocumentCoverage;
}): DocumentPlan[] {
  const { category, ctx, documentCoverage } = input;
  const uploadedDocs = documentCoverage.documents;

  const plans: DocumentPlan[] = [];

  for (const doc of category.requiredDocuments) {
    plans.push(
      buildPlan(
        doc,
        { requirement: 'required', condition: null, conditionMet: null, effectiveRequirement: 'required', source: category.source },
        uploadedDocs,
      ),
    );
  }

  for (const doc of category.optionalDocuments) {
    plans.push(
      buildPlan(
        doc,
        { requirement: 'optional', condition: null, conditionMet: null, effectiveRequirement: 'optional', source: category.source },
        uploadedDocs,
      ),
    );
  }

  for (const doc of category.conditionalDocuments) {
    const conditionMet = evaluateCondition(doc.condition, ctx);
    const effectiveRequirement: DocumentPlan['effectiveRequirement'] = conditionMet === true ? 'required' : 'not_applicable';
    plans.push(
      buildPlan(
        doc,
        { requirement: 'conditional', condition: doc.condition, conditionMet, effectiveRequirement, source: doc.source },
        uploadedDocs,
      ),
    );
  }

  // Return-ticket promotion (spec's KB-driven rule): reads `travelRequirements.onwardOrReturnTicket`
  // (a KB field, not a category-id literal) and promotes every ticket-like document -- by `id`
  // substring, not a hardcoded doc id -- to effectiveRequirement 'required'. Additive: it never
  // rewrites the document's own condition/conditionMet.
  //
  // A 'conditional' doc is only promotable when its condition actually evaluated `true`. An
  // unmet (`false`) or unknown (`null`) condition must stay `not_applicable` per spec
  // §4.4/§5: `null` is never `false`, never lands in `missing`, and is never a blocker --
  // promoting it would turn a "needs review" state into a hard gate on unknown data.
  if (category.travelRequirements.onwardOrReturnTicket === true) {
    for (const plan of plans) {
      if (!plan.id.toLowerCase().includes('ticket')) continue;
      const promotable =
        plan.requirement === 'optional' ||
        (plan.requirement === 'conditional' && plan.conditionMet === true);
      if (promotable) {
        plan.effectiveRequirement = 'required';
      }
    }
  }

  return plans;
}
