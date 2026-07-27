import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDirection, stampBlockDirections, htmlToPlainish } from '../../../shared/textDirection.mjs';
import { buildRawMessage } from './mime.js';

// Pins the canonical outgoing-direction rule. Each test maps to one of the
// stated product requirements.

test('first-strong resolution: Hebrew → rtl, English → ltr, neutral → undetermined', () => {
  assert.equal(resolveDirection('שלום'), 'rtl');
  assert.equal(resolveDirection('hello'), 'ltr');
  assert.equal(resolveDirection('123 !@# '), null); // no strong char
  assert.equal(resolveDirection(''), null);
  // Leading neutrals are skipped; the first STRONG character decides.
  assert.equal(resolveDirection('123 שלום'), 'rtl');
  assert.equal(resolveDirection('"(hello)"'), 'ltr');
});

test('req 2/3: Hebrew content ships rtl, English content ships ltr — per block', () => {
  const html = '<p>שלום לכולם</p><p>Hello everyone</p>';
  const out = stampBlockDirections(html);
  assert.match(out, /<p dir="rtl">שלום לכולם<\/p>/);
  assert.match(out, /<p dir="ltr">Hello everyone<\/p>/);
});

test('req 4: an explicit author direction is NEVER overridden', () => {
  // Author forced LTR on Hebrew text and RTL on English text — both must stand.
  const html = '<p dir="ltr">שלום</p><p dir="rtl">hello</p>';
  const out = stampBlockDirections(html);
  assert.match(out, /<p dir="ltr">שלום<\/p>/);
  assert.match(out, /<p dir="rtl">hello<\/p>/);
  assert.equal((out.match(/dir=/g) || []).length, 3); // 2 blocks + base wrapper
});

test('req 1: content with no strong character falls back to the surface default (rtl)', () => {
  assert.match(stampBlockDirections('<p>12345</p>'), /<p dir="rtl">/);
  assert.match(stampBlockDirections('<p></p>'), /<p dir="rtl">/);
  // ...and the fallback is a parameter, not a hardcoded value.
  assert.match(stampBlockDirections('<p>12345</p>', { fallback: 'ltr' }), /<p dir="ltr">/);
});

test('req 7: serialized HTML carries explicit direction (never CSS-only)', () => {
  const out = stampBlockDirections('<p>שלום</p>');
  assert.match(out, /dir="rtl"/);
  assert.doesNotMatch(out, /dir="auto"/); // concrete value — Outlook-safe
});

test('req 4/6: quoted reply history keeps each block\'s own direction', () => {
  const html =
    '<p>תשובה שלי</p>' +
    '<blockquote><p dir="ltr">Original English message</p><p>שורה בעברית</p></blockquote>';
  const out = stampBlockDirections(html);
  assert.match(out, /<p dir="rtl">תשובה שלי<\/p>/);
  assert.match(out, /<p dir="ltr">Original English message<\/p>/); // preserved as-authored
  assert.match(out, /<p dir="rtl">שורה בעברית<\/p>/); // resolved from its own text
});

test('req 5: mixed-language document — each block gets its own explicit base', () => {
  const html = '<p>שלום Dana, נשמח לראותך</p><p>Best regards, גרפיטיול</p>';
  const out = stampBlockDirections(html);
  assert.match(out, /<p dir="rtl">שלום Dana/); // first strong char is Hebrew
  assert.match(out, /<p dir="ltr">Best regards/); // first strong char is Latin
});

test('the document base wrapper is DERIVED from content, not hardcoded rtl', () => {
  assert.match(stampBlockDirections('<p>שלום</p>'), /^<div dir="rtl">/);
  assert.match(stampBlockDirections('<p>hello</p>'), /^<div dir="ltr">/);
});

test('URLs and attributes never decide direction (tags stripped whole)', () => {
  // Without whole-tag stripping the href would make this block look LTR.
  const html = '<p><a href="https://example.com/path">קישור בעברית</a></p>';
  assert.match(stampBlockDirections(html), /<p dir="rtl">/);
  assert.doesNotMatch(htmlToPlainish(html), /example\.com/);
});

test('nested blocks (lists) are each stamped', () => {
  const out = stampBlockDirections('<ul><li>פריט</li><li>item</li></ul>');
  assert.match(out, /<ul dir="rtl">/);
  assert.match(out, /<li dir="rtl">פריט<\/li>/);
  assert.match(out, /<li dir="ltr">item<\/li>/);
});

test('buildRawMessage applies the rule to real outgoing mail', () => {
  const raw = buildRawMessage({
    from: { email: 'info@grafitiyul.co.il', name: 'גרפיטיול' },
    to: [{ email: 'x@y.com' }],
    subject: 'נושא',
    bodyHtml: '<p>שלום</p><p>Hello</p>',
    bodyText: 'שלום Hello',
  });
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  // The html part is base64 inside the MIME — decode every base64 block.
  const hasDirected = decoded
    .split(/\r\n/)
    .filter((l) => /^[A-Za-z0-9+/=]{20,}$/.test(l))
    .map((l) => Buffer.from(l, 'base64').toString('utf8'))
    .some((s) => s.includes('dir="rtl"') && s.includes('dir="ltr"'));
  assert.equal(hasDirected, true, 'outgoing HTML part must carry explicit per-block direction');
});

test('empty/nullish body is passed through untouched', () => {
  assert.equal(stampBlockDirections(''), '');
  assert.equal(stampBlockDirections(null), null);
});
