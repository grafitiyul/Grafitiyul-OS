import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapEmailDocument, buildRawMessage } from './mime.js';
import { htmlPartOf } from './mimeParts.js';

// SUPERSEDED RULE — read this before "restoring" the old assertions.
//
// This file used to pin a THEME-ADAPTIVE contract: declare `light dark` and
// inject no colours, letting each client theme the message. Field evidence
// (P0, 2026-08-03: "on a phone in Dark Mode some text renders dark on a dark
// background") showed that rule cannot hold, because it contradicts its own
// req 4 below — author colours pass through untouched. Declaring `light dark`
// tells Gmail "do not invert me", so it paints its dark surface behind text
// that carries an explicit dark colour (the editor's colour picker, and pasted
// Word/Docs content whose colours pasteSanitizer deliberately preserves).
// Adaptive + preserved author colours = unreadable, and we must not rewrite an
// operator's chosen colours to rescue it.
//
// The rule is now SELF-CONSISTENT LIGHT: the message carries its own explicit
// light surface (background AND text colour), declared `light` so supporting
// clients leave it alone. In dark mode it renders as a light card on dark
// chrome — legible everywhere, identical to the preview. Deliberate trade:
// guaranteed legibility over a dark-themed email. Full contract + layered
// client defences: src/email/darkMode.test.js.

test('declares LIGHT — the adaptive "light dark" claim is gone', () => {
  const out = wrapEmailDocument('<p>שלום</p>');
  assert.match(out, /<meta name="color-scheme" content="light">/);
  assert.match(out, /<meta name="supported-color-schemes" content="light">/);
  assert.match(out, /color-scheme:light/);
  assert.doesNotMatch(out, /content="light dark"/);
});

test('the surface sets BOTH background and text colour (never client defaults)', () => {
  const out = wrapEmailDocument('<p>שלום</p>');
  assert.match(out, /background-color:#ffffff/);
  assert.match(out, /color:#111827/);
  // Both together, or author-coloured text can still land on a dark surface.
  assert.match(out, /<body bgcolor="#ffffff"/);
});

test('req 4: an explicit author colour passes through untouched', () => {
  const out = wrapEmailDocument('<p><span style="color:#ff0000">אדום</span></p>');
  assert.match(out, /color:#ff0000/);
});

test('req 5: highlight, link, bold, underline, alignment and dir all survive', () => {
  const body =
    '<div dir="rtl"><p dir="rtl" style="text-align:center">' +
    '<strong>מודגש</strong> <u>קו</u> <mark style="background-color:#fef08a">רקע</mark> ' +
    '<a href="https://example.com">קישור</a></p><p dir="ltr">English</p></div>';
  const out = wrapEmailDocument(body);
  for (const expected of [/<mark/, /background-color:#fef08a/, /<strong>/, /<u>/, /text-align:center/, /dir="rtl"/, /dir="ltr"/, /href="https:\/\/example\.com"/]) {
    assert.match(out, expected);
  }
});

test('the body content is preserved verbatim inside the surface', () => {
  const body = '<div dir="rtl"><p dir="rtl">שלום</p></div>';
  const out = wrapEmailDocument(body);
  // The surface wrapper is the only addition; the authored markup is untouched.
  assert.ok(out.includes(`>${body}</div></body>`), 'author markup must survive byte-for-byte');
  assert.match(out, /<div class="gos-email-surface"/);
});

test('empty / nullish body is passed through untouched', () => {
  assert.equal(wrapEmailDocument(''), '');
  assert.equal(wrapEmailDocument(null), null);
});

test('req 6: applied by buildRawMessage, so EVERY send path inherits it', () => {
  const raw = buildRawMessage({
    from: { email: 'info@grafitiyul.co.il', name: 'גרפיטיול' },
    to: [{ email: 'x@y.com' }],
    subject: 'נושא',
    bodyHtml: '<p>שלום</p><p>Hello</p>',
    bodyText: 'שלום Hello',
  });
  const html = htmlPartOf(raw);
  assert.match(html, /color-scheme/);
  // Direction stamping still happens, and still inside the document.
  assert.match(html, /dir="rtl"/);
  assert.match(html, /dir="ltr"/);
  assert.match(html, /<body bgcolor=/);
});

test('scheme declaration does not disturb send-now == send-later parity', () => {
  // Both paths call buildRawMessage, so the wrapper lands identically. Same
  // input → same bytes (boundaries normalised).
  const args = {
    from: { email: 'info@grafitiyul.co.il', name: 'גרפיטיול' },
    to: [{ email: 'x@y.com' }],
    subject: 'נושא',
    bodyHtml: '<p>שלום</p>',
    bodyText: 'שלום',
  };
  const norm = (r) => Buffer.from(r, 'base64url').toString('utf8').replace(/alt_[a-z0-9]+/g, 'ALT');
  assert.equal(norm(buildRawMessage(args)), norm(buildRawMessage(args)));
});
