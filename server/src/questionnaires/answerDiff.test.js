import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAnswerChanges } from './answerDiff.js';

// History payload builder: per-question old → new with display strings —
// the exact shape ChangeEventRow renders (fieldKey/labelHe/old*/new*).

const Q = (key, label, extra = {}) => ({
  key, type: 'text', label: { he: label }, options: [], ...extra,
});

const QUESTIONS = [
  Q('q_how', 'איך היה הסיור?'),
  Q('q_count', 'כמה משתתפים?'),
  Q('q_mood', 'אווירה', {
    type: 'radio',
    options: [
      { value: 'great', label: { he: 'מעולה' } },
      { value: 'ok', label: { he: 'בסדר' } },
    ],
  }),
  Q('q_tags', 'תגיות', {
    type: 'checkbox',
    options: [
      { value: 'a', label: { he: 'אלף' } },
      { value: 'b', label: { he: 'בית' } },
    ],
  }),
  { key: 'q_note', type: 'static_text', label: { he: 'טקסט קבוע' }, options: [] },
];

const diff = (prev, next) =>
  buildAnswerChanges({ prev, next, questions: QUESTIONS, lang: 'he', defLang: 'he' });

test('first submit: every filled answer is a change from empty', () => {
  const changes = diff({}, { q_how: 'מצוין', q_count: 12 });
  assert.equal(changes.length, 2);
  assert.deepEqual(changes[0], {
    fieldKey: 'q_how', labelHe: 'איך היה הסיור?',
    oldValue: null, newValue: 'מצוין', oldDisplay: null, newDisplay: 'מצוין',
  });
  assert.equal(changes[1].newDisplay, '12');
});

test('update: only ACTUALLY changed answers appear, with old → new', () => {
  const changes = diff(
    { q_how: 'טוב', q_count: 12 },
    { q_how: 'מצוין', q_count: 12 },
  );
  assert.equal(changes.length, 1);
  assert.equal(changes[0].fieldKey, 'q_how');
  assert.equal(changes[0].oldDisplay, 'טוב');
  assert.equal(changes[0].newDisplay, 'מצוין');
});

test('no changes → empty diff (a no-op press creates no history)', () => {
  assert.equal(diff({ q_how: 'טוב' }, { q_how: 'טוב' }).length, 0);
});

test('option values render as their Hebrew labels; arrays join', () => {
  const changes = diff({}, { q_mood: 'great', q_tags: ['a', 'b'] });
  assert.equal(changes.find((c) => c.fieldKey === 'q_mood').newDisplay, 'מעולה');
  assert.equal(changes.find((c) => c.fieldKey === 'q_tags').newDisplay, 'אלף · בית');
});

test('cleared answers appear as value → empty; static text never diffs', () => {
  const changes = diff({ q_how: 'טוב', q_note: 'junk' }, {});
  assert.equal(changes.length, 1);
  assert.equal(changes[0].fieldKey, 'q_how');
  assert.equal(changes[0].newValue, null);
  assert.equal(changes[0].newDisplay, null);
});
