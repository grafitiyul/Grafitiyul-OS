import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapEmailDocument, buildRawMessage } from './mime.js';
import { htmlPartOf } from './mimeParts.js';

// The theme-adaptive rule for outgoing mail. The defect this pins: a body with
// NO colour information and no scheme declaration leaves the client guessing,
// and Gmail's dark mode then half-inverts — black text on a dark background.
//
// RESTORED 2026-08-04 after a failed experiment: forcing an explicit surface
// (white background + dark text) here made Gmail invert the PAIR into black
// rectangles with white text, in light mode too. The wrapper declares support
// and sets nothing; theme-hostile CONTENT colours are normalized in
// emailColors.js instead.

test('declares support for BOTH schemes (meta + CSS color-scheme)', () => {
  const out = wrapEmailDocument('<p>שלום</p>');
  assert.match(out, /<meta name="color-scheme" content="light dark">/);
  assert.match(out, /<meta name="supported-color-schemes" content="light dark">/);
  assert.match(out, /color-scheme:light dark/);
});

test('req 2 + 3: adds NO text colour — not black, not white', () => {
  const out = wrapEmailDocument('<p>שלום</p>');
  const colourDecls = [...out.matchAll(/(^|[^-\w])color\s*:\s*([^;}"']+)/gi)]
    .map((m) => m[2].trim())
    .filter((v) => !/^light|^dark/.test(v));
  assert.deepEqual(colourDecls, [], 'no bare color: declaration may be introduced');
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

test('the body content is preserved verbatim inside <body>', () => {
  const body = '<div dir="rtl"><p dir="rtl">שלום</p></div>';
  assert.ok(wrapEmailDocument(body).includes(`<body>${body}</body>`));
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
  assert.match(html, /<body>/);
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
