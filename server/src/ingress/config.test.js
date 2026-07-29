import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ingressConfigReport,
  metaConfigured,
  wooStoreConfig,
  wooStoreConfigured,
  websiteFormConfigured,
  platformConfig,
  logIngressConfig,
  VARIABLE_CATALOGUE,
} from './config.js';

// Every ingress variable is read through a getter, so tests mutate process.env
// directly and restore afterwards.
const INGRESS_VARS = [
  'INGRESS_DRY_RUN', 'INGRESS_ADMIN_ENABLED',
  'META_APP_SECRET', 'META_VERIFY_TOKEN', 'META_PAGE_ACCESS_TOKEN', 'META_PAGE_ID',
  'META_ALLOWED_FORM_IDS', 'META_BLOCKED_FORM_IDS', 'META_GRAPH_VERSION',
  'WOOCOMMERCE_BASE_URL', 'WOOCOMMERCE_CONSUMER_KEY', 'WOOCOMMERCE_CONSUMER_SECRET',
  'WOO_STORE_URL', 'WOO_CONSUMER_KEY', 'WOO_CONSUMER_SECRET', 'WOO_PRIMARY_WEBHOOK_SECRET',
  'WOO_NEW_BASE_URL', 'WOO_NEW_CONSUMER_KEY', 'WOO_NEW_CONSUMER_SECRET', 'WOO_NEW_WEBHOOK_SECRET',
  'WEBSITE_FORM_SECRET',
];

function withEnv(overrides, fn) {
  const saved = {};
  for (const k of INGRESS_VARS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const k of INGRESS_VARS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test('config: a fully unconfigured platform reports cleanly instead of throwing', () => {
  withEnv({}, () => {
    const r = ingressConfigReport();
    assert.equal(r.readyCount, 0);
    assert.equal(r.totalCount, 3);
    assert.equal(metaConfigured(), false);
    assert.equal(websiteFormConfigured(), false);
    assert.equal(wooStoreConfigured('primary'), false);
    // The report names exactly what must be issued.
    const meta = r.sources.find((s) => s.key === 'meta_lead_ads');
    assert.deepEqual(meta.missingRequired, ['META_APP_SECRET', 'META_VERIFY_TOKEN', 'META_PAGE_ACCESS_TOKEN']);
  });
});

test('config: boot logging never throws when nothing is configured', () => {
  withEnv({}, () => {
    const lines = [];
    const r = logIngressConfig({ log: (m) => lines.push(m) });
    assert.equal(r.readyCount, 0);
    assert.ok(lines.some((l) => l.includes('0/3 sources configured')));
    assert.ok(lines.some((l) => l.includes('meta_lead_ads') && l.includes('awaiting')));
  });
});

test('config: Meta becomes configured only with all three required secrets', () => {
  withEnv({ META_APP_SECRET: 's', META_VERIFY_TOKEN: 'v' }, () => {
    assert.equal(metaConfigured(), false);
  });
  withEnv({ META_APP_SECRET: 's', META_VERIFY_TOKEN: 'v', META_PAGE_ACCESS_TOKEN: 't' }, () => {
    assert.equal(metaConfigured(), true);
  });
});

test('config: the primary Woo store reuses the existing WOOCOMMERCE_* credential', () => {
  withEnv(
    {
      WOOCOMMERCE_BASE_URL: 'https://grafitiyul.co.il/',
      WOOCOMMERCE_CONSUMER_KEY: 'ck',
      WOOCOMMERCE_CONSUMER_SECRET: 'cs',
      WOO_PRIMARY_WEBHOOK_SECRET: 'wh',
    },
    () => {
      const c = wooStoreConfig('primary');
      assert.equal(c.baseUrl, 'https://grafitiyul.co.il'); // trailing slash stripped
      assert.equal(c.consumerKey, 'ck');
      assert.equal(wooStoreConfigured('primary'), true);
      assert.equal(wooStoreConfigured('secondary'), false);
    },
  );
});

test('config: the two Woo stores are configured independently', () => {
  withEnv(
    {
      WOO_NEW_BASE_URL: 'https://new.example',
      WOO_NEW_CONSUMER_KEY: 'ck2',
      WOO_NEW_CONSUMER_SECRET: 'cs2',
      WOO_NEW_WEBHOOK_SECRET: 'wh2',
    },
    () => {
      assert.equal(wooStoreConfigured('secondary'), true);
      assert.equal(wooStoreConfigured('primary'), false);
      assert.equal(wooStoreConfig('secondary').baseUrl, 'https://new.example');
    },
  );
});

test('config: unknown store key resolves to null rather than a partial object', () => {
  assert.equal(wooStoreConfig('nope'), null);
  assert.equal(wooStoreConfigured('nope'), false);
});

test('config: global dry-run is opt-in and accepts the usual truthy spellings', () => {
  withEnv({}, () => assert.equal(platformConfig().dryRun, false));
  for (const v of ['1', 'true', 'TRUE', 'yes', 'on']) {
    withEnv({ INGRESS_DRY_RUN: v }, () => assert.equal(platformConfig().dryRun, true));
  }
  withEnv({ INGRESS_DRY_RUN: 'false' }, () => assert.equal(platformConfig().dryRun, false));
});

test('config: admin surface defaults on and can be switched off', () => {
  withEnv({}, () => assert.equal(platformConfig().adminEnabled, true));
  withEnv({ INGRESS_ADMIN_ENABLED: 'false' }, () => assert.equal(platformConfig().adminEnabled, false));
});

test('config: the catalogue documents a purpose for every declared variable', () => {
  for (const [key, spec] of Object.entries(VARIABLE_CATALOGUE)) {
    assert.ok(spec.label, `${key} needs a label`);
    for (const v of [...spec.required, ...spec.optional]) {
      assert.ok(v.name && v.purpose, `${key}.${v.name} needs a purpose`);
    }
  }
});
