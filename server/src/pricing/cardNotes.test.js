// Card first-line note application — pure unit tests (node:test, no DB).
//
// Contract under test (cardNotes.js): during (re)generation each Pricing Card's
// firstLineNote lands ONLY on the first output line produced by that card;
// other lines of the same card get an empty note; lines without card
// provenance are never touched; blank templates (incl. empty rich markup)
// produce no note.

import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCardFirstLineNotes, richTextIsEmpty, normalizeFirstLineNote } from './cardNotes.js';

const line = (id, cardGroupId, note = '') => ({ id, sourceCardGroupId: cardGroupId, note });

test('richTextIsEmpty: blank / empty markup / &nbsp; are empty, content is not', () => {
  assert.equal(richTextIsEmpty(null), true);
  assert.equal(richTextIsEmpty(''), true);
  assert.equal(richTextIsEmpty('<p></p>'), true);
  assert.equal(richTextIsEmpty('<p>&nbsp;</p>\n<p> </p>'), true);
  assert.equal(richTextIsEmpty('<p>הערה</p>'), false);
  assert.equal(richTextIsEmpty('note'), false);
});

test('normalizeFirstLineNote: blank markup stores as null, content passes through', () => {
  assert.equal(normalizeFirstLineNote('<p></p>'), null);
  assert.equal(normalizeFirstLineNote(''), null);
  assert.equal(normalizeFirstLineNote(undefined), null);
  assert.equal(normalizeFirstLineNote('<p>שימו לב</p>'), '<p>שימו לב</p>');
});

// Scenario 1 — a card that produces ONE line: that line gets the note.
test('single line from a card receives the card note', () => {
  const out = applyCardFirstLineNotes([line('a', 'card1')], new Map([['card1', '<p>הערה</p>']]));
  assert.equal(out[0].note, '<p>הערה</p>');
});

// Scenario 2 — a card producing MULTIPLE lines: note on its FIRST line only.
test('multi-line card: note only on the first line, others emptied', () => {
  const out = applyCardFirstLineNotes(
    [line('a', 'card1', 'stale'), line('b', 'card1', 'stale'), line('c', 'card1', 'stale')],
    new Map([['card1', '<p>הערה</p>']]),
  );
  assert.deepEqual(out.map((l) => l.note), ['<p>הערה</p>', '', '']);
});

// Scenario 3 — multiple cards in one result: each note goes only to the first
// line of ITS OWN card, never to another card's lines.
test('multiple cards: each card notes its own first line only', () => {
  const out = applyCardFirstLineNotes(
    [line('a1', 'cardA'), line('a2', 'cardA'), line('b1', 'cardB'), line('b2', 'cardB')],
    new Map([
      ['cardA', '<p>הערת A</p>'],
      ['cardB', '<p>הערת B</p>'],
    ]),
  );
  assert.deepEqual(out.map((l) => l.note), ['<p>הערת A</p>', '', '<p>הערת B</p>', '']);
});

// Interleaved order — "first" is by OUTPUT order per card, deterministic.
test('interleaved cards: first occurrence per card wins, order preserved', () => {
  const out = applyCardFirstLineNotes(
    [line('b1', 'cardB'), line('a1', 'cardA'), line('b2', 'cardB'), line('a2', 'cardA')],
    new Map([
      ['cardA', 'A'],
      ['cardB', 'B'],
    ]),
  );
  assert.deepEqual(out.map((l) => [l.id, l.note]), [['b1', 'B'], ['a1', 'A'], ['b2', ''], ['a2', '']]);
});

// Scenario 4 — empty/blank template: no note (stale notes are still cleared).
test('empty template leaves the line note empty and clears stale notes', () => {
  const out = applyCardFirstLineNotes(
    [line('a', 'card1', '<p>ישן</p>'), line('b', 'card1', 'old')],
    new Map([['card1', '<p></p>']]),
  );
  assert.deepEqual(out.map((l) => l.note), ['', '']);
  const noEntry = applyCardFirstLineNotes([line('a', 'card1', 'old')], new Map());
  assert.equal(noEntry[0].note, '');
});

// Scenario 5 — multiline Hebrew rich text survives byte-exact (incl. blank lines).
test('multiline Hebrew note applied byte-exact', () => {
  const note = '<p>שורה ראשונה</p><p></p><p>שורה שלישית — English too</p>';
  const out = applyCardFirstLineNotes([line('a', 'card1')], new Map([['card1', note]]));
  assert.equal(out[0].note, note);
});

// Lines with NO card provenance (manual/addon/discount) are never touched.
test('non-card lines pass through untouched (same reference)', () => {
  const manual = { id: 'm', sourceCardGroupId: null, note: '<p>הערה ידנית</p>' };
  const out = applyCardFirstLineNotes([manual, line('a', 'card1')], new Map([['card1', 'x']]));
  assert.equal(out[0], manual);
  assert.equal(out[0].note, '<p>הערה ידנית</p>');
  assert.equal(out[1].note, 'x');
});
