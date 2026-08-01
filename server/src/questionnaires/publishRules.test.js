import test from 'node:test';
import assert from 'node:assert/strict';
import { validateVersionForPublish, blockingProblems } from './publishRules.js';
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

test('placeholder: snapshot resolves per language with default-language fallback', () => {
  const s = structureOf([
    q('company', 'text', {
      label: { he: 'שם החברה', en: 'Company name' },
      helpText: { he: 'נא לכתוב את השם הרשמי' },
      placeholder: { he: 'לדוגמה: חברת ישראל בע״מ', en: 'e.g. Israel Ltd' },
    }),
    q('notes', 'textarea', { placeholder: { he: 'פרטים נוספים' } }),
    q('legacy', 'text'),
  ]);
  const [company, notes, legacy] = flatQuestions(s);
  const he = buildQuestionSnapshot(company, 'he', 'he');
  assert.equal(he.placeholder, 'לדוגמה: חברת ישראל בע״מ');
  // helpText and placeholder are SEPARATE snapshot fields — not overloaded.
  assert.equal(he.helpText, 'נא לכתוב את השם הרשמי');
  assert.equal(buildQuestionSnapshot(company, 'en', 'he').placeholder, 'e.g. Israel Ltd');
  // en missing → default-language fallback, never blank.
  assert.equal(buildQuestionSnapshot(notes, 'en', 'he').placeholder, 'פרטים נוספים');
  // Questions predating the field stay null — old data keeps working.
  assert.equal(buildQuestionSnapshot(legacy, 'he', 'he').placeholder, null);
});

test('placeholder: version clone carries the full localized map', () => {
  const s = structureOf([
    q('company', 'text', { placeholder: { he: 'לדוגמה', en: 'e.g.' } }),
    q('legacy', 'text'),
  ]);
  const clone = cloneStructureForNewVersion(s);
  assert.deepEqual(clone[0].questions[0].placeholder, { he: 'לדוגמה', en: 'e.g.' });
  assert.equal(clone[0].questions[1].placeholder, null);
});

test('buildSingletonKey: subject-bound only', () => {
  assert.equal(
    buildSingletonKey({ subjectType: 'booking', subjectId: 'b1', purpose: 'coordination' }),
    'booking:b1:coordination',
  );
  assert.equal(buildSingletonKey({ subjectType: null, subjectId: null, purpose: 'general' }), null);
});

// ── Automation key protection ────────────────────────────────────────────────
// Question keys are generated once and preserved across version clones, so
// wording and ordering are free to change. The ONE action that destroys a key
// is deleting a question and re-adding it — which used to silently stop every
// automation bound to it, with no error anywhere. This is that gate.

const AUT = (autId, nameHe = 'אוטומציה') => ({ autId, nameHe });

const guard = ({ questions = [], options = [], flagged = [] } = {}) => ({
  referencedQuestions: new Map(questions),
  referencedOptions: new Map(options),
  flaggedQuestionKeys: new Set(flagged),
});

const autCodes = (problems) => problems.map((p) => p.code).filter((c) => c.startsWith('automation_'));

test('automation guard: a key a live automation depends on cannot be dropped', () => {
  const problems = validateVersionForPublish({
    template,
    structure: structureOf([q('q_bbbbbbbb', 'text')]),
    automation: guard({ questions: [['q_aaaaaaaa', [AUT('AUT-004', 'שיחת תיאום בזמן')]]] }),
  });
  const hit = problems.find((p) => p.code === 'automation_question_removed');
  assert.ok(hit, 'expected the removal to be reported');
  assert.equal(hit.level, 'error');
  assert.equal(hit.questionKey, 'q_aaaaaaaa');
  // Naming the AUT ids is the point — the author must know WHICH break.
  assert.deepEqual(hit.automations.map((a) => a.autId), ['AUT-004']);
});

test('automation guard: a key still present publishes cleanly', () => {
  const problems = validateVersionForPublish({
    template,
    structure: structureOf([q('q_aaaaaaaa', 'text')]),
    automation: guard({ questions: [['q_aaaaaaaa', [AUT('AUT-004')]]] }),
  });
  assert.deepEqual(blockingProblems(problems), []);
});

test('automation guard: reordering and rewording never trip it', () => {
  // The whole promise of the architecture: content stays freely editable.
  const problems = validateVersionForPublish({
    template,
    structure: structureOf([
      q('q_bbbbbbbb', 'text', { sortOrder: 0, label: { he: 'שאלה אחרת לגמרי' } }),
      q('q_aaaaaaaa', 'text', { sortOrder: 1, label: { he: 'נוסח חדש לחלוטין' } }),
    ]),
    automation: guard({ questions: [['q_aaaaaaaa', [AUT('AUT-004')]]] }),
  });
  assert.deepEqual(blockingProblems(problems), []);
});

test('automation guard: a removed option value blocks publishing', () => {
  const problems = validateVersionForPublish({
    template,
    structure: structureOf([
      q('q_aaaaaaaa', 'choice', { options: [opt('o_11111111', 'כן')] }),
    ]),
    automation: guard({
      questions: [['q_aaaaaaaa', [AUT('AUT-004')]]],
      options: [['q_aaaaaaaa:o_22222222', [AUT('AUT-004')]]],
    }),
  });
  const hit = problems.find((p) => p.code === 'automation_option_removed');
  assert.ok(hit);
  assert.equal(hit.optionValue, 'o_22222222');
});

test('automation guard: renaming an option label keeps the key valid', () => {
  const problems = validateVersionForPublish({
    template,
    structure: structureOf([
      q('q_aaaaaaaa', 'choice', { options: [opt('o_11111111', 'בוצע בהחלט')] }),
    ]),
    automation: guard({
      questions: [['q_aaaaaaaa', [AUT('AUT-004')]]],
      options: [['q_aaaaaaaa:o_11111111', [AUT('AUT-004')]]],
    }),
  });
  assert.deepEqual(blockingProblems(problems), []);
});

test('automation guard: a deleted question is not ALSO reported as a missing option', () => {
  // One fault should read as one fault.
  const problems = validateVersionForPublish({
    template,
    structure: structureOf([q('q_zzzzzzzz', 'text')]),
    automation: guard({
      questions: [['q_aaaaaaaa', [AUT('AUT-004')]]],
      options: [['q_aaaaaaaa:o_11111111', [AUT('AUT-004')]]],
    }),
  });
  assert.deepEqual(autCodes(problems), ['automation_question_removed']);
});

test('automation guard: a FLAGGED question that disappears is a warning, not a block', () => {
  // Nothing depends on it yet — but the flag was a deliberate business decision
  // and must not vanish unnoticed.
  const problems = validateVersionForPublish({
    template,
    structure: structureOf([q('q_bbbbbbbb', 'text')]),
    automation: guard({ flagged: ['q_aaaaaaaa'] }),
  });
  const hit = problems.find((p) => p.code === 'automation_flagged_question_removed');
  assert.ok(hit);
  assert.equal(hit.level, 'warning');
  assert.deepEqual(blockingProblems(problems), []);
});

test('automation guard: a flagged key that is ALSO referenced blocks once, as an error', () => {
  const problems = validateVersionForPublish({
    template,
    structure: structureOf([q('q_bbbbbbbb', 'text')]),
    automation: guard({
      questions: [['q_aaaaaaaa', [AUT('AUT-004')]]],
      flagged: ['q_aaaaaaaa'],
    }),
  });
  assert.deepEqual(autCodes(problems), ['automation_question_removed']);
  assert.equal(blockingProblems(problems).length, 1);
});

test('automation guard: absent automation input changes nothing (Slice 0 with an empty registry)', () => {
  const problems = validateVersionForPublish({
    template,
    structure: structureOf([q('q_aaaaaaaa', 'text')]),
  });
  assert.deepEqual(blockingProblems(problems), []);
});

test('every problem carries an explicit level', () => {
  const problems = validateVersionForPublish({ template, structure: structureOf([]) });
  assert.ok(problems.length > 0);
  for (const p of problems) assert.ok(['error', 'warning'].includes(p.level), `${p.code} has no level`);
});
