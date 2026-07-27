import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeEmailHtml } from './sanitize.js';

// The sanitizer runs on BOTH outbound (POST /send, signatures) and inbound
// (ingest) HTML, so anything it drops is lost in the sent mail AND in the
// reader. These tests pin the editor's own output surviving the round trip —
// the regression that silently removed text background colors.

test('highlight (<mark>) survives with its background colour', () => {
  const html = '<p>hello <mark style="background-color: #fef08a">מודגש</mark> world</p>';
  const out = sanitizeEmailHtml(html);
  assert.match(out, /<mark/);
  assert.match(out, /background-color/);
  assert.match(out, /מודגש/);
});

test('editor formatting marks survive: colour, font-size, alignment, direction, bold/underline', () => {
  const cases = [
    ['<p><span style="color: #ff0000">אדום</span></p>', /color/],
    ['<p><span style="font-size: 24px">גדול</span></p>', /font-size/],
    ['<p style="text-align: center">מרכז</p>', /text-align/],
    ['<p dir="ltr">hello</p>', /dir="ltr"/],
    ['<p dir="rtl">שלום</p>', /dir="rtl"/],
    ['<p><strong>מודגש</strong> <u>קו</u></p>', /<strong>/],
  ];
  for (const [html, expected] of cases) {
    assert.match(sanitizeEmailHtml(html), expected, `lost formatting for: ${html}`);
  }
});

test('span background-color (non-mark highlight) also survives', () => {
  assert.match(sanitizeEmailHtml('<p><span style="background-color: yellow">רקע</span></p>'), /background-color/);
});

test('still strips scripts, handlers and non-http schemes (security unchanged)', () => {
  assert.doesNotMatch(sanitizeEmailHtml('<p>hi</p><script>alert(1)</script>') || '', /script/i);
  assert.doesNotMatch(sanitizeEmailHtml('<p onclick="alert(1)">hi</p>') || '', /onclick/i);
  assert.doesNotMatch(sanitizeEmailHtml('<a href="javascript:alert(1)">x</a>') || '', /javascript:/i);
  // A <mark> must not become an injection vector either.
  assert.doesNotMatch(sanitizeEmailHtml('<mark onmouseover="alert(1)">x</mark>') || '', /onmouseover/i);
});

test('empty / nullish input stays null', () => {
  assert.equal(sanitizeEmailHtml(''), null);
  assert.equal(sanitizeEmailHtml(null), null);
});
