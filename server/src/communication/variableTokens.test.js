import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTokensToChips, chipHtml, referencedKeys, RAW_TOKEN_RE } from '../../../shared/variableTokens.mjs';
import { variableByKey, extractTokens, substituteTokens, substituteHtmlTokens } from './variables.js';
import { htmlToWhatsApp } from '../../../shared/waMarkup.mjs';

const label = (key) => variableByKey(key)?.labelHe || null;

test('recognized raw token in stored HTML normalizes to the canonical chip', () => {
  const html = '<p>שלום {{customer_first_name}}!</p>';
  const out = normalizeTokensToChips(html, label);
  assert.equal(out, `<p>שלום ${chipHtml('customer_first_name', 'שם פרטי של הלקוח')}!</p>`);
  assert.ok(out.includes('data-type="dynamic-field"'));
  assert.ok(out.includes('data-field-key="customer_first_name"'));
});

test('unknown tokens are left untouched (visible + flaggable, never rewritten)', () => {
  const html = '<p>{{customerfullname}} {{tourtime}}</p>';
  assert.equal(normalizeTokensToChips(html, label), html);
});

test('existing chip spans pass through unchanged (no double wrapping)', () => {
  const chip = chipHtml('tour_date', 'תאריך הסיור');
  const html = `<p>מועד: ${chip}</p>`;
  assert.equal(normalizeTokensToChips(html, label), html);
});

test('mixed content: recognized converts, unknown stays, chips stay', () => {
  const html = `<p>${chipHtml('tour_time', 'שעת הסיור')} {{tour_date}} {{tourdate}}</p>`;
  const out = normalizeTokensToChips(html, label);
  assert.ok(out.includes('data-field-key="tour_time"'));
  assert.ok(out.includes('data-field-key="tour_date"'));
  assert.ok(out.includes('{{tourdate}}')); // unknown — still visible
});

test('whitespace-tolerant moustache is normalized too', () => {
  const out = normalizeTokensToChips('<p>{{ tour_date }}</p>', label);
  assert.ok(out.includes('data-field-key="tour_date"'));
});

test('normalized chips serialize to WhatsApp {{key}} exactly like picker chips', () => {
  const out = normalizeTokensToChips('<p>מחר {{tour_date}} ב{{tour_time}}</p>', label);
  assert.equal(htmlToWhatsApp(out), 'מחר {{tour_date}} ב{{tour_time}}');
});

test('render substitution handles BOTH representations identically (legacy compatibility)', () => {
  const values = { tour_date: '10/08/2026' };
  const rawForm = 'תאריך: {{tour_date}}';
  const chipForm = `תאריך: ${htmlToWhatsApp(chipHtml('tour_date', 'תאריך'))}`;
  assert.equal(substituteTokens(rawForm, values), substituteTokens(chipForm, values));
  // Email HTML path: chip span and raw token resolve to the same value.
  const htmlChip = `<p>${chipHtml('tour_date', 'תאריך')}</p>`;
  const htmlRaw = '<p>{{tour_date}}</p>';
  assert.equal(substituteHtmlTokens(htmlChip, values), '<p>10/08/2026</p>');
  assert.equal(substituteHtmlTokens(htmlRaw, values), '<p>10/08/2026</p>');
});

test('preview missing-labels: recognized-missing shows a readable marker, unknown stays raw', () => {
  const out = substituteTokens('שלום {{customer_first_name}} {{nosuchvar}}', {}, { missingLabels: true });
  assert.equal(out, 'שלום ⟨שם פרטי של הלקוח — חסר⟩ {{nosuchvar}}');
  const html = substituteHtmlTokens('<p>{{customer_first_name}}</p>', { customer_first_name: null }, { missingLabels: true });
  assert.ok(html.includes('⟨שם פרטי של הלקוח — חסר⟩'));
  assert.ok(!html.includes('{{customer_first_name}}'));
});

test('referencedKeys/extractTokens agree across chip + raw forms', () => {
  const html = `<p>${chipHtml('tour_city', 'עיר')} {{payment_balance}}</p>`;
  assert.deepEqual(new Set(referencedKeys(html)), new Set(['tour_city', 'payment_balance']));
  assert.deepEqual(new Set(extractTokens(html)), new Set(['tour_city', 'payment_balance']));
});

test('RAW_TOKEN_RE matches canonical keys only (lowercase + underscores)', () => {
  assert.ok('{{customer_first_name}}'.match(RAW_TOKEN_RE));
  assert.equal(String('{{Not_Valid}}').match(RAW_TOKEN_RE), null);
});
