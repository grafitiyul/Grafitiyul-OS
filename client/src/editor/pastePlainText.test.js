import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plainTextToParagraphs } from './pastePlainText.js';

// The text/plain paste contract (the editor's clipboardTextParser follows
// this exactly): blank line = paragraph break, extras = empty paragraphs,
// single \n = soft line break — NEVER one paragraph per line.

test('paragraphs split on blank lines; single newlines stay inside the paragraph', () => {
  assert.deepEqual(
    plainTextToParagraphs('שלום רב,\nרצינו לבדוק לגבי הסיור.\n\nתודה,\nורד'),
    [['שלום רב,', 'רצינו לבדוק לגבי הסיור.'], ['תודה,', 'ורד']],
  );
});

test('a single line pastes as one paragraph (merges inline at the cursor)', () => {
  assert.deepEqual(plainTextToParagraphs('טקסט קצר'), [['טקסט קצר']]);
});

test('extra blank lines are preserved as intentional empty paragraphs', () => {
  assert.deepEqual(plainTextToParagraphs('א\n\n\nב'), [['א'], [], ['ב']]);
});

test('leading/trailing blank lines are trimmed — no empty lines at the edges', () => {
  assert.deepEqual(plainTextToParagraphs('\n\nראשון\n\nשני\n\n\n'), [['ראשון'], ['שני']]);
});

test('\\r\\n (Windows clipboard) is normalized', () => {
  assert.deepEqual(plainTextToParagraphs('a\r\nb\r\n\r\nc'), [['a', 'b'], ['c']]);
});

test('whitespace-only input produces nothing', () => {
  assert.deepEqual(plainTextToParagraphs('  \n \n'), []);
  assert.deepEqual(plainTextToParagraphs(''), []);
});
