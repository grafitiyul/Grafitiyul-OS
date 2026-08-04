import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDocumentNotes, documentNotesText, htmlNotesToText, NOTES_UNREADABLE_WARNING } from './documentNotes.js';

// The customer-facing invariant this whole module exists to hold: no matter
// what the source stored, the text handed to the operator (and to iCount) never
// contains markup or JSON syntax.
function assertCustomerSafe(text) {
  assert.ok(!/[<>]/.test(text), `markup leaked: ${JSON.stringify(text)}`);
  assert.ok(!/["{}[\]]\s*:/.test(text), `JSON key syntax leaked: ${JSON.stringify(text)}`);
  assert.ok(!/^\s*[{[]/.test(text), `JSON opening brace leaked: ${JSON.stringify(text)}`);
  assert.ok(!/&(?:#\d+|[a-z]+);/i.test(text), `HTML entity leaked: ${JSON.stringify(text)}`);
}

// 1 ── Plain text is returned as-is (only whitespace discipline applies).
test('plain-text notes pass through unchanged', () => {
  const src = 'שם הקבוצה: Abrams\nתאריך הסיור: 25-07-2026\nכמות משתתפים: 4';
  const out = normalizeDocumentNotes(src);
  assert.equal(out.format, 'plain');
  assert.equal(out.text, src);
  assertCustomerSafe(out.text);
});

test('empty / missing notes normalize to empty with no warning', () => {
  for (const v of [null, undefined, '', '   ', '\n\n']) {
    const out = normalizeDocumentNotes(v);
    assert.equal(out.text, '');
    assert.equal(out.format, 'empty');
    assert.equal(out.warning, null);
  }
});

// 2 ── Rich HTML becomes readable text; tags are never shown.
test('HTML notes render as text with real line breaks', () => {
  const out = normalizeDocumentNotes('<div>שורה ראשונה<br />שורה שנייה</div>');
  assert.equal(out.format, 'html');
  assert.equal(out.text, 'שורה ראשונה\nשורה שנייה');
  assertCustomerSafe(out.text);
});

test('HTML block structure and lists become plain line breaks and bullets', () => {
  const out = normalizeDocumentNotes('<p>כותרת</p><ul><li>ראשון</li><li>שני</li></ul>');
  assert.equal(out.text, 'כותרת\n• ראשון\n• שני');
  assertCustomerSafe(out.text);
});

test('entities are decoded after tags are stripped (escaped markup stays escaped text)', () => {
  assert.equal(htmlNotesToText('<div>a &amp; b&nbsp;c</div>'), 'a & b c');
  // &lt;div&gt; is CONTENT, not a tag — it must not be re-read as markup.
  assert.equal(htmlNotesToText('<div>&lt;div&gt;</div>'), '<div>');
});

// 3 ── A JSON string carrying the customer text.
test('JSON-string notes yield the customer text, never the JSON', () => {
  const out = normalizeDocumentNotes('{"text":"ניתן לשלם בהעברה בנקאית","internal":"do-not-send"}');
  assert.equal(out.format, 'json');
  assert.equal(out.text, 'ניתן לשלם בהעברה בנקאית');
  assertCustomerSafe(out.text);
});

test('JSON string whose customer field is itself HTML is rendered as text', () => {
  const out = normalizeDocumentNotes('{"notes":"<div>שלום<br />עולם</div>"}');
  assert.equal(out.text, 'שלום\nעולם');
  assertCustomerSafe(out.text);
});

// 4 ── An already-parsed object (a Json column / legacy import).
test('parsed object notes extract the same canonical field', () => {
  const out = normalizeDocumentNotes({ text: 'תוכן ללקוח', meta: { id: 7 } });
  assert.equal(out.format, 'object');
  assert.equal(out.text, 'תוכן ללקוח');
  assertCustomerSafe(out.text);
});

test('array payloads join their readable parts', () => {
  const out = normalizeDocumentNotes([{ text: 'חלק א' }, { text: 'חלק ב' }]);
  assert.equal(out.text, 'חלק א\nחלק ב');
});

// 5 ── Bilingual content follows the DOCUMENT language, Hebrew as the fallback.
test('bilingual notes resolve to the document language', () => {
  const payload = { he: 'טקסט בעברית', en: 'English text' };
  assert.equal(documentNotesText(payload, { language: 'he' }), 'טקסט בעברית');
  assert.equal(documentNotesText(payload, { language: 'en' }), 'English text');
});

test('a missing English side falls back to Hebrew (existing document-language policy)', () => {
  assert.equal(documentNotesText({ he: 'רק עברית' }, { language: 'en' }), 'רק עברית');
});

// 6 ── Malformed / unreadable legacy structures.
test('malformed JSON does not crash and never emits raw syntax', () => {
  const out = normalizeDocumentNotes('{"text":"נשבר באמצע');
  assert.equal(out.text, '');
  assert.equal(out.format, 'unreadable');
  assert.equal(out.warning, NOTES_UNREADABLE_WARNING);
});

test('well-formed JSON with no customer-facing field warns instead of leaking keys', () => {
  const out = normalizeDocumentNotes('{"internalId":42,"flags":{"x":true}}');
  assert.equal(out.text, '');
  assert.equal(out.format, 'unreadable');
  assert.equal(out.warning, NOTES_UNREADABLE_WARNING);
});

test('prose that merely starts with a brace is treated as text, not as JSON', () => {
  const out = normalizeDocumentNotes('{הערה חשובה ללקוח}');
  assert.equal(out.format, 'plain');
  assert.equal(out.text, '{הערה חשובה ללקוח}');
});

// 7 ── Preview value === iCount payload value.
// Both surfaces call the SAME function; normalization is idempotent, so the
// text the operator reviewed survives the second pass at the payload boundary
// byte-for-byte.
test('normalization is idempotent — preview text equals payload text', () => {
  const sources = [
    'טקסט רגיל\nשורה שנייה',
    '<div>מסמך<br /><br />עם רווח</div>',
    '{"text":"<p>מבנה מקונן</p>"}',
    { he: 'דו לשוני', en: 'Bilingual' },
    '{"broken":',
    '',
  ];
  for (const src of sources) {
    const preview = documentNotesText(src);
    const payload = documentNotesText(preview); // what buildIssuePayload does
    assert.equal(payload, preview, `not idempotent for ${JSON.stringify(src)}`);
    assertCustomerSafe(payload);
  }
});

// 8 ── The exact production shape from Deal #25707 → base document 54513.
test('Deal #25707 production fixture (iCount-authored HTML hwc)', () => {
  const stored =
    '<div>סדנה למחלקת נשים ויולדות<br /><br />ניתן לשלם בהעברה בנקאית לחשבון: ' +
    'גרפיטיול בע"מ, הפועלים - בנק 12, סניף 500- הרימון, מס\' חשבון: 219587</div>';
  const out = normalizeDocumentNotes(stored, { language: 'he' });
  assert.equal(out.format, 'html');
  assert.equal(out.warning, null);
  assert.equal(
    out.text,
    'סדנה למחלקת נשים ויולדות\n\n' +
      'ניתן לשלם בהעברה בנקאית לחשבון: גרפיטיול בע"מ, הפועלים - בנק 12, סניף 500- הרימון, מס\' חשבון: 219587',
  );
  assertCustomerSafe(out.text);
  // The blank line the customer sees on the original document survives.
  assert.equal(out.text.split('\n').length, 3);
});

// 9 ── The blanket guarantee across every shape this normalizer accepts.
test('no JSON braces/keys or tags ever reach customer-facing output', () => {
  const hostile = [
    '{"text":"ok","raw":{"a":1}}',
    '[{"he":"<b>מודגש</b>"}]',
    '<script>alert(1)</script><div>נקי</div>',
    '<div style="color:red" onclick="x()">טקסט</div>',
    '{"unclosed": "x"',
    '{"nothing":123}',
  ];
  for (const src of hostile) assertCustomerSafe(normalizeDocumentNotes(src).text);
  assert.equal(normalizeDocumentNotes('<script>alert(1)</script><div>נקי</div>').text, 'נקי');
  // Escaped angle brackets are AUTHOR CONTENT, not markup we failed to strip:
  // they decode to literal characters and are the one legitimate way a '<' can
  // appear in customer-facing output.
  assert.equal(normalizeDocumentNotes('a &lt;b&gt; c &amp;&nbsp;d').text, 'a <b> c & d');
});
