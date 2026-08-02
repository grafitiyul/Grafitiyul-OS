import test from 'node:test';
import assert from 'node:assert/strict';
import { purposeAllowsLiveEdit, listPurposes } from './registry.js';
import { buildQuestionSnapshot } from './structure.js';
import { renderSubmissionAnswers } from './service.js';

// ONE LIVE FORM for the two operational questionnaires.
//
// The business claim being tested: an operator can edit a live questionnaire
// freely, and every previously submitted response still reads exactly as it did
// the day it was filed. That safety does NOT come from version immutability —
// it comes from the per-answer snapshot, which is what these tests pin down.

test('exactly the two operational questionnaires are live-edit', () => {
  assert.equal(purposeAllowsLiveEdit('tour_summary'), true);
  assert.equal(purposeAllowsLiveEdit('coordination'), true);
  // The generic engine keeps the full draft → publish lifecycle.
  assert.equal(purposeAllowsLiveEdit('general'), false);
  assert.equal(purposeAllowsLiveEdit('nonsense'), false);
});

test('no purpose is accidentally live-edit', () => {
  const live = listPurposes().filter((p) => p.liveEdit).map((p) => p.key).sort();
  assert.deepEqual(live, ['coordination', 'tour_summary']);
});

// ── the historical-integrity guarantee ───────────────────────────────────────

const question = (over = {}) => ({
  key: 'q_aaaaaaaa',
  type: 'choice',
  label: { he: 'איך היה הסיור?', en: 'How was the tour?' },
  helpText: { he: 'עזרה מקורית' },
  placeholder: null,
  required: true,
  config: { summaryRole: 'overall' },
  section: { key: 's1', title: { he: 'סיכום' } },
  options: [
    { value: 'o_11111111', label: { he: 'מצוין' } },
    { value: 'o_22222222', label: { he: 'בסדר' } },
  ],
  ...over,
});

test('a submitted answer carries EVERYTHING needed to re-render it', () => {
  // This is the whole basis for live editing: if the snapshot were partial,
  // history would depend on the live tree and editing would rewrite the past.
  const snap = buildQuestionSnapshot(question(), 'he', 'he');
  for (const field of ['key', 'type', 'label', 'helpText', 'required', 'config', 'sectionKey', 'sectionTitle', 'options']) {
    assert.ok(field in snap, `snapshot is missing ${field}`);
  }
  assert.equal(snap.label, 'איך היה הסיור?');
  assert.equal(snap.sectionTitle, 'סיכום');
  assert.deepEqual(snap.options.map((o) => o.label), ['מצוין', 'בסדר']);
});

test('rewording a live question does NOT change an already-submitted answer', () => {
  const submitted = {
    answers: [{
      questionKey: 'q_aaaaaaaa',
      value: 'o_11111111',
      sortOrder: 0,
      // Frozen at submit, from the question AS IT WAS.
      questionSnapshot: buildQuestionSnapshot(question(), 'he', 'he'),
    }],
  };

  // The operator now rewrites the question and both option labels on the LIVE
  // form. The stored snapshot is untouched — that is the point.
  const rendered = renderSubmissionAnswers(submitted);
  assert.equal(rendered[0].label, 'איך היה הסיור?');
  assert.equal(rendered[0].display, 'מצוין', 'the answer renders with the ORIGINAL option label');
});

test('deleting a question from the live form does not erase its historical answer', () => {
  // A question that no longer exists anywhere in the live tree still renders,
  // because the answer carries its own snapshot.
  const submitted = {
    answers: [{
      questionKey: 'q_deleted1',
      value: 'תשובה היסטורית',
      sortOrder: 0,
      questionSnapshot: buildQuestionSnapshot(
        question({ key: 'q_deleted1', type: 'textarea', options: [], label: { he: 'שאלה שנמחקה' } }),
        'he', 'he',
      ),
    }],
  };
  const rendered = renderSubmissionAnswers(submitted);
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].label, 'שאלה שנמחקה');
  assert.equal(rendered[0].display, 'תשובה היסטורית');
});

test('an answer with no snapshot is omitted rather than rendered wrong', () => {
  // Better a gap than a historical answer displayed under a question it was
  // never asked under.
  const rendered = renderSubmissionAnswers({
    answers: [{ questionKey: 'q_x', value: 'v', questionSnapshot: null }],
  });
  assert.deepEqual(rendered, []);
});

test('answers render in their FROZEN order, not the live form order', () => {
  const submitted = {
    answers: [
      { questionKey: 'q_b', value: 'שני', sortOrder: 1, questionSnapshot: buildQuestionSnapshot(question({ key: 'q_b', type: 'textarea', options: [], label: { he: 'ב' } }), 'he', 'he') },
      { questionKey: 'q_a', value: 'ראשון', sortOrder: 0, questionSnapshot: buildQuestionSnapshot(question({ key: 'q_a', type: 'textarea', options: [], label: { he: 'א' } }), 'he', 'he') },
    ],
  };
  assert.deepEqual(renderSubmissionAnswers(submitted).map((r) => r.display), ['ראשון', 'שני']);
});
