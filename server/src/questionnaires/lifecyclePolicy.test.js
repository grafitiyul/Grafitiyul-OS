import { test } from 'node:test';
import assert from 'node:assert/strict';
import { purposeLifecycle, submissionLifecycle } from './lifecyclePolicy.js';

// The decision table behind the two lifecycle families:
//   classic (general): pin at start, immutable after submit
//   tour-operational (coordination / tour_summary): live definition +
//   editable after submit, until frozenAt marks the historical freeze.

test('general purpose keeps the classic lifecycle', () => {
  const p = purposeLifecycle('general');
  assert.equal(p.liveVersion, false);
  assert.equal(p.editableAfterSubmit, false);

  assert.equal(submissionLifecycle({ purpose: 'general', status: 'draft', frozenAt: null }).editable, true);
  assert.equal(submissionLifecycle({ purpose: 'general', status: 'submitted', frozenAt: null }).editable, false);
});

test('tour-operational purposes follow the live definition and stay editable after submit', () => {
  for (const purpose of ['tour_summary', 'coordination']) {
    const p = purposeLifecycle(purpose);
    assert.equal(p.liveVersion, true, purpose);
    assert.equal(p.editableAfterSubmit, true, purpose);

    const draft = submissionLifecycle({ purpose, status: 'draft', frozenAt: null });
    assert.deepEqual(
      { frozen: draft.frozen, editable: draft.editable },
      { frozen: false, editable: true },
    );

    const submitted = submissionLifecycle({ purpose, status: 'submitted', frozenAt: null });
    assert.equal(submitted.editable, true, `${purpose}: submitted stays editable`);
    assert.equal(submitted.frozen, false);
  }
});

test('frozenAt ends everything — no edits in any status', () => {
  for (const status of ['draft', 'submitted', 'reviewed']) {
    const lc = submissionLifecycle({ purpose: 'tour_summary', status, frozenAt: new Date() });
    assert.equal(lc.frozen, true, status);
    assert.equal(lc.editable, false, status);
  }
});

test('void submissions are never editable', () => {
  assert.equal(
    submissionLifecycle({ purpose: 'tour_summary', status: 'void', frozenAt: null }).editable,
    false,
  );
});

test('unknown purpose falls back to the classic lifecycle', () => {
  const p = purposeLifecycle('does_not_exist');
  assert.equal(p.liveVersion, false);
  assert.equal(p.editableAfterSubmit, false);
});
