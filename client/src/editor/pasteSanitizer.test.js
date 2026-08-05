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

// ---- div-based paragraphs → real paragraphs (preserve spacing) ----

test('sibling <div> blocks become separate <p> paragraphs', () => {
  const out = sanitizePastedHtml('<div>first</div><div>second</div>');
  assert.match(out, /<p>first<\/p>/);
  assert.match(out, /<p>second<\/p>/);
  assert.doesNotMatch(out, /<div/);
});

test('nested/structural <div> is unwrapped, inner leaf becomes <p>', () => {
  const out = sanitizePastedHtml('<div><div>inner</div></div>');
  assert.match(out, /<p>inner<\/p>/);
  assert.doesNotMatch(out, /<div/);
});

test('div carrying a list keeps the list (wrapper unwrapped, not flattened)', () => {
  const out = sanitizePastedHtml('<div><ul><li>x</li></ul></div>');
  assert.match(out, /<ul><li>x<\/li><\/ul>/);
});

test('leaf div preserves dir and text-align', () => {
  const out = sanitizePastedHtml('<div dir="ltr" style="text-align:center">hi</div>');
  assert.match(out, /<p[^>]*dir="ltr"/);
  assert.match(out, /text-align: center/);
});

test('our media-embed div wrapper is left intact (not turned into <p>)', () => {
  const out = sanitizePastedHtml(
    '<div data-type="media-embed" data-provider="youtube" data-video-id="abc"></div>',
  );
  assert.match(out, /<div[^>]*data-type="media-embed"/);
  assert.match(out, /data-video-id="abc"/);
});

// ---- Word list paragraphs → real <ul>/<ol> ----

test('Word bulleted list paragraphs become a <ul>', () => {
  const html =
    '<p class="MsoListParagraphCxSpFirst" style="mso-list:l0 level1 lfo1">' +
    '<span style="mso-list:Ignore">·<span>&nbsp;&nbsp;</span></span>Apple</p>' +
    '<p class="MsoListParagraphCxSpLast" style="mso-list:l0 level1 lfo1">' +
    '<span style="mso-list:Ignore">·<span>&nbsp;&nbsp;</span></span>Banana</p>';
  const out = sanitizePastedHtml(html);
  assert.match(out, /<ul>/);
  assert.match(out, /<li[^>]*>Apple<\/li>/);
  assert.match(out, /<li[^>]*>Banana<\/li>/);
  assert.doesNotMatch(out, /mso-list/i);
  assert.doesNotMatch(out, /·/);
});

test('Word numbered list paragraphs become an <ol>', () => {
  const html =
    '<p class="MsoListParagraph" style="mso-list:l0 level1 lfo1">' +
    '<span style="mso-list:Ignore">1.<span>&nbsp;</span></span>One</p>' +
    '<p class="MsoListParagraph" style="mso-list:l0 level1 lfo1">' +
    '<span style="mso-list:Ignore">2.<span>&nbsp;</span></span>Two</p>';
  const out = sanitizePastedHtml(html);
  assert.match(out, /<ol>/);
  assert.match(out, /<li[^>]*>One<\/li>/);
  assert.match(out, /<li[^>]*>Two<\/li>/);
});

test('a lone mso-list style on ordinary text is NOT turned into a list', () => {
  // Regression guard: detection needs the MsoListParagraph class or an Ignore
  // marker span — a bare mso-list attribute stays a normal paragraph.
  const out = sanitizePastedHtml('<p class="MsoNormal" style="mso-list:l0 level1">real text</p>');
  assert.match(out, /<p[^>]*>real text<\/p>/);
  assert.doesNotMatch(out, /<li/);
});

// ---- pasted emoji / tiny-icon images (production bug: giant emoji) ----

test('twemoji-style <img> with emoji alt becomes the Unicode emoji', () => {
  const out = sanitizePastedHtml(
    '<p>נתראה <img src="https://cdn.example/72x72/1f600.png" alt="😀" class="emoji" width="20" height="20"> מחר</p>',
  );
  assert.doesNotMatch(out, /<img/);
  assert.match(out, /נתראה 😀 מחר/);
});

test('ZWJ/skin-tone emoji sequences in alt survive as one glyph', () => {
  const out = sanitizePastedHtml('<p><img src="https://x/y.png" alt="👍🏽" width="18"></p>');
  assert.match(out, /👍🏽/);
  assert.doesNotMatch(out, /<img/);
});

test('tiny icon without emoji alt is dropped, alt text kept when present', () => {
  const withAlt = sanitizePastedHtml('<p>hi <img src="https://x/i.png" alt="logo" width="16"> there</p>');
  assert.doesNotMatch(withAlt, /<img/);
  assert.match(withAlt, /hi logo there/);
  const noAlt = sanitizePastedHtml('<p>hi <img src="https://x/i.png" width="16"> there</p>');
  assert.doesNotMatch(noAlt, /<img/);
});

test('style-declared tiny width counts (Word/Docs put size in style)', () => {
  const out = sanitizePastedHtml('<p><img src="https://x/e.png" alt="🎉" style="width:20px;height:20px"></p>');
  assert.match(out, /🎉/);
  assert.doesNotMatch(out, /<img/);
});

test('data: URI images are dropped on paste (base64 never reaches the doc)', () => {
  const out = sanitizePastedHtml('<p>a <img src="data:image/png;base64,iVBORw0KGgo="> b</p>');
  assert.doesNotMatch(out, /<img/);
  assert.doesNotMatch(out, /base64/);
});

test('a real content image (large, real src) is untouched', () => {
  const out = sanitizePastedHtml('<p><img src="https://cdn.example/photo.jpg" alt="נקודת המפגש" width="800" height="600"></p>');
  assert.match(out, /<img[^>]*src="https:\/\/cdn\.example\/photo\.jpg"/);
});

test('an image with no sizing info at all is treated as content, not emoji', () => {
  const out = sanitizePastedHtml('<p><img src="https://cdn.example/photo.jpg" alt="תמונה מהסיור"></p>');
  assert.match(out, /<img[^>]*src="https:\/\/cdn\.example\/photo\.jpg"/);
});

test('plain digits in alt are NOT mistaken for emoji', () => {
  const out = sanitizePastedHtml('<p><img src="https://x/n.png" alt="123" width="20"></p>');
  // tiny → replaced by alt text, but as TEXT "123", never kept as an image
  assert.doesNotMatch(out, /<img/);
  assert.match(out, /123/);
});

// ---- literal-newline restoration (WhatsApp / Gmail plain-text pastes) ----
// Production bug: a long multi-paragraph text pasted into a Deal note became
// ONE unformatted block, because the source carried its line structure as
// literal \n characters inside inline markup and the DOM collapsed them.

test('WhatsApp Web message span: paragraphs stay PARAGRAPHS, single newlines stay soft breaks', () => {
  const out = sanitizePastedHtml(
    '<span dir="auto" class="copyable-text">שלום רב,\nרצינו לבדוק לגבי הסיור.\n\nתודה,\nורד</span>',
  );
  const paras = (out.match(/<p[ >]/g) || []).length;
  const breaks = (out.match(/<br\s*\/?>/g) || []).length;
  assert.equal(paras, 2, `the blank line is a paragraph break, not a <br>: ${out}`);
  assert.equal(breaks, 2, `one soft break inside each paragraph: ${out}`);
  assert.match(out, /שלום רב,/);
  assert.match(out, /ורד/);
});

test('Gmail plain-text body (white-space:pre-wrap div) rebuilds real paragraphs', () => {
  const out = sanitizePastedHtml(
    '<div style="white-space:pre-wrap">פסקה ראשונה עם תוכן.\n\nפסקה שנייה אחרי שורה ריקה.\nשורה נוספת.</div>',
  );
  const paras = (out.match(/<p[ >]/g) || []).length;
  const breaks = (out.match(/<br\s*\/?>/g) || []).length;
  assert.equal(paras, 2, `two paragraphs: ${out}`);
  assert.equal(breaks, 1, `one soft break in the second paragraph: ${out}`);
});

test('leading/trailing blank lines are trimmed; extra inner blank lines survive as empty paragraphs', () => {
  const out = sanitizePastedHtml('<span>\n\nראשון\n\n\nשני\n\n</span>');
  assert.match(out, /^<p>ראשון<\/p><p><\/p><p>שני<\/p>$/, out);
});

test('inline formatting survives the paragraph rebuild', () => {
  const out = sanitizePastedHtml('<span>לפני <b>מודגש</b> אחרי\n\nפסקה שנייה</span>');
  assert.match(out, /<p>לפני <b>מודגש<\/b> אחרי<\/p>/, out);
  assert.match(out, /<p>פסקה שנייה<\/p>/, out);
});

test('pretty-printed HTML newlines between tags are NOT turned into breaks', () => {
  const out = sanitizePastedHtml('<p>hello\nworld</p>\n<p>second\nparagraph</p>');
  assert.doesNotMatch(out, /<br/, 'block-structured HTML keeps its whitespace semantics');
  assert.match(out, /<p>hello\s*world<\/p>/);
});

test('a fragment that already has <br> structure is left alone (rule 1 disqualified)', () => {
  const out = sanitizePastedHtml('<span>a\nb<br>c</span>');
  const breaks = (out.match(/<br\s*\/?>/g) || []).length;
  assert.equal(breaks, 1, 'the existing <br> is the structure; the stray \n stays whitespace');
});

test('multi-paragraph Word-style paste keeps separate paragraphs (regression)', () => {
  const out = sanitizePastedHtml(
    '<p class="MsoNormal">פסקה ראשונה.</p>\n<p class="MsoNormal">&nbsp;</p>\n<p class="MsoNormal">פסקה שנייה עם <b>הדגשה</b>.</p>',
  );
  const paras = (out.match(/<p/g) || []).length;
  assert.ok(paras >= 3, `paragraphs preserved (got ${paras})`);
  assert.match(out, /<b>הדגשה<\/b>|<strong>הדגשה<\/strong>/);
});
