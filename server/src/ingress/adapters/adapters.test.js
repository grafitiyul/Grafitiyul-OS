import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { safeEqual, hmacHex, hmacBase64 } from '../signature.js';
import * as meta from './meta.js';
import * as woo from './woocommerce.js';
import * as form from './websiteForm.js';
import { getAdapter, adapterStatus, ADAPTERS } from './index.js';
import { normalizeEvent } from '../normalize.js';
import { IngressError } from '../errors.js';

const ENV = [
  'META_APP_SECRET', 'META_VERIFY_TOKEN', 'META_PAGE_ACCESS_TOKEN', 'META_PAGE_ID',
  'META_ALLOWED_FORM_IDS', 'META_BLOCKED_FORM_IDS',
  'WOOCOMMERCE_BASE_URL', 'WOOCOMMERCE_CONSUMER_KEY', 'WOOCOMMERCE_CONSUMER_SECRET',
  'WOO_STORE_URL', 'WOO_CONSUMER_KEY', 'WOO_CONSUMER_SECRET',
  'WOO_PRIMARY_WEBHOOK_SECRET', 'WOO_NEW_BASE_URL', 'WOO_NEW_CONSUMER_KEY',
  'WOO_NEW_CONSUMER_SECRET', 'WOO_NEW_WEBHOOK_SECRET', 'WEBSITE_FORM_SECRET',
];

// Async-aware: an async `fn` must keep the overridden environment until it has
// actually finished, otherwise the restore races the awaits inside it.
function withEnv(overrides, fn) {
  const saved = {};
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  for (const [k, v] of Object.entries(overrides)) if (v !== undefined) process.env[k] = v;
  const restore = () => {
    for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  };
  let result;
  try {
    result = fn();
  } catch (err) {
    restore();
    throw err;
  }
  if (result && typeof result.then === 'function') {
    return result.then(
      (v) => { restore(); return v; },
      (e) => { restore(); throw e; },
    );
  }
  restore();
  return result;
}

// ── signature layer ─────────────────────────────────────────────────────────

test('signature: constant-time compare handles unequal lengths without throwing', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual('', 'x'), false);
  assert.equal(safeEqual(null, undefined), true); // both empty
});

test('signature: Meta rejects a tampered body and accepts the genuine one', () => {
  withEnv({ META_APP_SECRET: 'appsecret' }, () => {
    const body = Buffer.from(JSON.stringify({ object: 'page', entry: [] }));
    const good = `sha256=${hmacHex(body, 'appsecret')}`;
    assert.equal(meta.verify({ rawBody: body, headers: { 'x-hub-signature-256': good } }), true);

    const tampered = Buffer.from(JSON.stringify({ object: 'page', entry: [{ evil: true }] }));
    assert.throws(
      () => meta.verify({ rawBody: tampered, headers: { 'x-hub-signature-256': good } }),
      (e) => e instanceof IngressError && e.code === 'signature_invalid' && e.retryable === false,
    );
  });
});

test('signature: a missing secret is a distinct, permanent error', () => {
  withEnv({}, () => {
    assert.throws(
      () => meta.verify({ rawBody: Buffer.from('{}'), headers: { 'x-hub-signature-256': 'sha256=x' } }),
      (e) => e.code === 'signature_secret_missing',
    );
  });
});

test('signature: Woo uses base64 and is verified per store secret', () => {
  withEnv({ WOO_PRIMARY_WEBHOOK_SECRET: 's1', WOO_NEW_WEBHOOK_SECRET: 's2' }, () => {
    const body = Buffer.from(JSON.stringify({ id: 1 }));
    assert.equal(
      woo.verify({ rawBody: body, headers: { 'x-wc-webhook-signature': hmacBase64(body, 's1') }, storeKey: 'primary' }),
      true,
    );
    // The other store's secret must NOT validate this delivery.
    assert.throws(
      () => woo.verify({ rawBody: body, headers: { 'x-wc-webhook-signature': hmacBase64(body, 's1') }, storeKey: 'secondary' }),
      (e) => e.code === 'signature_invalid',
    );
  });
});

test('signature: website form accepts a shared secret or an HMAC, rejects wrong ones', () => {
  withEnv({ WEBSITE_FORM_SECRET: 'formsecret' }, () => {
    const body = Buffer.from(JSON.stringify({ name: 'x' }));
    assert.equal(form.verify({ rawBody: body, headers: {}, providedSecret: 'formsecret' }), true);
    assert.equal(
      form.verify({ rawBody: body, headers: { 'x-gos-signature': hmacBase64(body, 'formsecret') } }),
      true,
    );
    assert.throws(() => form.verify({ rawBody: body, headers: {}, providedSecret: 'nope' }), (e) => e.code === 'signature_invalid');
  });
});

// ── Meta adapter ────────────────────────────────────────────────────────────

test('meta: subscription handshake echoes the challenge only for the right token', () => {
  withEnv({ META_VERIFY_TOKEN: 'vt' }, () => {
    const ok = meta.verifySubscription({ 'hub.mode': 'subscribe', 'hub.verify_token': 'vt', 'hub.challenge': '12345' });
    assert.deepEqual(ok, { ok: true, challenge: '12345' });
    assert.deepEqual(meta.verifySubscription({ 'hub.mode': 'subscribe', 'hub.verify_token': 'bad', 'hub.challenge': 'x' }), { ok: false });
  });
});

test('meta: one delivery carrying several leads yields one notification each', () => {
  const body = {
    object: 'page',
    entry: [
      { id: '557050430995914', changes: [
        { field: 'leadgen', value: { leadgen_id: 'l1', form_id: 'f1', page_id: '557050430995914', created_time: 1700000000 } },
        { field: 'leadgen', value: { leadgen_id: 'l2', form_id: 'f2', page_id: '557050430995914' } },
      ] },
      { id: '557050430995914', changes: [{ field: 'other', value: { leadgen_id: 'ignored' } }] },
    ],
  };
  const leads = meta.extractLeads(body);
  assert.equal(leads.length, 2);
  assert.deepEqual(leads.map((l) => l.leadgenId), ['l1', 'l2']);
  assert.ok(leads[0].createdTime instanceof Date);
});

test('meta: page and form gating honour the configured allow/block lists', () => {
  withEnv({ META_PAGE_ID: '557050430995914', META_BLOCKED_FORM_IDS: '922334169887147' }, () => {
    assert.equal(meta.isAllowed({ pageId: '557050430995914', formId: 'f1' }).ok, true);
    assert.equal(meta.isAllowed({ pageId: '999', formId: 'f1' }).code, 'page_not_allowed');
    assert.equal(meta.isAllowed({ pageId: '557050430995914', formId: '922334169887147' }).code, 'form_not_allowed');
  });
  withEnv({ META_ALLOWED_FORM_IDS: 'f1,f2' }, () => {
    assert.equal(meta.isAllowed({ formId: 'f1' }).ok, true);
    assert.equal(meta.isAllowed({ formId: 'f9' }).code, 'form_not_allowed');
  });
});

test('meta: field extraction resolves English and Hebrew label variants', () => {
  const fd = [
    { name: 'שם מלא', values: ['דור כהן'] },
    { name: 'מספר טלפון', values: ['050-123-4567'] },
    { name: 'email', values: ['DOR@Example.com'] },
    { name: 'כמות משתתפים', values: ['25'] },
  ];
  assert.equal(meta.pickField(fd, 'fullName'), 'דור כהן');
  assert.equal(meta.pickField(fd, 'phone'), '050-123-4567');
  assert.equal(meta.pickField(fd, 'email'), 'DOR@Example.com');
  assert.equal(meta.pickField(fd, 'participants'), '25');
  assert.equal(meta.pickField(fd, 'message'), null);
});

test('meta: a lead translates into a normalized event with Meta attribution', () => {
  const details = {
    id: 'l1',
    created_time: '2026-07-20T10:00:00+0000',
    ad_id: 'ad1', adset_id: 'as1', campaign_id: 'cmp1',
    field_data: [
      { name: 'full_name', values: ['דור כהן'] },
      { name: 'phone_number', values: ['+972501234567'] },
      { name: 'email', values: ['dor@example.com'] },
    ],
  };
  const event = meta.toCanonicalEvent(details, { leadgenId: 'l1', formId: 'f1', pageId: 'p1' });
  const n = normalizeEvent(event);
  assert.equal(n.source, 'meta_lead_ads');
  assert.equal(n.externalId, 'l1');
  assert.equal(n.person.phoneIntl, '972501234567');
  assert.equal(n.person.email, 'dor@example.com');
  assert.equal(n.attribution.channel, 'Meta');
  assert.equal(n.attribution.adId, 'ad1');
  assert.equal(n.attribution.campaignId, 'cmp1');
});

test('meta: graph errors are classified into retryable vs permanent', async () => {
  await withEnv({ META_PAGE_ACCESS_TOKEN: 't' }, async () => {
    const notFound = { ok: false, status: 400, text: async () => 'bad token' };
    await assert.rejects(
      () => meta.fetchLeadDetails('l1', { fetchImpl: async () => notFound }),
      (e) => e.code === 'provider_rejected' && e.retryable === false,
    );
    const down = { ok: false, status: 503, text: async () => 'oops' };
    await assert.rejects(
      () => meta.fetchLeadDetails('l1', { fetchImpl: async () => down }),
      (e) => e.code === 'provider_unavailable' && e.retryable === true,
    );
    const rateLimited = { ok: false, status: 429, text: async () => 'slow down' };
    await assert.rejects(
      () => meta.fetchLeadDetails('l1', { fetchImpl: async () => rateLimited }),
      (e) => e.retryable === true,
    );
  });
});

test('meta: the access token is sent as a header, never in the URL', async () => {
  await withEnv({ META_PAGE_ACCESS_TOKEN: 'supersecret' }, async () => {
    let seenUrl = null; let seenHeaders = null;
    await meta.fetchLeadDetails('l1', {
      fetchImpl: async (url, opts) => { seenUrl = url; seenHeaders = opts.headers; return { ok: true, json: async () => ({}) }; },
    });
    assert.ok(!seenUrl.includes('supersecret'), 'token must not leak into the URL/logs');
    assert.equal(seenHeaders.Authorization, 'Bearer supersecret');
  });
});

// ── WooCommerce adapter ─────────────────────────────────────────────────────

const wooOrder = {
  id: 1001,
  number: '1001',
  status: 'processing',
  currency: 'ILS',
  total: '480.00',
  date_created: '2026-07-20T10:00:00',
  customer_note: 'נא לתאם מראש',
  billing: { first_name: 'דור', last_name: 'כהן', email: 'dor@example.com', phone: '050-123-4567', company: '' },
  line_items: [{ name: 'סיור גרפיטי', product_id: 6031, variation_id: 7042, quantity: 2, price: 240, sku: 'GRF-1' }],
  meta_data: [{ key: '_billing_tour_date', value: '25/08/2026' }],
  coupon_lines: [{ code: 'SUMMER' }],
};

test('woo: a complete order payload needs no fetch; an id-only ping does', () => {
  assert.equal(woo.isCompleteOrder(wooOrder), true);
  assert.equal(woo.isCompleteOrder({ id: 1001 }), false);
  assert.equal(woo.orderIdOf({ id: 1001 }), '1001');
  assert.equal(woo.orderIdOf({ resource_id: 55 }), '55');
  assert.equal(woo.orderIdOf({}), null);
});

test('woo: order translates with items, money, tour date and paid status', () => {
  const n = normalizeEvent(woo.toCanonicalEvent(wooOrder, { storeKey: 'primary' }));
  assert.equal(n.kind, 'order');
  assert.equal(n.sourceKey, 'primary');
  assert.equal(n.externalId, '1001');
  assert.equal(n.person.phoneIntl, '972501234567');
  assert.equal(n.order.total, 480);
  assert.equal(n.order.currency, 'ILS');
  assert.equal(n.order.paid, true);
  assert.equal(n.order.items[0].externalId, '7042', 'variation id identifies the exact variant');
  assert.equal(n.order.items[0].quantity, 2);
  assert.equal(n.context.preferredDate.getFullYear(), 2026);
  assert.equal(n.context.preferredDate.getMonth(), 7); // August
  assert.equal(n.context.message, 'נא לתאם מראש');
});

test('woo: abandoned-cart statuses are not treated as paid orders', () => {
  assert.equal(woo.isPaidStatus('processing'), true);
  assert.equal(woo.isPaidStatus('completed'), true);
  assert.equal(woo.isPaidStatus('pending'), false, 'pending = abandoned cart, not revenue');
  assert.equal(woo.isPaidStatus('cancelled'), false);
  assert.equal(woo.isPaidStatus(undefined), false);
});

test('woo: Israeli and ISO tour-date formats both parse', () => {
  assert.equal(woo.parseTourDate('25/08/2026').getDate(), 25);
  assert.equal(woo.parseTourDate('2026-08-25').getDate(), 25);
  assert.equal(woo.parseTourDate(''), null);
  assert.equal(woo.parseTourDate('nonsense'), null);
});

test('woo: the same order id in two stores produces distinct events', () => {
  const a = woo.toCanonicalEvent(wooOrder, { storeKey: 'primary' });
  const b = woo.toCanonicalEvent(wooOrder, { storeKey: 'secondary' });
  assert.equal(a.externalId, b.externalId);
  assert.notEqual(a.sourceKey, b.sourceKey, 'store key keeps the idempotency namespaces apart');
});

test('woo: a company on the billing address becomes an organization hint', () => {
  const withCo = { ...wooOrder, billing: { ...wooOrder.billing, company: 'חברת בדיקה' } };
  const n = normalizeEvent(woo.toCanonicalEvent(withCo, { storeKey: 'primary' }));
  assert.equal(n.organization.name, 'חברת בדיקה');
});

test('woo: fetch uses the per-store base URL and credentials', async () => {
  await withEnv(
    { WOO_NEW_BASE_URL: 'https://new.example', WOO_NEW_CONSUMER_KEY: 'ck', WOO_NEW_CONSUMER_SECRET: 'cs' },
    async () => {
      let seen = null;
      await woo.fetchOrder('secondary', 1001, {
        fetchImpl: async (url, opts) => { seen = { url, opts }; return { ok: true, json: async () => wooOrder }; },
      });
      assert.equal(seen.url, 'https://new.example/wp-json/wc/v3/orders/1001');
      assert.equal(seen.opts.headers.Authorization, `Basic ${Buffer.from('ck:cs').toString('base64')}`);
    },
  );
});

test('woo: fetching from an unconfigured store is a permanent, named failure', async () => {
  await withEnv({}, async () => {
    await assert.rejects(() => woo.fetchOrder('secondary', 1), (e) => e.code === 'store_unknown');
  });
});

// ── website form adapter ────────────────────────────────────────────────────

test('form: Hebrew, Elementor placeholder and English field names all resolve', () => {
  const variants = [
    { 'שם': 'דור כהן', 'טלפון': '050-123-4567', 'אימייל': 'dor@example.com' },
    { 'No Label name': 'דור כהן', 'No Label field_e3e4b67': '050-123-4567', 'No Label email': 'dor@example.com' },
    { 'אין תווית name': 'דור כהן', 'אין תווית field_e3e4b67': '050-123-4567', 'אין תווית email': 'dor@example.com' },
    { name: 'דור כהן', phone: '050-123-4567', email: 'dor@example.com' },
  ];
  for (const v of variants) {
    const n = normalizeEvent(form.toCanonicalEvent(v, { formKey: 'contact_page' }));
    assert.equal(n.person.displayName, 'דור כהן');
    assert.equal(n.person.phoneIntl, '972501234567');
    assert.equal(n.person.email, 'dor@example.com');
  }
});

test('form: nested Elementor shapes are flattened', () => {
  const nested = { fields: { name: { value: 'דור' }, phone: { value: '0501234567' } } };
  const flat = form.flattenPayload(nested);
  assert.equal(flat.name, 'דור');
  assert.equal(flat.phone, '0501234567');
});

test('form: UTM comes off the submitted page URL and hidden fields win', () => {
  const a = normalizeEvent(
    form.toCanonicalEvent({ name: 'x', phone: '0501234567', 'קישור לעמוד': 'https://g.co/p?utm_source=google&utm_campaign=c1' }, { formKey: 'footer' }),
  );
  assert.equal(a.attribution.utmSource, 'google');
  assert.equal(a.attribution.channel, 'Google');
  assert.equal(a.attribution.utmCampaign, 'c1');

  const b = normalizeEvent(
    form.toCanonicalEvent({ name: 'x', phone: '0501234567', url: 'https://g.co/p?utm_source=google', utm_source: 'newsletter' }, { formKey: 'footer' }),
  );
  assert.equal(b.attribution.utmSource, 'newsletter', 'explicit hidden field outranks the URL');
});

test('form: the form key is carried as sourceKey for per-form attribution', () => {
  for (const key of ['product_page', 'contact_page', 'footer', 'popup', 'elementor_lp']) {
    const n = normalizeEvent(form.toCanonicalEvent({ name: 'x', phone: '0501234567' }, { formKey: key }));
    assert.equal(n.sourceKey, key);
    assert.equal(n.context.formName, key);
  }
});

test('form: an empty submission produces no identity rather than a junk contact', () => {
  const n = normalizeEvent(form.toCanonicalEvent({ 'שם': '   ' }, { formKey: 'popup' }));
  assert.equal(n.person.phoneIntl, null);
  assert.equal(n.person.email, null);
});

// ── registry ────────────────────────────────────────────────────────────────

test('registry: every adapter is retrievable and reports configuration state', () => {
  withEnv({}, () => {
    assert.equal(Object.keys(ADAPTERS).length, 3);
    assert.ok(getAdapter('meta_lead_ads'));
    assert.ok(getAdapter('woocommerce'));
    assert.ok(getAdapter('website_form'));
    assert.equal(getAdapter('nope'), null);

    const status = adapterStatus();
    assert.equal(status.every((s) => s.configured === false), true);
    const wooStatus = status.find((s) => s.key === 'woocommerce');
    assert.deepEqual(wooStatus.instances.map((i) => i.key), ['primary', 'secondary']);
  });
});

test('registry: adapters expose only translation, never record-writing', () => {
  for (const adapter of Object.values(ADAPTERS)) {
    assert.equal(typeof adapter.toCanonicalEvent, 'function');
    assert.equal(typeof adapter.verify, 'function');
    // The architectural invariant: no adapter may create business records.
    for (const forbidden of ['createDeal', 'createContact', 'persist', 'dedupe']) {
      assert.equal(adapter[forbidden], undefined, `${adapter.key} must not implement ${forbidden}`);
    }
  }
});
