import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SOURCES, WRITER, assertIngressAllowed, ingressEnabled, mirrorShouldIgnore,
  missingCredentials, registryStatus, sourceForIngress, sourceForLegacyLabel,
  validateRegistry, writerFor,
} from './sourceRegistry.js';

const env = (o = {}) => ({ ...o });

// ── the safe default ──────────────────────────────────────────────────────────

test('an UNSET source defaults to legacy — forgetting a variable never opens a second writer', () => {
  for (const s of SOURCES) {
    assert.equal(writerFor(s.key, env()), WRITER.LEGACY, `${s.key} must default to legacy`);
    assert.equal(ingressEnabled(s.key, env()), false);
  }
});

test('an unknown source key resolves to nothing rather than a default', () => {
  assert.equal(writerFor('martian', env()), null);
});

test('a junk value is treated as legacy, not as direct', () => {
  assert.equal(writerFor('meta', env({ SOURCE_WRITER_META: 'yes please' })), WRITER.LEGACY);
  assert.equal(writerFor('meta', env({ SOURCE_WRITER_META: '' })), WRITER.LEGACY);
});

test('direct and off are honoured, case-insensitively', () => {
  assert.equal(writerFor('meta', env({ SOURCE_WRITER_META: 'DIRECT' })), WRITER.DIRECT);
  assert.equal(writerFor('meta', env({ SOURCE_WRITER_META: 'Off' })), WRITER.OFF);
});

// ── the invariant ─────────────────────────────────────────────────────────────

test('THE invariant: a source is never both mirrored and directly ingested', () => {
  for (const mode of [WRITER.LEGACY, WRITER.DIRECT, WRITER.OFF]) {
    const e = env({ SOURCE_WRITER_META: mode });
    assert.notEqual(
      ingressEnabled('meta', e) && !mirrorShouldIgnore('meta', e),
      true,
      `mode ${mode} allowed two active writers`,
    );
  }
});

test('cutting a source over closes the legacy path in the SAME switch', () => {
  const e = env({ SOURCE_WRITER_META: 'direct' });
  assert.equal(ingressEnabled('meta', e), true, 'direct path opens');
  assert.equal(mirrorShouldIgnore('meta', e), true, 'and the mirror stops writing it');
});

test('moving one source leaves every other source untouched', () => {
  const e = env({ SOURCE_WRITER_META: 'direct' });
  assert.equal(writerFor('woo_old', e), WRITER.LEGACY);
  assert.equal(writerFor('woo_new', e), WRITER.LEGACY);
  assert.equal(writerFor('website_forms', e), WRITER.LEGACY);
});

// ── credential safety ─────────────────────────────────────────────────────────

test('direct mode WITHOUT credentials is a violation — leads would fall on the floor', () => {
  const r = validateRegistry(env({ SOURCE_WRITER_META: 'direct' }));
  assert.equal(r.ok, false);
  assert.equal(r.violations.length, 1);
  assert.equal(r.violations[0].problem, 'direct_without_credentials');
  assert.match(r.violations[0].detail, /Leads would be lost/);
  assert.match(r.violations[0].remedy, /SOURCE_WRITER_META=legacy/);
});

test('direct mode WITH credentials is valid', () => {
  const r = validateRegistry(env({
    SOURCE_WRITER_META: 'direct',
    META_APP_SECRET: 's', META_VERIFY_TOKEN: 't', META_PAGE_ACCESS_TOKEN: 'p',
  }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.violations, []);
});

test('legacy mode never demands ingress credentials', () => {
  assert.equal(validateRegistry(env()).ok, true);
});

test('missingCredentials reports NAMES only, never values', () => {
  const missing = missingCredentials('meta', env({ META_APP_SECRET: 'super-secret' }));
  assert.deepEqual(missing, ['META_VERIFY_TOKEN', 'META_PAGE_ACCESS_TOKEN']);
  assert.ok(!JSON.stringify(missing).includes('super-secret'));
});

// ── mapping both directions ───────────────────────────────────────────────────

test('ingress adapter keys resolve to registry sources, including per-store keys', () => {
  assert.equal(sourceForIngress('meta_lead_ads'), 'meta');
  assert.equal(sourceForIngress('website_form'), 'website_forms');
  assert.equal(sourceForIngress('woocommerce', 'primary'), 'woo_old');
  // 'secondary' is the ingress/config.js store vocabulary — the registry MUST
  // speak the same one, or the second store silently resolves to woo_old.
  assert.equal(sourceForIngress('woocommerce', 'secondary'), 'woo_new');
  assert.equal(sourceForIngress('nothing_like_this'), null);
});

test('legacy lead-source labels map back to registry sources', () => {
  assert.equal(sourceForLegacyLabel('פייסבוק'), 'meta');
  assert.equal(sourceForLegacyLabel('פייסבוק/אינסטגרם ממומן'), 'meta');
  assert.equal(sourceForLegacyLabel('אתר גרפיטיול'), 'woo_old');
  assert.equal(sourceForLegacyLabel('דף נחיתה'), 'website_forms');
});

test('an UNKNOWN legacy label is never guessed into a source', () => {
  // Guessing would silently start ignoring real records once that source is cut over.
  assert.equal(sourceForLegacyLabel('המלצה'), null);
  assert.equal(sourceForLegacyLabel('TOMIX'), null);
  assert.equal(sourceForLegacyLabel(''), null);
  assert.equal(sourceForLegacyLabel(null), null);
});

// ── the endpoint guard ────────────────────────────────────────────────────────

test('a closed endpoint REFUSES loudly instead of quietly duplicating a deal', () => {
  assert.throws(
    () => assertIngressAllowed('meta_lead_ads', null, env()),
    (e) => e.code === 'SOURCE_NOT_CUT_OVER' && e.status === 409,
  );
});

test('an open endpoint is allowed and reports which source it is', () => {
  const key = assertIngressAllowed('meta_lead_ads', null, env({ SOURCE_WRITER_META: 'direct' }));
  assert.equal(key, 'meta');
});

test('an unregistered source is a 404, never a silent accept', () => {
  assert.throws(
    () => assertIngressAllowed('some_new_thing', null, env()),
    (e) => e.code === 'UNREGISTERED_SOURCE' && e.status === 404,
  );
});

test('the two Woo stores are switched independently', () => {
  const e = env({ SOURCE_WRITER_WOO_OLD: 'direct', WOO_PRIMARY_WEBHOOK_SECRET: 's' });
  assert.equal(assertIngressAllowed('woocommerce', 'primary', e), 'woo_old');
  assert.throws(() => assertIngressAllowed('woocommerce', 'secondary', e), (x) => x.code === 'SOURCE_NOT_CUT_OVER');
});

// ── status surface ────────────────────────────────────────────────────────────

test('registryStatus describes every source honestly', () => {
  const rows = registryStatus(env({ SOURCE_WRITER_META: 'direct' }));
  assert.equal(rows.length, SOURCES.length);
  const meta = rows.find((r) => r.key === 'meta');
  assert.equal(meta.writer, 'direct');
  assert.equal(meta.ingressEnabled, true);
  assert.equal(meta.mirrorIgnores, true);
  assert.equal(meta.missingCredentials.length, 3, 'and it does not hide that it cannot actually receive');
  const woo = rows.find((r) => r.key === 'woo_old');
  assert.equal(woo.writer, 'legacy');
  assert.deepEqual(woo.missingCredentials, [], 'legacy sources are not nagged about ingress credentials');
});
