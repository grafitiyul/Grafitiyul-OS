// Submission lifecycle policy — the ONE decision table for what a submission
// allows at any moment. Two lifecycle families, chosen by the purpose registry:
//
// Classic (general / customer questionnaires):
//   draft (editable, version pinned at start) → submitted (immutable).
//
// Tour-operational (tourOperational: true — coordination, tour summary),
// anchored on the tour's EXPLICIT completion (closedAt = completedAt /
// cancelledAt) with TWO independent freeze concepts:
//   • STRUCTURE FREEZE — at closedAt: the version pins (frozenAt set lazily),
//     definition changes stop appearing.
//   • ANSWER LOCK — closedAt + answerLockGraceMs (0 for coordination, 48h for
//     the tour summary): answers become immutable, the historical record.
// Between the two, a summary is structure-frozen yet still answer-editable.
//
// Status stays a lifecycle-independent flag: draft (never sent) / submitted
// (officially sent — still editable until the answer lock).
//
// Pure module (registry is DB-free) — unit-testable without a database.

import { getPurpose } from './registry.js';

export function purposeLifecycle(purposeKey) {
  const p = getPurpose(purposeKey);
  const tourOperational = !!p?.tourOperational;
  return {
    // Follow template.currentVersionId until the structure freeze.
    liveVersion: tourOperational,
    // Answer writes + re-submit allowed while status is submitted/reviewed.
    editableAfterSubmit: tourOperational,
    answerLockGraceMs: tourOperational ? (p.answerLockGraceMs ?? 0) : 0,
  };
}

// row: { purpose, status, frozenAt } + closedAt (Date|null — when the tour
// completed/cancelled; null while it is still live).
export function submissionLifecycle(row, closedAt = null, nowMs = Date.now()) {
  const { liveVersion, editableAfterSubmit, answerLockGraceMs } = purposeLifecycle(row.purpose);

  if (!liveVersion) {
    // Classic family: pinned at start, immutable after submit.
    const editable = row.status === 'draft';
    return {
      liveVersion, editableAfterSubmit,
      structureFrozen: row.status !== 'draft',
      answersLocked: row.status !== 'draft',
      editable, closedAt: null, lockAt: null,
    };
  }

  const closedMs = closedAt ? new Date(closedAt).getTime() : null;
  const lockAtMs = closedMs != null ? closedMs + answerLockGraceMs : null;
  const answersLocked = lockAtMs != null && nowMs >= lockAtMs;
  const structureFrozen = !!row.frozenAt || closedMs != null;
  const statusEditable =
    row.status === 'draft' ||
    (editableAfterSubmit && (row.status === 'submitted' || row.status === 'reviewed'));
  return {
    liveVersion,
    editableAfterSubmit,
    structureFrozen,
    answersLocked,
    editable: !answersLocked && statusEditable,
    closedAt: closedMs != null ? new Date(closedMs) : null,
    lockAt: lockAtMs != null ? new Date(lockAtMs) : null,
  };
}
