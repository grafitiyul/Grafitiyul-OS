import test from 'node:test';
import assert from 'node:assert/strict';
import { validateVersionForPublish } from './publishRules.js';
import { cloneStructureForNewVersion, buildQuestionSnapshot, buildSingletonKey, flatQuestions } from './structure.js';

// Publish-time gate + structure helpers (blueprint §6–§7, §10).

const template = { defaultLanguage: 'he', title: { he: 'טופס' } };

const opt = (value, he) => ({ value, label: { he }, sortOrder: 0 });
const q = (key, type, extra = {}) => ({
  key, type, label: { he: key }, helpText: null, placeholder: null,
  required: false, sortOrder: extra.sortOrder ?? 0, config: null,
  visibleWhen: null, options: [], ...extra,
});
const structureOf = (questions) => ({
  sections: [{ key: 's1', title: { he: 'כללי' }, sortOrder: 0, visibleWhen: null,
    collapsible: false, collapsedByDefault: false, description: null, questions }],
});

const codes = (errs) => errs.map((e) => e.code);

test('valid single-section version publishes clean', () => {
  const s = structureOf([
    q('name', 'text', { required: true, sortOrder: 0 }),
    q('kind', 'choice', { sortOrder: 1, options: [opt('a', 'א'), opt('b', 'ב')] }),
    q('why', 'textarea', { sortOrder: 2, visibleWhen: { q: 'kind', op: 'eq', value: 'b' } }),
  ]);
  assert.deepEqual(validateVersionForPublish({ template, structure: s }), []);
});

test('empty version / empty template title are rejected', () => {
  assert.ok(codes(validateVersionForPublish({ template, structure: { sections: [] } })).includes('no_sections'));
  const errs = validateVersionForPublish({
    template: { defaultLanguage: 'he', title: {} },
    structure: structureOf([q('a', 'text')]),
  });
  assert.ok(codes(errs).includes('template_title_missing_default_language'));
});

test('choice without options and unknown type are rejected', () => {
  const errs = validateVersionForPublish({
    template,
    structure: structureOf([q('c', 'choice'), q('x', 'hologram')]),
  });
  assert.ok(codes(errs).includes('options_required'));
  assert.ok(codes(errs).includes('unknown_question_type'));
});

test('default-language completeness: labels and option labels must carry he', () => {
  const errs = validateVersionForPublish({
    template,
    structure: structureOf([
      q('a', 'text', { label: { en: 'English only' } }),
      q('c', 'choice', { options: [{ value: 'v', label: { en: 'EN' }, sortOrder: 0 }] }),
    ]),
  });
  assert.ok(codes(errs).includes('question_label_missing_default_language'));
  assert.ok(codes(errs).includes('option_label_missing_default_language'));
});

test('FORWARD condition reference is rejected (backward-only ⇒ acyclic)', () => {
  const s = structureOf([
    q('first', 'text', { sortOrder: 0, visibleWhen: { q: 'second', op: 'answered' } }),
    q('second', 'text', { sortOrder: 1 }),
  ]);
  const errs = validateVersionForPublish({ template, structure: s });
  assert.equal(errs.filter((e) => e.code === 'invalid_condition').length, 1);
  assert.match(errs.find((e) => e.code === 'invalid_condition').detail, /forward_or_unknown_ref:second/);
});

test('self-reference (cycle of one) is rejected', () => {
  const s = structureOf([q('a', 'text', { visibleWhen: { q: 'a', op: 'answered' } })]);
  const errs = validateVersionForPublish({ template, structure: s });
  assert.ok(codes(errs).includes('invalid_condition'));
});

test('a MUTUAL cycle across two questions is impossible to publish', () => {
  const s = structureOf([
    q('a', 'text', { sortOrder: 0, visibleWhen: { q: 'b', op: 'answered' } }),
    q('b', 'text', { sortOrder: 1, visibleWhen: { q: 'a', op: 'answered' } }),
  ]);
  // b→a is legal (backward); a→b is the forward edge that gets rejected —
  // so at least one edge of any would-be cycle always fails.
  const errs = validateVersionForPublish({ template, structure: s });
  assert.equal(errs.filter((e) => e.code === 'invalid_condition').length, 1);
});

test('section condition may reference only EARLIER sections', () => {
  const s = {
    sections: [
      { key: 'a', title: { he: 'א' }, sortOrder: 0, visibleWhen: null, questions: [q('flag', 'yesno')] },
      {
        key: 'b', title: { he: 'ב' }, sortOrder: 1,
        visibleWhen: { q: 'flag', op: 'eq', value: true },
        questions: [q('own', 'text', { sortOrder: 0 })],
      },
      {
        key: 'c', title: { he: 'ג' }, sortOrder: 2,
        // references a question inside itself → rejected
        visibleWhen: { q: 'inner', op: 'answered' },
        questions: [q('inner', 'text')],
      },
    ],
  };
  const errs = validateVersionForPublish({ template, structure: s });
  const conditionErrs = errs.filter((e) => e.code === 'invalid_condition');
  assert.equal(conditionErrs.length, 1);
  assert.equal(conditionErrs[0].sectionKey, 'c');
});

test('duplicate question keys / duplicate option values are rejected', () => {
  const errs = validateVersionForPublish({
    template,
    structure: structureOf([
      q('same', 'text', { sortOrder: 0 }),
      q('same', 'text', { sortOrder: 1 }),
      q('c', 'choice', { sortOrder: 2, options: [opt('v', 'א'), opt('v', 'ב')] }),
    ]),
  });
  assert.ok(codes(errs).includes('duplicate_question_key'));
  assert.ok(codes(errs).includes('duplicate_option_value'));
});

// ── structure helpers ────────────────────────────────────────────────────────

test('cloneStructureForNewVersion preserves keys/order/conditions, carries no ids', () => {
  const s = structureOf([
    q('name', 'text', { sortOrder: 0, id: 'q_row_1' }),
    q('kind', 'choice', { sortOrder: 1, id: 'q_row_2', options: [{ ...opt('a', 'א'), id: 'o1' }] }),
  ]);
  s.sections[0].id = 'sec_row_1';
  const clone = cloneStructureForNewVersion(s);
  assert.equal(clone.length, 1);
  assert.equal(clone[0].id, undefined);
  assert.equal(clone[0].key, 's1');
  assert.deepEqual(clone[0].questions.map((x) => x.key), ['name', 'kind']);
  assert.equal(clone[0].questions[0].id, undefined);
  assert.equal(clone[0].questions[1].options[0].id, undefined);
  assert.equal(clone[0].questions[1].options[0].value, 'a');
  // Mutating the clone never touches the source (frozen versions stay frozen).
  clone[0].questions[0].key = 'renamed';
  assert.equal(flatQuestions(s)[0].key, 'name');
});

test('buildQuestionSnapshot freezes the resolved single-language view', () => {
  const s = structureOf([
    q('kind', 'choice', {
      label: { he: 'סוג פעילות', en: 'Activity type' },
      helpText: { he: 'בחרו אחד' },
      options: [opt('a', 'סיור'), opt('b', 'סדנה')],
    }),
  ]);
  const question = flatQuestions(s)[0];
  const snap = buildQuestionSnapshot(question, 'he', 'he');
  assert.equal(snap.label, 'סוג פעילות');
  assert.equal(snap.helpText, 'בחרו אחד');
  assert.equal(snap.sectionTitle, 'כללי');
  assert.deepEqual(snap.options, [{ value: 'a', label: 'סיור' }, { value: 'b', label: 'סדנה' }]);
  const snapEn = buildQuestionSnapshot(question, 'en', 'he');
  assert.equal(snapEn.label, 'Activity type');
  // en missing on options → falls back to he, never blank.
  assert.equal(snapEn.options[0].label, 'סיור');
});

test('buildSingletonKey: subject-bound only', () => {
  assert.equal(
    buildSingletonKey({ subjectType: 'booking', subjectId: 'b1', purpose: 'coordination' }),
    'booking:b1:coordination',
  );
  assert.equal(buildSingletonKey({ subjectType: null, subjectId: null, purpose: 'general' }), null);
});
