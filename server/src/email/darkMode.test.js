// Dark-mode readability contract for EVERY outgoing email.
//
// The production bug: the wrapper declared `color-scheme: light dark` (which
// tells the client "don't invert me") while setting no colours, so on a phone
// in dark mode the client's dark surface sat behind author-coloured dark text.
// These assertions pin the layered defences so a future edit cannot quietly
// reintroduce it. Run with `npm test` (node:test).

import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapEmailDocument, buildRawMessage } from './mime.js';

const BODY = '<p>שלום</p>';

test('the document declares LIGHT — never "light dark" with no colours', () => {
  const html = wrapEmailDocument(BODY);
  assert.match(html, /<meta name="color-scheme" content="light">/);
  assert.match(html, /<meta name="supported-color-schemes" content="light">/);
  assert.match(html, /color-scheme:light/);
  assert.doesNotMatch(
    html,
    /content="light dark"/,
    'claiming dark support without handling it is exactly the original bug',
  );
});

test('background AND text colour are both explicit — never client defaults', () => {
  const html = wrapEmailDocument(BODY);
  // Inline on the surface (what Gmail's inverter actually respects)…
  assert.match(html, /background-color:#ffffff/);
  assert.match(html, /color:#111827/);
  // …plus the bgcolor attribute for the oldest clients.
  assert.match(html, /<body bgcolor="#ffffff"/);
});

test('dark mode re-asserts the SAME light palette (no inversion of author text)', () => {
  const html = wrapEmailDocument(BODY);
  const dark = html.match(/@media \(prefers-color-scheme: dark\)\{([^}]*\}[^}]*)\}/);
  assert.ok(dark, 'a prefers-color-scheme block must exist');
  assert.match(dark[1], /background-color:#ffffff/);
  assert.match(dark[1], /color:#111827/);
});

test('links carry an explicit colour (defaults go unreadable on dark chrome)', () => {
  assert.match(wrapEmailDocument(BODY), /a\{color:#1d4ed8/);
});

test('the authored body is preserved verbatim inside the surface', () => {
  const html = wrapEmailDocument('<p>שלום</p><p style="color:#111">כהה</p>');
  assert.match(html, /<p>שלום<\/p>/);
  // Author colours are never rewritten — they simply sit on a light surface.
  assert.match(html, /<p style="color:#111">כהה<\/p>/);
});

test('empty input stays empty (no wrapper on a bodyless message)', () => {
  assert.equal(wrapEmailDocument(''), '');
  assert.equal(wrapEmailDocument(null), null);
});

test('EVERY send path gets it: buildRawMessage wraps the HTML part', () => {
  const raw = buildRawMessage({
    from: { email: 'a@b.com' },
    to: [{ email: 'c@d.com' }],
    subject: 'נושא',
    bodyHtml: BODY,
    bodyText: 'שלום',
  });
  const decoded = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  const html = decoded.includes('quoted-printable') || decoded.includes('base64')
    ? decoded // encoded parts still carry the markers below in some transfer encodings
    : decoded;
  assert.ok(
    /color-scheme/.test(html) || /Y29sb3Itc2NoZW1l/.test(html),
    'the canonical wrapper must be present in the built message',
  );
});
