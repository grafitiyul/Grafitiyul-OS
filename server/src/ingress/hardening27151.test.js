// The #27151 ingest-hardening class, tested against the REAL payload shape that
// produced the defects (Woo order 2261, grafitiyul.co.il, 2026-08-07).

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhoneIntl } from '../../../shared/phone.mjs';
import { normalizeEvent } from './normalize.js';
import { resolveIngressLanguage } from './language.js';
import { gatewayPayment, toCanonicalEvent } from './adapters/woocommerce.js';
import { classifyDeal, COLLECTION_REVIEW_STATUS, SOURCE } from '../collectionWorkQueue.js';

// ── Phone: a leading zero is not evidence of Israel ──────────────────────────

test('the #27151 French number is no longer rewritten as Israeli', () => {
  // 06 69 12 97 85 — a valid French mobile. It used to become '972669129785',
  // a number that reaches nobody.
  assert.equal(normalizePhoneIntl('0669129785'), null);
  assert.notEqual(normalizePhoneIntl('0669129785'), '972669129785');
});

test('a trusted billing country resolves the same number correctly', () => {
  assert.equal(normalizePhoneIntl('0669129785', { country: 'FR' }), '33669129785');
  assert.equal(normalizePhoneIntl('06 69 12 97 85', { country: 'fr' }), '33669129785');
});

test('real Israeli numbers still normalize exactly as before', () => {
  assert.equal(normalizePhoneIntl('050-123-4567'), '972501234567');
  assert.equal(normalizePhoneIntl('0541234567'), '972541234567');
  assert.equal(normalizePhoneIntl('058-765-4321'), '972587654321');
  assert.equal(normalizePhoneIntl('073-1234567'), '972731234567'); // VoIP
  assert.equal(normalizePhoneIntl('03-1234567'), '97231234567'); // landline
  assert.equal(normalizePhoneIntl('02-1234567'), '97221234567');
  assert.equal(normalizePhoneIntl('+972 50 1234567'), '972501234567');
  assert.equal(normalizePhoneIntl('972050-1234567'), '972501234567');
});

test('an Israeli country hint never breaks an Israeli number', () => {
  assert.equal(normalizePhoneIntl('0501234567', { country: 'IL' }), '972501234567');
});

test('prefixes outside the Israeli plan are refused, not nationalized', () => {
  for (const bad of ['0669129785', '0112345678', '0612345678', '0012345678']) {
    const out = normalizePhoneIntl(bad);
    assert.ok(out === null || !out.startsWith('972'), `${bad} must not become an Israeli number`);
  }
});

test('an unknown country hint is not a licence to guess', () => {
  assert.equal(normalizePhoneIntl('0669129785', { country: 'ZZ' }), null);
  assert.equal(normalizePhoneIntl('0669129785', { country: '' }), null);
});

test('already-international foreign numbers still pass through', () => {
  assert.equal(normalizePhoneIntl('33669129785'), '33669129785');
  assert.equal(normalizePhoneIntl('+1 212 555 1234'), '12125551234');
  assert.equal(normalizePhoneIntl('0033669129785'), '33669129785');
});

test('the raw number survives even when GOS cannot place it', () => {
  const n = normalizeEvent({ source: 'woocommerce', person: { phone: '0669129785', email: 'a@b.com' } });
  assert.equal(n.person.phoneIntl, null, 'no fake international identity');
  assert.equal(n.person.phoneDisplay, '0669129785', 'but a human can still read and dial it');
  assert.equal(n.person.phoneRaw, '0669129785');
});

test('junk is still junk', () => {
  const n = normalizeEvent({ source: 's', person: { phone: '123' } });
  assert.equal(n.person.phoneIntl, null);
  assert.equal(n.person.phoneDisplay, null);
});

// ── Language ─────────────────────────────────────────────────────────────────

const person = (o) => ({ person: { firstName: '', lastName: '', ...o } });

test('the #27151 customer would now be routed to English', () => {
  const n = normalizeEvent({
    source: 'woocommerce',
    person: { firstName: 'Sabrina', lastName: 'Aouizerate', phone: '0669129785', email: 's@x.com', country: '' },
  });
  assert.equal(resolveIngressLanguage(n), 'en');
});

test('a Latin name alone is NOT enough to switch a customer to English', () => {
  // An Israeli who typed their name in Latin letters stays Hebrew.
  assert.equal(resolveIngressLanguage(person({
    firstName: 'Yossi', lastName: 'Cohen', phoneIntl: '972501234567', phoneRaw: '0501234567',
  })), null);
});

test('a Hebrew name is never switched, whatever the country', () => {
  assert.equal(resolveIngressLanguage(person({
    firstName: 'שרון', lastName: 'לוי', country: 'FR', phoneIntl: '33669129785',
  })), null);
});

test('a foreign billing country plus a Latin name is decisive', () => {
  assert.equal(resolveIngressLanguage(person({
    firstName: 'John', lastName: 'Smith', country: 'US', phoneIntl: '12125551234',
  })), 'en');
});

test('an explicitly stated language always wins', () => {
  assert.equal(resolveIngressLanguage(person({ firstName: 'John', lastName: 'Smith', language: 'he', country: 'US' })), 'he');
  assert.equal(resolveIngressLanguage(person({ firstName: 'דנה', lastName: 'כהן', language: 'en-GB' })), 'en');
});

test('a mixed-script name is never guessed', () => {
  assert.equal(resolveIngressLanguage(person({
    firstName: 'Dana', lastName: 'כהן', country: 'FR',
  })), null);
});

// ── Gateway payment truth ────────────────────────────────────────────────────

// The real order-2261 meta, verbatim.
const ORDER_2261 = {
  id: 2261,
  status: 'processing',
  total: '250.00',
  currency: 'ILS',
  payment_method: 'tranzila',
  payment_method_title: 'לחצו על "שליחת הזמנה" ותועברו לעמוד תשלום מאובטח מבית',
  transaction_id: '7578',
  date_paid_gmt: '2026-08-07T15:22:08',
  billing: { first_name: 'Sabrina', last_name: 'Aouizerate', email: 'sabrina.aouizerate@gmail.com', phone: '0669129785', country: '', city: 'Aix-En-Provence' },
  line_items: [{ product_id: 167, variation_id: 2050, name: 'סיור', quantity: 1, price: 250, total: '250.00', meta_data: [] }],
  meta_data: [
    { key: 'transaction_id', value: '7578' },
    { key: 'cc_company_approval_num', value: '0430435' },
    { key: 'מספר אישור ABS', value: '31001002' },
    { key: 'w2t_payment_method', value: 'CARD' },
    { key: 'w2t_cred_type', value: '1' },
    { key: 'w2t_sum', value: '250' },
    { key: 'tranzila_terminal_type', value: 'main' },
    { key: 'myid', value: '230452609' },
    { key: 'cardissuer', value: '0' },
    { key: 'cardaquirer', value: '7' },
    { key: 'cardtype', value: '1' },
  ],
};

test('the gateway’s real identifiers are extracted, not left in raw JSON', () => {
  const gw = gatewayPayment(ORDER_2261);
  assert.equal(gw.gateway, 'tranzila');
  assert.equal(gw.isTranzila, true);
  assert.equal(gw.transactionId, '7578');
  // The APPROVAL number — what an Israeli receipt means by "אישור".
  assert.equal(gw.approvalCode, '0430435');
  assert.equal(gw.absApprovalCode, '31001002');
  assert.equal(gw.paidAt, '2026-08-07T15:22:08');
});

test('the approval code is NOT the transaction id', () => {
  const gw = gatewayPayment(ORDER_2261);
  assert.notEqual(gw.approvalCode, gw.transactionId);
});

test('brand codes are carried verbatim and never translated to a brand name', () => {
  const gw = gatewayPayment(ORDER_2261);
  assert.equal(gw.cardTypeCode, '1');
  assert.equal(gw.cardIssuerCode, '0');
  assert.equal(gw.cardAcquirerCode, '7');
  // The whole point: GOS does not know what '1' means, so it does not say.
  assert.equal(gw.cardLast4, null);
  for (const v of Object.values(gw)) assert.notEqual(v, 'VISA');
});

test('an order with no gateway record yields null, never an empty shell', () => {
  assert.equal(gatewayPayment({ id: 1, meta_data: [] }), null);
});

test('the canonical event carries the billing country and the gateway record', () => {
  const ev = toCanonicalEvent(ORDER_2261, { storeKey: 'primary' });
  assert.equal(ev.person.country, null, 'order 2261 genuinely had no billing country');
  assert.equal(ev.extra.gatewayPayment.approvalCode, '0430435');

  const withCountry = toCanonicalEvent(
    { ...ORDER_2261, billing: { ...ORDER_2261.billing, country: 'FR' } },
    { storeKey: 'primary' },
  );
  assert.equal(withCountry.person.country, 'FR');
  // …and end-to-end, that country resolves the phone.
  assert.equal(normalizeEvent(withCountry).person.phoneIntl, '33669129785');
});

// ── Collection provenance ────────────────────────────────────────────────────

const summary = (status) => ({ status });

test('a deal paid and documented IN GOS is never called legacy', () => {
  const r = classifyDeal(summary('paid'), { settledInGos: true });
  assert.equal(r.status, COLLECTION_REVIEW_STATUS.PAID_IN_GOS);
  assert.equal(r.source, SOURCE.PAID_IN_GOS);
  assert.notEqual(r.status, COLLECTION_REVIEW_STATUS.LEGACY);
});

test('a genuinely historical deal still reads as legacy', () => {
  const r = classifyDeal(summary('paid'), { settledInGos: false });
  assert.equal(r.status, COLLECTION_REVIEW_STATUS.LEGACY);
  assert.equal(r.source, SOURCE.LEGACY);
});

test('the new provenance never outranks a real collection reason', () => {
  // Money still owed on a live tour is WORK, whoever collected the rest.
  assert.equal(
    classifyDeal(summary('partial'), { settledInGos: true, hasLiveFutureTour: true }).status,
    COLLECTION_REVIEW_STATUS.ACTIVE,
  );
  // The business's own hand-over list outranks everything.
  assert.equal(
    classifyDeal(summary('paid'), { settledInGos: true, inCollectionSnapshot: true }).source,
    SOURCE.SNAPSHOT,
  );
});
