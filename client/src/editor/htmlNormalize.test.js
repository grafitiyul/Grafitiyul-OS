import { test } from 'node:test';
import assert from 'node:assert/strict';
import { richHtmlForDisplay } from './htmlNormalize.js';

// Root-cause coverage: imported recruitment bodies are PLAIN TEXT with newlines.
// richHtmlForDisplay must turn them into real paragraphs/breaks so the read-only
// preview matches the editor (which does the same via normaliseIncoming).

test('plain text: double newline becomes separate paragraphs', () => {
  const out = richHtmlForDisplay('פסקה ראשונה\n\nפסקה שנייה');
  assert.equal((out.match(/<p[ >]/g) || []).length, 2);
  assert.match(out, /פסקה ראשונה/);
  assert.match(out, /פסקה שנייה/);
});

test('plain text: single newline becomes a soft <br> inside one paragraph', () => {
  const out = richHtmlForDisplay('שורה אחת\nשורה שתיים');
  assert.equal((out.match(/<p[ >]/g) || []).length, 1);
  assert.match(out, /שורה אחת<br>שורה שתיים/);
});

test('mixed: \\n\\n paragraphs each keep their \\n soft breaks', () => {
  const out = richHtmlForDisplay('א\nב\n\nג');
  assert.equal((out.match(/<p[ >]/g) || []).length, 2);
  assert.match(out, /א<br>ב/);
});

test('already-HTML content passes through (edited-in-GOS bodies)', () => {
  const html = '<p>כבר <strong>HTML</strong></p>';
  assert.match(richHtmlForDisplay(html), /<strong>HTML<\/strong>/);
});

test('empty / falsy input yields empty string', () => {
  assert.equal(richHtmlForDisplay(''), '');
  assert.equal(richHtmlForDisplay(null), '');
});

test('plain text is HTML-escaped before wrapping', () => {
  const out = richHtmlForDisplay('a < b & c');
  assert.match(out, /a &lt; b &amp; c/);
});

// ---- 'tight' rhythm (note face — zero paragraph margins) ----
// On tight surfaces a paragraph boundary renders as nothing, so every authored
// blank line must survive as an explicit empty paragraph.

test('tight: plain-text blank line becomes an explicit empty paragraph', () => {
  const out = richHtmlForDisplay('פסקה ראשונה\n\nפסקה שנייה', 'tight');
  assert.equal(out, '<p>פסקה ראשונה</p><p></p><p>פסקה שנייה</p>');
});

test('tight: double-<br> split keeps the authored blank line as an empty paragraph', () => {
  const out = richHtmlForDisplay('<p>א<br><br>ב</p>', 'tight');
  assert.equal(out, '<p>א</p><p></p><p>ב</p>');
});

test('spaced: triple-<br> keeps the EXTRA blank as an empty paragraph (margin renders the first)', () => {
  const out = richHtmlForDisplay('<p>א<br><br><br>ב</p>');
  assert.equal(out, '<p>א</p><p></p><p>ב</p>');
});

test('spaced: double-<br> split stays a plain paragraph break (no empty paragraph)', () => {
  const out = richHtmlForDisplay('<p>א<br><br>ב</p>');
  assert.equal(out, '<p>א</p><p>ב</p>');
});
