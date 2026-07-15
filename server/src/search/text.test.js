import test from 'node:test';
import assert from 'node:assert/strict';
import { stripHtml, snippet, contains, equals, startsWith, fullNameHe, fullNameEn } from './text.js';
import { escapeLike, legacyCardHit } from './lookups.js';

test('stripHtml keeps the visible text and drops the markup', () => {
  assert.equal(stripHtml('<p>שלום <b>עולם</b></p>'), 'שלום עולם');
  assert.equal(stripHtml('<p>one</p><p>two</p>'), 'one two');
  assert.equal(stripHtml('a<br>b'), 'a b');
  assert.equal(stripHtml('<script>evil()</script>hi'), 'hi');
  assert.equal(stripHtml(null), '');
});

test('stripHtml decodes entities', () => {
  assert.equal(stripHtml('a&nbsp;b &amp; c &quot;d&quot;'), 'a b & c "d"');
});

// This is the guard that stops "div"/"href" matching every note ever written.
test('markup is not searchable text', () => {
  const body = '<div class="rt-editor-prose"><a href="https://x.co">link</a></div>';
  assert.equal(contains(stripHtml(body), 'div'), false);
  assert.equal(contains(stripHtml(body), 'href'), false);
  assert.equal(contains(stripHtml(body), 'link'), true);
});

test('snippet centres on the match and never returns HTML', () => {
  const body = `<p>${'a'.repeat(200)} מילת מפתח ${'b'.repeat(200)}</p>`;
  const s = snippet(body, 'מילת מפתח');
  assert.equal(s.includes('מילת מפתח'), true);
  assert.equal(s.includes('<'), false);
  assert.equal(s.startsWith('…'), true);
  assert.equal(s.endsWith('…'), true);
  assert.equal(s.length < 150, true);
});

test('snippet on a miss returns a bounded plain-text head', () => {
  assert.equal(snippet('<p>short</p>', 'zzz'), 'short');
});

test('comparison helpers are case-insensitive and null-safe', () => {
  assert.equal(equals('Acme', 'acme'), true);
  assert.equal(equals(null, ''), false);
  assert.equal(startsWith('Acme Ltd', 'acme'), true);
  assert.equal(contains('Acme Ltd', 'ME L'), true);
  assert.equal(contains(null, 'x'), false);
  assert.equal(contains('x', ''), false);
});

test('full names are derived in both languages', () => {
  const c = { firstNameHe: 'דור', lastNameHe: 'כהן', firstNameEn: 'Dor', lastNameEn: 'Cohen' };
  assert.equal(fullNameHe(c), 'דור כהן');
  assert.equal(fullNameEn(c), 'Dor Cohen');
  assert.equal(fullNameHe({ firstNameHe: 'דור' }), 'דור');
});

// A user typing '%' must not turn their query into "match everything".
test('escapeLike neutralises LIKE wildcards', () => {
  assert.equal(escapeLike('100%'), '100~%');
  assert.equal(escapeLike('a_b'), 'a~_b');
  assert.equal(escapeLike('a~b'), 'a~~b');
  assert.equal(escapeLike('plain'), 'plain');
});

test('legacyCardHit finds the matching curated pair, by value or label', () => {
  const card = { 'בעלים במערכת הקודמת': 'דנה', 'הערת תמחור': 'הנחה 10% ללקוח חוזר' };
  assert.deepEqual(legacyCardHit(card, 'הנחה'), {
    label: 'הערת תמחור',
    value: 'הנחה 10% ללקוח חוזר',
  });
  assert.equal(legacyCardHit(card, 'בעלים').label, 'בעלים במערכת הקודמת');
  assert.equal(legacyCardHit(card, 'nope'), null);
  assert.equal(legacyCardHit(null, 'x'), null);
});

test('legacyCardHit also accepts the array card shape', () => {
  const card = [{ label: 'שלב קודם', value: 'הצעה נשלחה' }];
  assert.deepEqual(legacyCardHit(card, 'הצעה'), { label: 'שלב קודם', value: 'הצעה נשלחה' });
});
