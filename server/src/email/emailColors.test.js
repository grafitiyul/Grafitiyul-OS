// Theme-hostile colour normalization — the real fix for dark-on-dark, and the
// guard against the regression that forcing wrapper colours caused.
// Run with `npm test` (node:test).

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmailColors, normalizeStyleForEmail, isThemeHostileForeground } from './emailColors.js';
import { sanitizeEmailHtml } from './sanitize.js';

// ── the dark-on-dark cause ───────────────────────────────────────────────────

test('a Word-pasted near-black foreground is dropped so text inherits the theme', () => {
  for (const c of ['#000000', '#000', 'black', '#111111', 'rgb(17,17,17)']) {
    assert.equal(isThemeHostileForeground(c), true, c);
    assert.equal(normalizeStyleForEmail(`color: ${c}`), '', c);
  }
});

test('a near-white background is dropped (it painted a white box on dark)', () => {
  assert.equal(normalizeStyleForEmail('background-color: #ffffff'), '');
  assert.equal(normalizeStyleForEmail('background-color: #fefefe'), '');
});

// ── what must NOT be touched ─────────────────────────────────────────────────

test('deliberate colours survive untouched — we never second-guess the author', () => {
  assert.match(normalizeStyleForEmail('color: #ff0000'), /color: #ff0000/);
  assert.match(normalizeStyleForEmail('color: #1d4ed8'), /color: #1d4ed8/);
  // dark red / navy are chromatic, not "default text"
  assert.equal(isThemeHostileForeground('#7f1d1d'), false);
  assert.equal(isThemeHostileForeground('#0b2447'), false);
});

test('non-colour styling is preserved exactly', () => {
  const out = normalizeStyleForEmail('text-align: center; font-size: 18px; color:#000');
  assert.match(out, /text-align: center/);
  assert.match(out, /font-size: 18px/);
  assert.doesNotMatch(out, /color/);
});

test('a highlight keeps its background AND gains a readable paired foreground', () => {
  const out = normalizeStyleForEmail('background-color: #fef08a');
  assert.match(out, /background-color: #fef08a/, 'the highlight is a real choice');
  assert.match(out, /color: #111827/, 'so it cannot theme into yellow-on-white');
});

test('a dark background keeps its light pairing (deliberate design)', () => {
  const out = normalizeStyleForEmail('background-color: #111827');
  assert.match(out, /background-color: #111827/);
  assert.match(out, /color: #ffffff/);
});

test('an author foreground on a kept background is left alone', () => {
  const out = normalizeStyleForEmail('background-color: #fef08a; color: #7f1d1d');
  assert.match(out, /color: #7f1d1d/);
  assert.doesNotMatch(out, /#111827/);
});

// ── whole-fragment + the canonical sanitizer ─────────────────────────────────

test('normalizeEmailColors rewrites every style attribute, keeping structure', () => {
  const html = '<p style="color:#000">שלום</p><p><span style="color:#ff0000">אדום</span></p>';
  const out = normalizeEmailColors(html);
  // The kept declaration is byte-identical to the author's — never reformatted.
  assert.equal(out, '<p>שלום</p><p><span style="color:#ff0000">אדום</span></p>');
});

test('sanitizeEmailHtml applies it — stored content is covered, not just new pastes', () => {
  const out = sanitizeEmailHtml('<p style="color:#000000">טקסט ישן שהודבק מוורד</p>');
  assert.doesNotMatch(out, /color/);
  assert.match(out, /טקסט ישן/);
});

test('images and links survive normalization untouched', () => {
  const out = sanitizeEmailHtml(
    '<p><img src="https://x/y.jpg" alt="a" width="480" style="max-width:100%;height:auto"></p>',
  );
  assert.match(out, /<img[^>]+src="https:\/\/x\/y\.jpg"/);
  assert.match(out, /max-width:100%/);
});

test('the wrapper itself must never inject colours (the regression guard)', async () => {
  const { wrapEmailDocument } = await import('./mime.js');
  const out = wrapEmailDocument('<p>שלום</p>');
  const colourDecls = [...out.matchAll(/(^|[^-\w])color\s*:\s*([^;}"']+)/gi)]
    .map((m) => m[2].trim())
    .filter((v) => !/^light|^dark/.test(v)); // the scheme declaration is not a colour
  assert.deepEqual(colourDecls, [], 'forcing colours here produced black rectangles in Gmail');
  assert.doesNotMatch(out, /bgcolor=/);
});
