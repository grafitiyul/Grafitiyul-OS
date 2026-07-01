import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// pasteSanitizer uses the global DOMParser (a browser API). jsdom provides a
// spec-accurate HTML5 parser, so the exact same code path runs under
// node --test. (linkedom was tried first but doesn't do full HTML tree
// construction — it drops <p> and never fills <body> — so it can't validate
// this DOM-heavy code.) Set the global before importing the module under test.
const { window } = new JSDOM('');
globalThis.DOMParser = window.DOMParser;
globalThis.document = window.document;

const { sanitizePastedHtml } = await import('./pasteSanitizer.js');

// ---- preserve useful formatting ----

test('bold/italic/underline expressed as inline styles become semantic tags', () => {
  const out = sanitizePastedHtml(
    '<p><span style="font-weight:700">b</span><span style="font-style:italic">i</span><span style="text-decoration:underline">u</span></p>',
  );
  assert.match(out, /<strong>b<\/strong>/);
  assert.match(out, /<em>i<\/em>/);
  assert.match(out, /<u>u<\/u>/);
  assert.doesNotMatch(out, /style=/, 'inline styles should be stripped after conversion');
});

test('links are preserved with href', () => {
  const out = sanitizePastedHtml('<p>see <a href="https://grafitiyul.com">site</a></p>');
  assert.match(out, /<a[^>]*href="https:\/\/grafitiyul\.com"[^>]*>site<\/a>/);
});

test('bullet and numbered lists survive, ordered start kept', () => {
  const bullets = sanitizePastedHtml('<ul><li>one</li><li>two</li></ul>');
  assert.match(bullets, /<ul>/);
  assert.match(bullets, /<li>one<\/li>/);

  const numbered = sanitizePastedHtml('<ol start="3"><li>c</li></ol>');
  assert.match(numbered, /<ol[^>]*start="3"/);
});

test('paragraphs and line breaks are kept', () => {
  const out = sanitizePastedHtml('<p>a</p><p>b<br>c</p>');
  assert.match(out, /<p>a<\/p>/);
  assert.match(out, /<br\s*\/?>/);
});

// ---- direction (RTL/LTR) survives paste ----

test('valid dir on paragraph and list is preserved', () => {
  assert.match(sanitizePastedHtml('<p dir="ltr">english</p>'), /dir="ltr"/);
  assert.match(sanitizePastedHtml('<ul dir="rtl"><li>עברית</li></ul>'), /<ul[^>]*dir="rtl"/);
});

test('invalid dir values are dropped', () => {
  const out = sanitizePastedHtml('<p dir="auto">x</p>');
  assert.doesNotMatch(out, /dir=/, 'only ltr/rtl are kept');
});

// ---- reasonable headings ----

test('h4–h6 are downgraded to h3 (StarterKit supports h1–h3)', () => {
  const out = sanitizePastedHtml('<h4>Deep</h4><h6 dir="ltr">Deeper</h6>');
  assert.match(out, /<h3>Deep<\/h3>/);
  assert.match(out, /<h3[^>]*dir="ltr"[^>]*>Deeper<\/h3>/);
  assert.doesNotMatch(out, /<h[456]/);
});

// ---- strip garbage, keep content ----

test('Word/Office junk (classes, mso styles, empty <o:p>) is removed but text stays', () => {
  // Realistic Word export: real text in an MsoNormal paragraph with a trailing
  // empty <o:p> marker. The paragraph + its text survive; the class, the
  // mso-* inline style, and the office tag are all stripped.
  const out = sanitizePastedHtml(
    '<p class="MsoNormal" style="mso-list:l0 level1">real text<o:p></o:p></p>',
  );
  assert.match(out, /<p[^>]*>real text<\/p>/);
  assert.doesNotMatch(out, /MsoNormal/);
  assert.doesNotMatch(out, /mso-list/);
  assert.doesNotMatch(out, /o:p/);
});

test('Google-Docs bold wrapper with font-weight:normal does NOT make everything bold', () => {
  const out = sanitizePastedHtml(
    '<b id="docs-internal-guid-abc"><span style="font-weight:400">plain text</span></b>',
  );
  assert.match(out, /plain text/);
  assert.doesNotMatch(out, /<strong>/, 'the spurious bold wrapper must be unwrapped');
});

test('empty / falsy input is passed through safely', () => {
  assert.equal(sanitizePastedHtml(''), '');
  assert.equal(sanitizePastedHtml(null), null);
});
