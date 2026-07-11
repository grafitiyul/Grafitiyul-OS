// Submission lifecycle policy — the ONE decision table for what a submission
// allows at any moment. Two lifecycle families, chosen by the purpose registry:
//
// Classic (general / customer questionnaires):
//   draft (editable, version pinned at start) → submitted (immutable).
//
// Tour-operational (tourOperational: true — coordination, tour summary):
//   draft      — editable, autosaved, follows the template's CURRENT
//                published version (definition changes appear live)
//   submitted  — officially completed, but STILL editable and still live;
//                the guide may reopen and update answers
//   frozen     — the subject's tour closed (frozenAt set): version pinned,
//                answers snapshotted, everything immutable. Historical record.
//
// Pure module (registry is DB-free) — unit-testable without a database.

import { getPurpose } from './registry.js';

export function purposeLifecycle(purposeKey) {
  const tourOperational = !!getPurpose(purposeKey)?.tourOperational;
  return {
    // Follow template.currentVersionId until frozen (vs. pinned at start).
    liveVersion: tourOperational,
    // Answer writes + re-submit allowed while status is submitted/reviewed.
    editableAfterSubmit: tourOperational,
  };
}

// row: { purpose, status, frozenAt } — a QuestionnaireSubmission (or subset).
export function submissionLifecycle(row) {
  const { liveVersion, editableAfterSubmit } = purposeLifecycle(row.purpose);
  const frozen = !!row.frozenAt;
  const editable =
    !frozen &&
    (row.status === 'draft' ||
      (editableAfterSubmit && (row.status === 'submitted' || row.status === 'reviewed')));
  return { liveVersion, editableAfterSubmit, frozen, editable };
}
