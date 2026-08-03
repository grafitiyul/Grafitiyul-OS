// The context block is read-only canonical data scoped to ONE booking.
// The two things that must never break: it cannot leak another customer, and it
// cannot render a label with nothing behind it.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTEXT_FIELDS, renderContextBlock, defaultContextConfig,
  bookingSeatCount, coordinationContact, contextCatalogForPicker,
} from './contextCatalog.js';
import { GENERIC_ACTIVITY_EN, GENERIC_ACTIVITY_HE } from '../displayFallbacks.js';

const scopeFor = ({ seats = [], contactName = ['דנה', 'לוי'], phone = '050-1111111', org = 'עיריית תל אביב' } = {}) => ({
  booking: { id: 'bk1', seats: 0, notes: null, ticketRegistrations: seats.map((q) => ({ quantity: q })) },
  deal: {
    id: 'd1', orderNo: 27184, title: 'סיור', tourLanguage: 'he', customerInfo: '<p>קבוצה גדולה</p>', notes: null,
    organization: org ? { name: org } : null,
    contacts: [{
      isPrimary: true, roles: [],
      contact: { firstNameHe: contactName[0], lastNameHe: contactName[1], phones: phone ? [{ value: phone }] : [] },
    }],
  },
  tour: {
    id: 't1', date: '2026-09-16', startTime: '10:00', tourLanguage: 'he', notes: 'להביא מפתח',
    product: { nameHe: 'סיור וסדנת גרפיטי' },
    productVariant: { location: { nameHe: 'פלורנטין' } },
    location: { nameHe: 'תל אביב' },
    assignments: [{ personRef: { displayName: 'יואב כהן' } }],
  },
});

const byKey = (block) => Object.fromEntries(block.map((f) => [f.key, f.value]));

// ── scoping ──────────────────────────────────────────────────────────────────

test('the participant count is THIS booking\'s registrations, never the tour total', () => {
  const block = renderContextBlock(defaultContextConfig(), scopeFor({ seats: [2, 3] }), 'he');
  assert.equal(byKey(block).participants, '5');
});

test('two bookings on one tour produce two different blocks', () => {
  const cfg = defaultContextConfig();
  const a = byKey(renderContextBlock(cfg, scopeFor({ seats: [2], contactName: ['דנה', 'לוי'], phone: '050-1111111' }), 'he'));
  const b = byKey(renderContextBlock(cfg, scopeFor({ seats: [8], contactName: ['רון', 'ברק'], phone: '050-2222222' }), 'he'));
  assert.equal(a.participants, '2');
  assert.equal(b.participants, '8');
  assert.equal(a.customer_name, 'דנה לוי');
  assert.equal(b.customer_name, 'רון ברק');
  // The decisive one: neither block contains any trace of the other customer.
  const aText = JSON.stringify(a);
  assert.ok(!aText.includes('רון'), 'no other customer name');
  assert.ok(!aText.includes('2222222'), 'no other customer phone');
});

// ── privacy: internal CRM wording never renders ─────────────────────────────

test('privacy: tour_name is the PRODUCT name — internal Deal.title never renders', () => {
  const scope = scopeFor();
  scope.deal.title = 'ליד חדש - לילי';
  const block = renderContextBlock(defaultContextConfig(), scope, 'he');
  assert.equal(byKey(block).tour_name, 'סיור וסדנת גרפיטי');
  assert.ok(!JSON.stringify(block).includes('ליד חדש'), 'internal CRM title must not reach the form');
});

test('privacy: tour_name without a product → localized generic, still never Deal.title', () => {
  const scope = scopeFor();
  scope.deal.title = 'ליד חדש - לילי';
  scope.tour.product = null;
  assert.equal(byKey(renderContextBlock(defaultContextConfig(), scope, 'he')).tour_name, GENERIC_ACTIVITY_HE);
  assert.equal(byKey(renderContextBlock(defaultContextConfig(), scope, 'en')).tour_name, GENERIC_ACTIVITY_EN);
});

test('seat truth prefers registrations; Booking.seats is only the last resort', () => {
  assert.equal(bookingSeatCount({ seats: 99, ticketRegistrations: [{ quantity: 4 }, { quantity: 1 }] }), 5);
  assert.equal(bookingSeatCount({ seats: 7, ticketRegistrations: [] }), 7);
  assert.equal(bookingSeatCount({ seats: null, ticketRegistrations: [] }), null);
});

test('the coordination contact is coordinator, then primary, then first', () => {
  const c = (n, over) => ({ contact: { firstNameHe: n }, ...over });
  assert.equal(coordinationContact({ contacts: [c('א', { isPrimary: true }), c('ב', { roles: ['coordinator'] })] }).firstNameHe, 'ב');
  assert.equal(coordinationContact({ contacts: [c('א', {}), c('ב', { isPrimary: true })] }).firstNameHe, 'ב');
  assert.equal(coordinationContact({ contacts: [c('א', {})] }).firstNameHe, 'א');
  assert.equal(coordinationContact({ contacts: [] }), null);
  assert.equal(coordinationContact(null), null);
});

// ── rendering discipline ─────────────────────────────────────────────────────

test('a field with no value is OMITTED, never rendered as an empty label', () => {
  const scope = scopeFor({ org: null, phone: null });
  const block = renderContextBlock(defaultContextConfig(), scope, 'he');
  const keys = block.map((f) => f.key);
  assert.ok(!keys.includes('organization'), 'no organization row for a private customer');
  assert.ok(!keys.includes('customer_phone'), 'no phone row when there is no phone');
  for (const f of block) assert.ok(String(f.value).trim() !== '', `${f.key} has a value`);
});

test('a disabled field is dropped and order follows the configuration', () => {
  const cfg = [
    { key: 'tour_time', enabled: true },
    { key: 'tour_date', enabled: true },
    { key: 'customer_name', enabled: false },
  ];
  const block = renderContextBlock(cfg, scopeFor(), 'he');
  assert.deepEqual(block.map((f) => f.key), ['tour_time', 'tour_date']);
});

test('an unknown key is dropped rather than rendered blank', () => {
  const block = renderContextBlock(
    [{ key: 'a_field_that_was_removed', enabled: true, labelHe: 'משהו' }, { key: 'tour_date', enabled: true }],
    scopeFor(), 'he',
  );
  assert.deepEqual(block.map((f) => f.key), ['tour_date']);
});

test('the operator label overrides the catalog label, per language', () => {
  const cfg = [{ key: 'participants', enabled: true, labelHe: 'כמה באים', labelEn: 'How many' }];
  assert.equal(renderContextBlock(cfg, scopeFor({ seats: [3] }), 'he')[0].label, 'כמה באים');
  assert.equal(renderContextBlock(cfg, scopeFor({ seats: [3] }), 'en')[0].label, 'How many');
});

test('rich fields are marked so the caller renders them, never escapes them', () => {
  const block = renderContextBlock(defaultContextConfig(), scopeFor(), 'he');
  const info = block.find((f) => f.key === 'customer_info');
  assert.ok(info, 'customer info is present');
  assert.equal(info.rich, true);
  assert.ok(info.value.includes('<p>'), 'HTML is preserved for the renderer');
});

test('one broken field cannot take down the whole block', () => {
  const exploding = { booking: null, deal: null, get tour() { throw new Error('boom'); } };
  // Every field throws here; the block is empty rather than the request failing.
  assert.doesNotThrow(() => renderContextBlock(defaultContextConfig(), exploding, 'he'));
});

// ── the allowlist ────────────────────────────────────────────────────────────

test('the picker exposes ONLY catalog fields, with no resolver leaked', () => {
  const picker = contextCatalogForPicker();
  assert.equal(picker.length, CONTEXT_FIELDS.length);
  for (const item of picker) {
    assert.deepEqual(Object.keys(item).sort(), ['key', 'labelEn', 'labelHe', 'rich']);
    assert.equal(typeof item.resolve, 'undefined', 'no resolver crosses the API boundary');
  }
});

test('every catalog field has both labels and a resolver', () => {
  for (const f of CONTEXT_FIELDS) {
    assert.ok(f.labelHe && f.labelEn, `${f.key} is labelled in both languages`);
    assert.equal(typeof f.resolve, 'function', `${f.key} resolves`);
  }
  assert.equal(new Set(CONTEXT_FIELDS.map((f) => f.key)).size, CONTEXT_FIELDS.length, 'keys are unique');
});
