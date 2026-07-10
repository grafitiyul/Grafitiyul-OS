import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSubmissionAnswers, sanitizeDraftAnswers, computeVisibility } from './validation.js';
import { validateAnswerValue, OTHER_PREFIX } from './types.js';

// Server-side validation pipeline — the authority (blueprint §9). Pure
// structure objects, no DB — same style as the tours catalog tests.

const q = (key, type, extra = {}) => ({
  key, type, label: { he: key }, required: false, sortOrder: extra.sortOrder ?? 0,
  config: null, visibleWhen: null, options: [], ...extra,
});

const structure = (questions, sectionExtra = {}) => ({
  sections: [{ key: 's1', title: { he: 'כללי' }, sortOrder: 0, visibleWhen: null, questions, ...sectionExtra }],
});

test('required visible question with no answer → required error', () => {
  const s = structure([q('name', 'text', { required: true })]);
  const r = validateSubmissionAnswers(s, {});
  assert.deepEqual(r.errors, [{ questionKey: 'name', code: 'required' }]);
});

test('required question HIDDEN by a condition is NOT enforced and its answer is dropped', () => {
  const s = structure([
    q('type', 'choice', { options: [{ value: 'tour', label: { he: 'סיור' } }, { value: 'workshop', label: { he: 'סדנה' } }], sortOrder: 0 }),
    q('workshop_notes', 'text', {
      required: true, sortOrder: 1,
      visibleWhen: { q: 'type', op: 'eq', value: 'workshop' },
    }),
  ]);
  // type=tour → workshop_notes hidden: no required error, stale answer dropped.
  const r = validateSubmissionAnswers(s, { type: 'tour', workshop_notes: 'stale text' });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.cleanAnswers, [{ key: 'type', value: 'tour' }]);
  // type=workshop → now visible and required.
  const r2 = validateSubmissionAnswers(s, { type: 'workshop' });
  assert.deepEqual(r2.errors, [{ questionKey: 'workshop_notes', code: 'required' }]);
});

test('hidden SECTION hides all its questions regardless of their own conditions', () => {
  const s = {
    sections: [
      { key: 'a', title: { he: 'א' }, sortOrder: 0, visibleWhen: null, questions: [q('flag', 'yesno')] },
      {
        key: 'b', title: { he: 'ב' }, sortOrder: 1,
        visibleWhen: { q: 'flag', op: 'eq', value: true },
        questions: [q('detail', 'text', { required: true })],
      },
    ],
  };
  const r = validateSubmissionAnswers(s, { flag: false, detail: 'x' });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.cleanAnswers, [{ key: 'flag', value: false }]);
  assert.deepEqual([...computeVisibility(s, { flag: true })], ['flag', 'detail']);
});

test('invalid answer types / unknown options are rejected with codes', () => {
  const s = structure([
    q('age', 'number', { sortOrder: 0 }),
    q('pick', 'choice', { sortOrder: 1, options: [{ value: 'a', label: { he: 'א' } }] }),
    q('email', 'email', { sortOrder: 2 }),
    q('when', 'date', { sortOrder: 3 }),
  ]);
  const r = validateSubmissionAnswers(s, { age: 'twenty', pick: 'zzz', email: 'not-an-email', when: '12/07/2026' });
  assert.deepEqual(
    r.errors.map((e) => `${e.questionKey}:${e.code}`).sort(),
    ['age:invalid_type', 'email:invalid_email', 'pick:unknown_option', 'when:invalid_date'],
  );
});

test('valid submission returns cleanAnswers only for visible answerable questions', () => {
  const s = structure([
    q('name', 'text', { required: true, sortOrder: 0 }),
    q('note', 'static_text', { sortOrder: 1 }),
    q('rating', 'rating', { sortOrder: 2 }),
  ]);
  const r = validateSubmissionAnswers(s, { name: 'דנה', rating: 4, note: 'must be ignored', ghost: 'dropped' });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.cleanAnswers, [{ key: 'name', value: 'דנה' }, { key: 'rating', value: 4 }]);
});

test('multi: option membership, duplicates, min/max selections', () => {
  const opts = ['a', 'b', 'c'].map((v) => ({ value: v, label: { he: v } }));
  const mq = q('m', 'multi', { options: opts, config: { minSelections: 2 } });
  assert.equal(validateAnswerValue(['a', 'b'], mq), null);
  assert.equal(validateAnswerValue(['a'], mq), 'too_few_selections');
  assert.equal(validateAnswerValue(['a', 'a'], mq), 'duplicate_values');
  assert.equal(validateAnswerValue(['a', 'z'], mq), 'unknown_option');
  assert.equal(validateAnswerValue('a', mq), 'invalid_type');
});

test('allowOther: sentinel value accepted only when enabled and non-blank', () => {
  const base = { options: [{ value: 'a', label: { he: 'א' } }] };
  const strict = q('c1', 'choice', base);
  const open = q('c2', 'choice', { ...base, config: { allowOther: true } });
  assert.equal(validateAnswerValue(`${OTHER_PREFIX}משהו אחר`, strict), 'other_not_allowed');
  assert.equal(validateAnswerValue(`${OTHER_PREFIX}משהו אחר`, open), null);
  assert.equal(validateAnswerValue(`${OTHER_PREFIX}   `, open), 'other_text_required');
});

test('scale / rating / slider ranges honour config', () => {
  assert.equal(validateAnswerValue(10, q('s', 'scale')), null);
  assert.equal(validateAnswerValue(11, q('s', 'scale')), 'out_of_range');
  assert.equal(validateAnswerValue(7, q('s', 'scale', { config: { scaleMin: 1, scaleMax: 7 } })), null);
  assert.equal(validateAnswerValue(6, q('r', 'rating')), 'out_of_range');
  assert.equal(validateAnswerValue(150, q('sl', 'slider')), 'above_max');
  assert.equal(validateAnswerValue(150, q('sl', 'slider', { config: { max: 200 } })), null);
});

test('yesno accepts only real booleans', () => {
  assert.equal(validateAnswerValue(true, q('y', 'yesno')), null);
  assert.equal(validateAnswerValue('yes', q('y', 'yesno')), 'invalid_type');
});

test('time/datetime/phone/url validators', () => {
  assert.equal(validateAnswerValue('09:30', q('t', 'time')), null);
  assert.equal(validateAnswerValue('25:00', q('t', 'time')), 'invalid_time');
  assert.equal(validateAnswerValue('2026-07-12T09:30:00.000Z', q('dt', 'datetime')), null);
  assert.equal(validateAnswerValue('050-1234567', q('p', 'phone')), null);
  assert.equal(validateAnswerValue('123', q('p', 'phone')), 'invalid_phone');
  assert.equal(validateAnswerValue('https://gos.example', q('u', 'url')), null);
  assert.equal(validateAnswerValue('javascript:alert(1)', q('u', 'url')), 'invalid_url');
});

test('sanitizeDraftAnswers: keeps known keys, deletes empties, drops junk shapes', () => {
  const s = structure([q('name', 'text'), q('m', 'multi', { options: [{ value: 'a', label: { he: 'א' } }] })]);
  const { accepted, removed } = sanitizeDraftAnswers(s, {
    name: 'רות',
    m: ['a'],
    ghost: 'unknown key',
    name2: { nested: 'object' },
    cleared: '',
  });
  assert.deepEqual(accepted, { name: 'רות', m: ['a'] });
  assert.deepEqual(removed, []);
  const second = sanitizeDraftAnswers(s, { name: '' });
  assert.deepEqual(second.removed, ['name']);
});
