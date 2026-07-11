import { test } from 'node:test';
import assert from 'node:assert/strict';
import { purposeLifecycle, submissionLifecycle, liveVersionSyncPatch } from './lifecyclePolicy.js';
import { SUMMARY_POST_COMPLETION_EDIT_MS } from './registry.js';

// The decision table behind the lifecycle families. Tour-operational purposes
// separate TWO freeze concepts anchored on the tour's closedAt:
//   structure freeze — at closedAt (definition pins)
//   answer lock      — closedAt + answerLockGraceMs (0 coordination / 48h summary)

const NOW = Date.parse('2026-07-20T12:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 60 * 60 * 1000);

test('general purpose keeps the classic lifecycle (pin at start, immutable after submit)', () => {
  const p = purposeLifecycle('general');
  assert.equal(p.liveVersion, false);
  assert.equal(p.editableAfterSubmit, false);

  assert.equal(submissionLifecycle({ purpose: 'general', status: 'draft', frozenAt: null }, null, NOW).editable, true);
  const submitted = submissionLifecycle({ purpose: 'general', status: 'submitted', frozenAt: null }, null, NOW);
  assert.equal(submitted.editable, false);
  assert.equal(submitted.answersLocked, true);
});

test('open tour: live definition, editable in draft AND submitted, nothing frozen', () => {
  for (const purpose of ['tour_summary', 'coordination']) {
    for (const status of ['draft', 'submitted']) {
      const lc = submissionLifecycle({ purpose, status, frozenAt: null }, null, NOW);
      assert.equal(lc.liveVersion, true, `${purpose}/${status}`);
      assert.equal(lc.structureFrozen, false);
      assert.equal(lc.answersLocked, false);
      assert.equal(lc.editable, true);
    }
  }
});

test('coordination: tour completion freezes structure AND locks answers at once (grace 0)', () => {
  const lc = submissionLifecycle(
    { purpose: 'coordination', status: 'submitted', frozenAt: null },
    hoursAgo(0.01),
    NOW,
  );
  assert.equal(lc.structureFrozen, true);
  assert.equal(lc.answersLocked, true);
  assert.equal(lc.editable, false);
});

test('tour summary: structure frozen at completion, answers stay editable through the 48h window', () => {
  assert.equal(purposeLifecycle('tour_summary').answerLockGraceMs, SUMMARY_POST_COMPLETION_EDIT_MS);

  const inWindow = submissionLifecycle(
    { purpose: 'tour_summary', status: 'submitted', frozenAt: new Date(NOW - 1000) },
    hoursAgo(24),
    NOW,
  );
  assert.equal(inWindow.structureFrozen, true, 'definition is pinned');
  assert.equal(inWindow.answersLocked, false, 'answers still editable inside 48h');
  assert.equal(inWindow.editable, true);
  assert.equal(inWindow.lockAt.getTime(), hoursAgo(24).getTime() + SUMMARY_POST_COMPLETION_EDIT_MS);

  const pastWindow = submissionLifecycle(
    { purpose: 'tour_summary', status: 'submitted', frozenAt: new Date(NOW - 1000) },
    hoursAgo(49),
    NOW,
  );
  assert.equal(pastWindow.answersLocked, true, 'locked after 48h');
  assert.equal(pastWindow.editable, false);
});

test('a draft summary inside the window is still editable; void never is', () => {
  const draft = submissionLifecycle(
    { purpose: 'tour_summary', status: 'draft', frozenAt: null },
    hoursAgo(1),
    NOW,
  );
  assert.equal(draft.editable, true);

  const voided = submissionLifecycle(
    { purpose: 'tour_summary', status: 'void', frozenAt: null },
    null,
    NOW,
  );
  assert.equal(voided.editable, false);
});

test('unknown purpose falls back to the classic lifecycle', () => {
  const p = purposeLifecycle('does_not_exist');
  assert.equal(p.liveVersion, false);
  assert.equal(p.editableAfterSubmit, false);
});

// ── live-version follow (the current-version resolution for open drafts) ────
// Regression for the "one-question Tour Summary" production gap: a draft
// started on an OLD version must resolve to the template's CURRENT published
// version on load, as long as the tour has not reached the structure freeze.
// (Answers are keyed by questionKey and are never part of the sync patch —
// compatible answers survive the upgrade by construction.)

test('draft on an old version follows the current published version while the tour is open', () => {
  const row = { versionId: 'v1', language: 'he' };
  const template = { currentVersionId: 'v2', defaultLanguage: 'he' };
  assert.deepEqual(liveVersionSyncPatch(row, template), { versionId: 'v2' });

  // Already current → nothing to sync (no writes on a clean read).
  assert.deepEqual(
    liveVersionSyncPatch({ versionId: 'v2', language: 'he' }, template),
    {},
  );
});

test('legacy customer-language rows normalize to the template language on the same sync', () => {
  const patch = liveVersionSyncPatch(
    { versionId: 'v1', language: 'en' },
    { currentVersionId: 'v2', defaultLanguage: 'he' },
  );
  assert.deepEqual(patch, { versionId: 'v2', language: 'he' });
});

test('freeze-path sync (includeVersion:false) normalizes ONLY the language — the version pin never jumps', () => {
  // RTL regression: a legacy 'en' internal form read for the FIRST time after
  // the tour closed must still normalize to the template language before its
  // snapshots freeze — but must NOT jump to a version published while open.
  const patch = liveVersionSyncPatch(
    { versionId: 'v1', language: 'en' },
    { currentVersionId: 'v2', defaultLanguage: 'he' },
    { includeVersion: false },
  );
  assert.deepEqual(patch, { language: 'he' });

  // Correct-language row at freeze time → nothing to write.
  assert.deepEqual(
    liveVersionSyncPatch(
      { versionId: 'v1', language: 'he' },
      { currentVersionId: 'v2', defaultLanguage: 'he' },
      { includeVersion: false },
    ),
    {},
  );
});

test('a template without a published version never produces a version sync', () => {
  assert.deepEqual(
    liveVersionSyncPatch({ versionId: 'v1', language: 'he' }, { currentVersionId: null, defaultLanguage: 'he' }),
    {},
  );
  assert.deepEqual(liveVersionSyncPatch({ versionId: 'v1', language: 'he' }, null), {});
});

test('after the structure freeze the lifecycle reports frozen — sync is not consulted', () => {
  // applyLifecycle only calls liveVersionSyncPatch while frozenAt is null;
  // this asserts the flag that gates it.
  const lc = submissionLifecycle(
    { purpose: 'tour_summary', status: 'draft', frozenAt: new Date(NOW - 1000) },
    hoursAgo(1),
    NOW,
  );
  assert.equal(lc.structureFrozen, true);
});
