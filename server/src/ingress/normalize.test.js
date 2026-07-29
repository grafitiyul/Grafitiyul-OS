import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvent, validateEvent, hasUsableIdentity } from './contract.js';
import { normalizeEvent, normalizeEmail, displayPhone, splitName, coerceNumber } from './normalize.js';
import { extractUtm, parseQueryParams, resolveAttribution, channelLabel } from './attribution.js';
import { buildIdempotencyKey, buildDedupeKey, decideDedupe } from './identity.js';
import { IngressError, toIngressError } from './errors.js';

test('contract: buildEvent fills every branch with stable defaults', () => {
  const e = buildEvent({ source: 'website_form' });
  assert.equal(e.kind, 'lead');
  assert.equal(e.organization, null);
  assert.equal(e.order, null);
  assert.deepEqual(e.extra, {});
  assert.equal(e.person.email, null);
  assert.doesNotThrow(() => validateEvent(e));
});

test('contract: validation rejects a malformed event with a coded error', () => {
  assert.throws(
    () => validateEvent(buildEvent({ source: null })),
    (err) => err instanceof IngressError && err.code === 'contract_invalid' && err.retryable === false,
  );
});

test('normalize: Israeli phone forms all collapse to one international value', () => {
  const forms = ['050-123-4567', '+972 50 1234567', '0501234567', '972501234567'];
  const got = forms.map((p) => normalizeEvent(buildEvent({ source: 's', person: { phone: p } })).person.phoneIntl);
  assert.deepEqual(new Set(got), new Set(['972501234567']));
});

test('normalize: unusable phone becomes null rather than a bad value', () => {
  const n = normalizeEvent(buildEvent({ source: 's', person: { phone: '123' } }));
  assert.equal(n.person.phoneIntl, null);
  assert.equal(n.person.phoneDisplay, null);
});

test('normalize: phone display form is Israeli-local for IL, +intl otherwise', () => {
  assert.equal(displayPhone('972501234567'), '0501234567');
  assert.equal(displayPhone('12125551234'), '+12125551234');
  assert.equal(displayPhone(null), null);
});

test('normalize: email is lowercased and shape-checked', () => {
  assert.equal(normalizeEmail('  Dor@Example.COM '), 'dor@example.com');
  assert.equal(normalizeEmail('not-an-email'), null);
  assert.equal(normalizeEmail('a@b'), null);
  assert.equal(normalizeEmail(''), null);
});

test('normalize: name splitting handles full-name and split-name sources identically', () => {
  assert.deepEqual(splitName({ fullName: 'דור כהן לוי' }), { firstName: 'דור', lastName: 'כהן לוי' });
  assert.deepEqual(splitName({ firstName: 'דור', lastName: 'כהן' }), { firstName: 'דור', lastName: 'כהן' });
  assert.deepEqual(splitName({ fullName: 'Madonna' }), { firstName: 'Madonna', lastName: '' });
  assert.deepEqual(splitName({}), { firstName: '', lastName: '' });
});

test('normalize: two sources describing the same human produce the same identity', () => {
  const meta = normalizeEvent(
    buildEvent({ source: 'meta_lead_ads', person: { fullName: 'דור כהן', phone: '050-123-4567', email: 'A@B.CO' } }),
  );
  const form = normalizeEvent(
    buildEvent({ source: 'website_form', person: { firstName: 'דור', lastName: 'כהן', phone: '+972501234567', email: 'a@b.co' } }),
  );
  assert.equal(meta.person.phoneIntl, form.person.phoneIntl);
  assert.equal(meta.person.email, form.person.email);
  assert.equal(meta.person.displayName, form.person.displayName);
  assert.equal(buildDedupeKey(meta), buildDedupeKey(form));
});

test('normalize: money and quantity coercion tolerates provider string formats', () => {
  assert.equal(coerceNumber('1,250.50'), 1250.5);
  assert.equal(coerceNumber('₪480'), 480);
  assert.equal(coerceNumber(''), null);
  assert.equal(coerceNumber('abc'), null);
});

test('normalize: order items survive normalization with defaults applied', () => {
  const n = normalizeEvent(
    buildEvent({
      source: 'woocommerce',
      kind: 'order',
      order: { total: '480.00', items: [{ name: 'סיור גרפיטי', externalId: '6031' }] },
    }),
  );
  assert.equal(n.order.total, 480);
  assert.equal(n.order.currency, 'ILS');
  assert.equal(n.order.items[0].quantity, 1);
  assert.equal(n.order.items[0].externalId, '6031');
});

test('attribution: UTM parsed out of a landing URL', () => {
  const utm = extractUtm('https://grafitiyul.co.il/tour?utm_source=facebook&utm_medium=cpc&utm_campaign=remarketing');
  assert.equal(utm.utm_source, 'facebook');
  assert.equal(utm.utm_medium, 'cpc');
  assert.equal(utm.utm_campaign, 'remarketing');
});

test('attribution: query parsing survives encoding and malformed input', () => {
  assert.deepEqual(parseQueryParams('a=1&b=%D7%93%D7%95%D7%A8'), { a: '1', b: 'דור' });
  assert.deepEqual(parseQueryParams('a=1&&b=2'), { a: '1', b: '2' });
  assert.deepEqual(parseQueryParams('plus=a+b'), { plus: 'a b' });
  assert.deepEqual(parseQueryParams(''), {});
  assert.deepEqual(parseQueryParams(null), {});
});

test('attribution: explicit adapter UTM outranks the URL', () => {
  const a = resolveAttribution(
    buildEvent({
      source: 'meta_lead_ads',
      attributionInput: { url: 'https://x.co/?utm_source=urlsrc', utm: { utm_source: 'explicit' } },
    }),
  );
  assert.equal(a.utmSource, 'explicit');
});

test('attribution: provider campaign name is the fallback, not the winner', () => {
  const withUrl = resolveAttribution(
    buildEvent({ source: 'meta_lead_ads', attributionInput: { url: 'https://x.co/?utm_campaign=fromurl', campaignName: 'fromprovider' } }),
  );
  assert.equal(withUrl.utmCampaign, 'fromurl');
  const without = resolveAttribution(buildEvent({ source: 'meta_lead_ads', attributionInput: { campaignName: 'fromprovider' } }));
  assert.equal(without.utmCampaign, 'fromprovider');
});

test('attribution: channel label is stable across source spellings', () => {
  assert.equal(channelLabel({ utmSource: 'facebook' }), 'Meta');
  assert.equal(channelLabel({ utmSource: 'IG' }), 'Meta');
  assert.equal(channelLabel({ utmSource: 'google-ads' }), 'Google');
  assert.equal(channelLabel({ source: 'meta_lead_ads' }), 'Meta');
  assert.equal(channelLabel({ source: 'website_form' }), 'אתר');
  assert.equal(channelLabel({}), 'לא ידוע');
});

test('idempotency: provider id produces a stable key; body hash is the fallback', () => {
  const a = buildIdempotencyKey({ source: 'meta_lead_ads', externalId: 'lead_1' });
  const b = buildIdempotencyKey({ source: 'meta_lead_ads', externalId: 'lead_1' });
  assert.equal(a, b);
  const c = buildIdempotencyKey({ source: 'meta_lead_ads', externalId: 'lead_2' });
  assert.notEqual(a, c);

  const h1 = buildIdempotencyKey({ source: 'website_form', rawBody: { a: 1 } });
  const h2 = buildIdempotencyKey({ source: 'website_form', rawBody: { a: 1 } });
  const h3 = buildIdempotencyKey({ source: 'website_form', rawBody: { a: 2 } });
  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
});

test('idempotency: the same order id in two stores never collides', () => {
  const p = buildIdempotencyKey({ source: 'woocommerce', sourceKey: 'primary', externalId: '1001' });
  const s = buildIdempotencyKey({ source: 'woocommerce', sourceKey: 'secondary', externalId: '1001' });
  assert.notEqual(p, s);
});

test('dedupe: phone outranks email as the business key', () => {
  const n = normalizeEvent(buildEvent({ source: 's', person: { phone: '0501234567', email: 'a@b.co' } }));
  assert.equal(buildDedupeKey(n), 'p:972501234567');
  const emailOnly = normalizeEvent(buildEvent({ source: 's', person: { email: 'a@b.co' } }));
  assert.equal(buildDedupeKey(emailOnly), 'e:a@b.co');
  assert.equal(buildDedupeKey(normalizeEvent(buildEvent({ source: 's' }))), null);
});

test('dedupe: orders are never suppressed, leads inside the window annotate', () => {
  assert.equal(decideDedupe({ kind: 'order', priorEvent: { id: 'x' }, priorDealId: 'd1' }).action, 'create');
  assert.equal(decideDedupe({ kind: 'lead', priorDealId: 'd1' }).action, 'annotate');
  assert.equal(decideDedupe({ kind: 'lead', priorEvent: { dealId: 'd2' } }).action, 'annotate');
  assert.equal(decideDedupe({ kind: 'lead' }).action, 'create');
});

test('identity: a lead with neither phone nor email is not usable', () => {
  assert.equal(hasUsableIdentity(normalizeEvent(buildEvent({ source: 's', person: { fullName: 'דור' } }))), false);
  assert.equal(hasUsableIdentity(normalizeEvent(buildEvent({ source: 's', person: { phone: '0501234567' } }))), true);
  assert.equal(hasUsableIdentity(normalizeEvent(buildEvent({ source: 's', person: { email: 'a@b.co' } }))), true);
});

test('errors: unknown throws become retryable internal errors, coded ones pass through', () => {
  const wrapped = toIngressError(new Error('boom'), 'persist');
  assert.equal(wrapped.code, 'internal_error');
  assert.equal(wrapped.retryable, true);
  assert.equal(wrapped.stage, 'persist');

  const coded = toIngressError(new IngressError('signature_invalid'), 'validate');
  assert.equal(coded.code, 'signature_invalid');
  assert.equal(coded.retryable, false);
});
