import test from 'node:test';
import assert from 'node:assert/strict';
import { wooConfigured, wooSyncEnabled, wooSyncActive } from './wooClient.js';

// The env-var contract + the explicit activation gate. wooConfigured() only asks
// "do we have credentials"; wooSyncActive() additionally requires a human to have
// flipped WOO_SYNC_ENABLED — so deploying the code can never start writing.

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const CLEAR = {
  WOOCOMMERCE_BASE_URL: undefined,
  WOOCOMMERCE_CONSUMER_KEY: undefined,
  WOOCOMMERCE_CONSUMER_SECRET: undefined,
  WOO_STORE_URL: undefined,
  WOO_CONSUMER_KEY: undefined,
  WOO_CONSUMER_SECRET: undefined,
  WOO_SYNC_ENABLED: undefined,
};

test('wooConfigured reads the WOOCOMMERCE_* names (live convention)', () => {
  withEnv(
    {
      ...CLEAR,
      WOOCOMMERCE_BASE_URL: 'https://shop.example/',
      WOOCOMMERCE_CONSUMER_KEY: 'ck_x',
      WOOCOMMERCE_CONSUMER_SECRET: 'cs_x',
    },
    () => assert.equal(wooConfigured(), true),
  );
});

test('wooConfigured still honours the legacy WOO_* names as fallback', () => {
  withEnv(
    { ...CLEAR, WOO_STORE_URL: 'https://shop.example', WOO_CONSUMER_KEY: 'ck', WOO_CONSUMER_SECRET: 'cs' },
    () => assert.equal(wooConfigured(), true),
  );
});

test('missing any credential → not configured', () => {
  withEnv({ ...CLEAR, WOOCOMMERCE_BASE_URL: 'https://shop.example' }, () =>
    assert.equal(wooConfigured(), false),
  );
});

test('activation gate: configured but WOO_SYNC_ENABLED unset → inert', () => {
  withEnv(
    {
      ...CLEAR,
      WOOCOMMERCE_BASE_URL: 'https://shop.example',
      WOOCOMMERCE_CONSUMER_KEY: 'ck',
      WOOCOMMERCE_CONSUMER_SECRET: 'cs',
    },
    () => {
      assert.equal(wooConfigured(), true);
      assert.equal(wooSyncEnabled(), false);
      assert.equal(wooSyncActive(), false); // deploy alone never writes
    },
  );
});

test('activation gate: only an explicit truthy WOO_SYNC_ENABLED activates', () => {
  const base = {
    ...CLEAR,
    WOOCOMMERCE_BASE_URL: 'https://shop.example',
    WOOCOMMERCE_CONSUMER_KEY: 'ck',
    WOOCOMMERCE_CONSUMER_SECRET: 'cs',
  };
  for (const v of ['true', '1', 'yes', 'on', 'TRUE']) {
    withEnv({ ...base, WOO_SYNC_ENABLED: v }, () => assert.equal(wooSyncActive(), true, `"${v}" activates`));
  }
  for (const v of ['false', '0', 'no', '', 'maybe']) {
    withEnv({ ...base, WOO_SYNC_ENABLED: v }, () => assert.equal(wooSyncActive(), false, `"${v}" stays inert`));
  }
});
