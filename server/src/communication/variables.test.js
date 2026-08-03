import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractTokens, resolveVariables, substituteTokens, substituteHtmlTokens, variablesForTrigger,
} from './variables.js';
import { contentForLanguage } from './render.js';
import { formatMoney, formatDateHe } from './format.js';

const CTX = {
  contact: {
    firstNameHe: 'דנה', lastNameHe: 'לוי', firstNameEn: 'Dana', lastNameEn: 'Levi',
    phones: [{ value: '050-1234567', isPrimary: true }],
    emails: [{ value: 'dana@x.co', isPrimary: true }],
    communicationLanguage: 'he',
  },
  deal: { orderNo: 27123, title: 'סיור גרפיטי', participants: 25, tourDate: '2026-08-10', tourTime: '10:00' },
  org: { name: 'בי״ס אלון', organizationType: { label: 'בית ספר', labelEn: 'School' } },
  tour: {
    date: '2026-08-10', startTime: '10:00', tourLanguage: 'he',
    product: { nameHe: 'סיור גרפיטי', nameEn: 'Graffiti Tour' },
    location: { nameHe: 'תל אביב', nameEn: 'Tel Aviv' },
    assignments: [
      { personRef: { displayName: 'יואב' } },
      { personRef: { displayName: 'מיכל' } },
    ],
  },
  payment: { totalMinor: 250000, paidMinor: 100000, balanceMinor: 150000, currency: 'ILS' },
  quoteDoc: { publicToken: 'tok123', versionNo: 2 },
  links: { origin: 'https://gos.example', paymentUrl: 'https://gos.example/payment/icount/abc' },
};

test('extractTokens finds {{tokens}} and chip spans', () => {
  const html = 'שלום {{customer_first_name}} <span data-type="dynamic-field" data-field-key="tour_date">תאריך</span>';
  assert.deepEqual(new Set(extractTokens(html)), new Set(['customer_first_name', 'tour_date']));
});

test('resolution: customer / tour / payment / quote variables', () => {
  const { values, missing, unknown } = resolveVariables(
    ['customer_first_name', 'tour_product', 'tour_date', 'payment_balance', 'quote_link', 'guide_names', 'deal_number'],
    CTX, 'he',
  );
  assert.equal(values.customer_first_name, 'דנה');
  assert.equal(values.tour_product, 'סיור גרפיטי');
  assert.equal(values.tour_date, '10/08/2026');
  assert.equal(values.payment_balance, '₪1,500');
  assert.equal(values.quote_link, 'https://gos.example/quote/tok123');
  assert.equal(values.guide_names, 'יואב, מיכל');
  assert.equal(values.deal_number, '27123');
  assert.deepEqual(missing, []);
  assert.deepEqual(unknown, []);
});

test('English resolution prefers EN fields', () => {
  const { values } = resolveVariables(['customer_first_name', 'tour_product', 'tour_city'], CTX, 'en');
  assert.equal(values.customer_first_name, 'Dana');
  assert.equal(values.tour_product, 'Graffiti Tour');
  assert.equal(values.tour_city, 'Tel Aviv');
});

test('privacy: group_name is groupName → product → generic, NEVER internal Deal.title', () => {
  const leadDeal = { orderNo: 27123, title: 'ליד חדש - לילי', groupName: null };
  // Real group name wins.
  const named = resolveVariables(['group_name'], { ...CTX, deal: { ...leadDeal, groupName: 'שכבת ז׳' } }, 'he');
  assert.equal(named.values.group_name, 'שכבת ז׳');
  // No group name → the activity's product name, in the message language.
  const product = resolveVariables(['group_name'], { ...CTX, deal: leadDeal }, 'he');
  assert.equal(product.values.group_name, 'סיור גרפיטי');
  const productEn = resolveVariables(['group_name'], { ...CTX, deal: leadDeal }, 'en');
  assert.equal(productEn.values.group_name, 'Graffiti Tour');
  // No product anywhere → localized generic; the internal title never leaks.
  const bare = resolveVariables(['group_name'], { deal: leadDeal, tour: null }, 'he');
  assert.equal(bare.values.group_name, 'הפעילות');
  const bareEn = resolveVariables(['group_name'], { deal: leadDeal, tour: null }, 'en');
  assert.equal(bareEn.values.group_name, 'the activity');
  for (const v of [named, product, productEn, bare, bareEn]) {
    assert.ok(!JSON.stringify(v.values).includes('ליד חדש'));
  }
  // The explicit operator variable is the ONE approved exception.
  const explicit = resolveVariables(['deal_title'], { ...CTX, deal: leadDeal }, 'he');
  assert.equal(explicit.values.deal_title, 'ליד חדש - לילי');
});

test('missing values are reported, never silently substituted', () => {
  const { values, missing } = resolveVariables(['customer_phone'], { contact: { phones: [] } }, 'he');
  assert.equal(values.customer_phone, null);
  assert.deepEqual(missing, ['customer_phone']);
  // substitution leaves the token visible rather than inventing text
  assert.equal(substituteTokens('טל: {{customer_phone}}', values), 'טל: {{customer_phone}}');
});

test('unknown variables are reported', () => {
  const { unknown } = resolveVariables(['no_such_var'], CTX, 'he');
  assert.deepEqual(unknown, ['no_such_var']);
});

test('plain substitution + HTML chip substitution (escaped)', () => {
  const values = { customer_first_name: 'ד<נה' };
  assert.equal(substituteTokens('שלום {{customer_first_name}}', values), 'שלום ד<נה');
  const html = '<p>שלום <span data-type="dynamic-field" data-field-key="customer_first_name">שם</span></p>';
  assert.equal(substituteHtmlTokens(html, values), '<p>שלום ד&lt;נה</p>');
});

test('variablesForTrigger filters by context', () => {
  const dealOnly = variablesForTrigger(['deal']);
  assert.ok(dealOnly.some((v) => v.key === 'deal_number'));
  assert.ok(!dealOnly.some((v) => v.key === 'payment_balance'));
  const withPayment = variablesForTrigger(['deal', 'payment']);
  assert.ok(withPayment.some((v) => v.key === 'payment_balance'));
});

test('language fallback picks requested → fallback → whichever exists', () => {
  const content = { he: { body: '<p>עברית</p>' }, en: { body: '' } };
  assert.equal(contentForLanguage(content, 'en', 'he').lang, 'he');
  assert.equal(contentForLanguage(content, 'he', 'he').lang, 'he');
  assert.equal(contentForLanguage({ en: { body: '<p>EN</p>' } }, 'he', 'he').lang, 'en');
  assert.equal(contentForLanguage({}, 'he', 'he'), null);
});

test('money + date formatting', () => {
  assert.equal(formatMoney(123456), '₪1,234.56');
  assert.equal(formatMoney(250000), '₪2,500');
  assert.equal(formatMoney(null), null);
  assert.equal(formatDateHe('2026-01-05'), '05/01/2026');
  assert.equal(formatDateHe('bad'), null);
});
