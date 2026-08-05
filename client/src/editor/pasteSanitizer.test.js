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

// ---- div-per-line sources (Gmail compose, VS Code, chat apps) ----
// A bare <div> renders with NO margin at the source, so a run of sibling leaf
// divs is a run of LINES and `<div><br></div>` is the explicit blank line —
// the plain-text contract spelled in DOM. Rebuilding through that contract
// makes an HTML paste and a text/plain paste of the same content identical.

test('sibling line <div>s join into ONE paragraph with soft breaks (they were adjacent lines)', () => {
  const out = sanitizePastedHtml('<div>first</div><div>second</div>');
  assert.equal(out, '<p>first<br>second</p>');
});

test('Gmail shape: <div><br></div> is a paragraph break; bare first line joins the run', () => {
  const out = sanitizePastedHtml(
    '<div dir="rtl">שלום רב,<div>שורה שנייה</div><div><br></div><div>פסקה שנייה</div></div>',
  );
  assert.equal(out, '<p>שלום רב,<br>שורה שנייה</p><p>פסקה שנייה</p>');
});

test('Gmail shape (tight): the blank line becomes an explicit empty paragraph', () => {
  const out = sanitizePastedHtml(
    '<div>שורה ראשונה</div><div><br></div><div>שורה שנייה</div>',
    'tight',
  );
  assert.equal(out, '<p>שורה ראשונה</p><p></p><p>שורה שנייה</p>');
});

test('leading/trailing blank divs are trimmed — no blank lines before/after the paste', () => {
  const out = sanitizePastedHtml(
    '<div><br></div><div>תוכן</div><div><br></div><div><br></div>',
    'tight',
  );
  assert.equal(out, '<p>תוכן</p>');
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

// ---- REAL Chrome clipboard shapes (captured via the browser rig) ----
// Chrome's clipboard serializer wraps every text node in <span style="…">
// with computed styles (color, font-family, white-space…) and emits Gmail
// plain-text bodies as inline span+<br> runs with NO block element at all.
// These fixtures reproduce the exact shapes that collapsed in production.

test('REAL Gmail plain-text body (span+br runs, no blocks): paragraphs and blank lines survive (tight)', () => {
  const out = sanitizePastedHtml(
    '<span style="color: rgb(34, 34, 34); font-family: Arial, sans-serif; white-space: normal">שלום רב,</span><br style="color: rgb(34, 34, 34)"><span style="color: rgb(34, 34, 34)">רצינו לבדוק לגבי הסיור.</span><br><br><span style="color: rgb(34, 34, 34)">תודה רבה,</span><br><span style="color: rgb(34, 34, 34)">ורד</span>',
    'tight',
  );
  const paras = (out.match(/<p[ >]/g) || []).length;
  assert.equal(paras, 3, `two text paragraphs + one explicit blank: ${out}`);
  assert.match(out, /<p><\/p>/, `the blank line survives as an empty paragraph: ${out}`);
  // the paragraph-internal soft breaks survive; no top-level <br> run remains
  assert.doesNotMatch(out, /<\/p><br/, `no stray top-level breaks: ${out}`);
});

test('REAL Gmail divs with TRAILING <br><br> blank markers do not collapse (tight)', () => {
  const out = sanitizePastedHtml(
    '<div style="color: rgb(34, 34, 34)">פסקה ראשונה בטקסט.<br><br></div><div style="color: rgb(34, 34, 34)">פסקה שנייה בטקסט.<br><br></div><div style="color: rgb(34, 34, 34)">פסקה שלישית.</div>',
    'tight',
  );
  assert.equal(
    out,
    '<p>פסקה ראשונה בטקסט.</p><p></p><p>פסקה שנייה בטקסט.</p><p></p><p>פסקה שלישית.</p>',
  );
});

test('segments rule: <br> runs INSIDE one div follow the plain-text contract', () => {
  const src = '<div>שורה 1<br>שורה 2<br><br>פסקה 2</div>';
  assert.equal(
    sanitizePastedHtml(src, 'tight'),
    '<p>שורה 1<br>שורה 2</p><p></p><p>פסקה 2</p>',
  );
  assert.equal(sanitizePastedHtml(src), '<p>שורה 1<br>שורה 2</p><p>פסקה 2</p>');
});

test('color style on a STRUCTURAL wrapper never wraps block children in a span (signature block)', () => {
  const out = sanitizePastedHtml(
    '<div dir="rtl" style="color: rgb(34, 34, 34)"><div>גרפיטיול סיורים</div><div><a href="https://grafitiyul.co.il/">grafitiyul.co.il</a></div></div>',
    'tight',
  );
  assert.doesNotMatch(out, /<span[^>]*><(p|div)/, `no block inside span: ${out}`);
  assert.match(out, /גרפיטיול סיורים<br><a[^>]*>grafitiyul\.co\.il<\/a>/, out);
});

test('bare inline first line next to blocks is a line (anonymous box), not stray inline', () => {
  const out = sanitizePastedHtml('היי,<div><br></div><div>פסקה שנייה</div>', 'tight');
  assert.equal(out, '<p>היי,</p><p></p><p>פסקה שנייה</p>');
});

test('a plain inline snippet (no blocks, no breaks) stays inline so it merges at the cursor', () => {
  const out = sanitizePastedHtml('<span style="color: rgb(34, 34, 34)">שתי מילים</span>');
  assert.doesNotMatch(out, /<p/, `inline paste must stay inline: ${out}`);
});

// ---- DATA tables are preserved as clean canonical tables ----
// Structural test (no source-name heuristics): ≥2 rows × ≥2 columns after
// spacer pruning, not role="presentation", no nested table.

test('a real data table survives: rows, columns, header cells, spans — styling stripped', () => {
  const out = sanitizePastedHtml(
    '<table border="1" width="600" style="border-collapse:collapse"><thead><tr><th style="background:#eee">מוצר</th><th>כמות</th><th>מחיר</th></tr></thead><tbody><tr><td>סיור גרפיטי</td><td>20</td><td>₪1,500</td></tr><tr><td colspan="2">סה"כ</td><td><b>₪1,500</b></td></tr></tbody></table>',
    'tight',
  );
  assert.match(out, /^<table><tbody>/, out);
  assert.equal((out.match(/<tr>/g) || []).length, 3, `three rows: ${out}`);
  assert.match(out, /<th>מוצר<\/th><th>כמות<\/th><th>מחיר<\/th>/, out);
  assert.match(out, /<td colspan="2">סה"כ<\/td>/, out);
  assert.match(out, /<b>₪1,500<\/b>|<strong>₪1,500<\/strong>/, out);
  assert.doesNotMatch(out, /width=|style=|border=/, `email styling stripped: ${out}`);
});

test('spacer rows are pruned from a data table; links survive in cells', () => {
  const out = sanitizePastedHtml(
    '<table><tbody><tr><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td>שם</td><td>קישור</td></tr><tr><td>גרפיטיול</td><td><a href="https://grafitiyul.co.il">אתר</a></td></tr></tbody></table>',
  );
  assert.equal((out.match(/<tr>/g) || []).length, 2, `spacer row pruned: ${out}`);
  assert.match(out, /<a[^>]*href="https:\/\/grafitiyul\.co\.il"[^>]*>אתר<\/a>/, out);
});

test('role="presentation" grid is LAYOUT even at 2x2 — linearized, never preserved', () => {
  const out = sanitizePastedHtml(
    '<table role="presentation"><tbody><tr><td>א</td><td>ב</td></tr><tr><td>ג</td><td>ד</td></tr></tbody></table>',
  );
  assert.doesNotMatch(out, /<table/);
  assert.match(out, /<p>א<\/p>/);
});

test('nested: outer layout wrapper linearized, inner DATA table preserved intact', () => {
  const out = sanitizePastedHtml(
    '<table width="600"><tbody><tr><td>הזמנה חדשה התקבלה</td></tr><tr><td><table><tbody><tr><th>מוצר</th><th>כמות</th></tr><tr><td>סיור</td><td>20</td></tr></tbody></table></td></tr><tr><td>תודה שקניתם</td></tr></tbody></table>',
    'tight',
  );
  assert.equal((out.match(/<table/g) || []).length, 1, `exactly the inner table: ${out}`);
  assert.match(out, /<p>הזמנה חדשה התקבלה<\/p>/, out);
  assert.match(out, /<th>מוצר<\/th><th>כמות<\/th>/, out);
  assert.match(out, /<p>תודה שקניתם<\/p>/, out);
});

// ---- LAYOUT tables (transactional/marketing — the dense-block collapse) ----
// Single-column/row grids position content; ProseMirror would CONCATENATE
// their cells' text into one paragraph. Cells are linearized into block flow.

test('table cells become separate paragraphs — never one run-together block (tight)', () => {
  const out = sanitizePastedHtml(
    '<table width="600"><tbody><tr><td style="padding:12px">כותרת הניוזלטר</td></tr><tr><td style="padding:12px">פסקה ראשונה של תוכן.</td></tr><tr><td>פסקה שנייה.<br>עם שורה נוספת.</td></tr></tbody></table>',
    'tight',
  );
  assert.equal(
    out,
    '<p>כותרת הניוזלטר</p><p></p><p>פסקה ראשונה של תוכן.</p><p></p><p>פסקה שנייה.<br>עם שורה נוספת.</p>',
  );
});

test('table cells stay separate paragraphs in spaced rhythm too', () => {
  const out = sanitizePastedHtml('<table><tbody><tr><td>א</td></tr><tr><td>ב</td></tr></tbody></table>');
  assert.equal(out, '<p>א</p><p>ב</p>');
});

test('spacer cells (&nbsp;/empty) vanish; nested layout tables resolve inside-out', () => {
  const out = sanitizePastedHtml(
    '<table><tbody><tr><td>&nbsp;</td></tr><tr><td><table><tbody><tr><td>תוכן פנימי</td></tr></tbody></table></td></tr><tr><td></td></tr></tbody></table>',
  );
  assert.equal(out, '<p>תוכן פנימי</p>');
});

test('a cell with real block content keeps its own blocks', () => {
  const out = sanitizePastedHtml('<table><tbody><tr><td><p>פסקה</p><ul><li>פריט</li></ul></td></tr></tbody></table>');
  assert.match(out, /<p>פסקה<\/p>/);
  assert.match(out, /<ul><li>פריט<\/li><\/ul>/);
  assert.doesNotMatch(out, /<table/);
});

// ---- Outlook Web margin-0 paragraphs (line-model spelled with <p>) ----

test('OWA <p style="margin:0"> lines are LINES: adjacent stay adjacent, blank stays one blank (tight)', () => {
  const out = sanitizePastedHtml(
    '<p style="margin:0">שלום,</p><p style="margin:0">שורה שנייה צמודה.</p><p style="margin:0"><br></p><p style="margin:0">פסקה שנייה.</p>',
    'tight',
  );
  assert.equal(out, '<p>שלום,<br>שורה שנייה צמודה.</p><p></p><p>פסקה שנייה.</p>');
});

test('OWA lines in spaced rhythm follow the plain-text contract', () => {
  const out = sanitizePastedHtml(
    '<p style="margin:0cm">א</p><p style="margin:0cm">ב</p><p style="margin:0cm"><br></p><p style="margin:0cm">ג</p>',
  );
  assert.equal(out, '<p>א<br>ב</p><p>ג</p>');
});

test('a <p> WITHOUT explicit zero margins stays paragraph-model', () => {
  const out = sanitizePastedHtml('<p>א</p><p>ב</p>', 'tight');
  assert.equal(out, '<p>א</p><p></p><p>ב</p>');
});

test('Chrome span-wrapped blank paragraph still counts as the blank (no doubled gaps, tight)', () => {
  const out = sanitizePastedHtml(
    '<p>לפני</p><p><span style="color: rgb(34, 34, 34)"><br></span></p><p>אחרי</p>',
    'tight',
  );
  const blanks = (out.match(/<p[^>]*>(?:<span[^>]*>)?(?:<br\s*\/?>)?(?:<\/span>)?<\/p>/g) || []).length;
  assert.equal(blanks, 1, `exactly one blank between the paragraphs: ${out}`);
});

// ---- 'tight' rhythm (note face — zero paragraph margins) ----

test('tight: paragraph-model blocks (ChatGPT/Word <p>s) get an explicit blank line between them', () => {
  const out = sanitizePastedHtml('<p>פסקה ראשונה.</p><p>פסקה שנייה.</p>', 'tight');
  assert.equal(out, '<p>פסקה ראשונה.</p><p></p><p>פסקה שנייה.</p>');
});

test('tight: no gap is inserted next to an already-blank paragraph (Word &nbsp; blanks)', () => {
  const out = sanitizePastedHtml('<p>א</p><p>&nbsp;</p><p>ב</p>', 'tight');
  const empties = (out.match(/<p[^>]*>(?:&nbsp;|\s)*<\/p>/g) || []).length;
  assert.equal(empties, 1, `exactly the author's one blank survives: ${out}`);
});

test('tight: WhatsApp literal-newline paste keeps every blank line', () => {
  const out = sanitizePastedHtml(
    '<span class="copyable-text">שלום רב,\nרצינו לבדוק.\n\nתודה,\nורד</span>',
    'tight',
  );
  assert.equal(out, '<p>שלום רב,<br>רצינו לבדוק.</p><p></p><p>תודה,<br>ורד</p>');
});

test('tight: the line-derived marker attribute never leaks into the output', () => {
  const out = sanitizePastedHtml(
    '<div>שורה</div><div><br></div><p>פסקה</p>',
    'tight',
  );
  assert.doesNotMatch(out, /data-gos-line/);
});

test('edge blanks are trimmed in spaced rhythm too (<p>&nbsp;</p> selection junk)', () => {
  const out = sanitizePastedHtml('<p>&nbsp;</p><p>תוכן</p><p><br></p>');
  assert.equal(out, '<p>תוכן</p>');
});
