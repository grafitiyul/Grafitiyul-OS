import test from 'node:test';
import assert from 'node:assert/strict';
import { makeLegacyRedirect } from './legacyRedirect.js';

const OPTS = {
  canonicalOrigin: 'https://app.grafitiyul.co.il',
  legacyHost: 'grafitiyul-os-production.up.railway.app',
};
const LEGACY = 'grafitiyul-os-production.up.railway.app';

test('redirects legacy host to the same path + query on the canonical origin', () => {
  const t = makeLegacyRedirect(OPTS);
  assert.equal(
    t(LEGACY, '/admin/email', '/admin/email?x=1'),
    'https://app.grafitiyul.co.il/admin/email?x=1',
  );
  assert.equal(t(LEGACY, '/pay/tok123', '/pay/tok123'), 'https://app.grafitiyul.co.il/pay/tok123');
  assert.equal(t(LEGACY, '/p/abc', '/p/abc'), 'https://app.grafitiyul.co.il/p/abc');
  assert.equal(
    t(LEGACY, '/api/track/email-open/xyz.gif', '/api/track/email-open/xyz.gif'),
    'https://app.grafitiyul.co.il/api/track/email-open/xyz.gif',
  );
});

test('preserves multi-param query strings verbatim', () => {
  const t = makeLegacyRedirect(OPTS);
  assert.equal(
    t(LEGACY, '/admin/deals', '/admin/deals?status=open&q=%D7%A9%D7%9C%D7%95%D7%9D'),
    'https://app.grafitiyul.co.il/admin/deals?status=open&q=%D7%A9%D7%9C%D7%95%D7%9D',
  );
});

test('host compare ignores port and case', () => {
  const t = makeLegacyRedirect(OPTS);
  assert.equal(
    t('GRAFITIYUL-OS-PRODUCTION.UP.RAILWAY.APP:443', '/pay/1', '/pay/1'),
    'https://app.grafitiyul.co.il/pay/1',
  );
});

test('passes through the new domain, internal hosts, localhost, and empty host', () => {
  const t = makeLegacyRedirect(OPTS);
  assert.equal(t('app.grafitiyul.co.il', '/admin', '/admin'), null);
  assert.equal(t('gos-whatsapp-main.railway.internal:3000', '/send', '/send'), null);
  assert.equal(t('gos-api-production.railway.internal', '/api/deals', '/api/deals'), null);
  assert.equal(t('localhost:4000', '/health', '/health'), null);
  assert.equal(t('', '/x', '/x'), null);
  assert.equal(t(undefined, '/x', '/x'), null);
});

test('never redirects the health probe even on the legacy host', () => {
  const t = makeLegacyRedirect(OPTS);
  assert.equal(t(LEGACY, '/health', '/health'), null);
});

test('disabled (no redirect) when legacy host is empty', () => {
  const t = makeLegacyRedirect({ canonicalOrigin: 'https://app.grafitiyul.co.il', legacyHost: '' });
  assert.equal(t('anything', '/a', '/a'), null);
});

test('disabled when canonical host equals legacy host (would loop)', () => {
  const t = makeLegacyRedirect({ canonicalOrigin: 'https://same.example', legacyHost: 'same.example' });
  assert.equal(t('same.example', '/a', '/a'), null);
});

test('disabled when canonical origin is invalid/empty', () => {
  assert.equal(makeLegacyRedirect({ canonicalOrigin: '', legacyHost: LEGACY })(LEGACY, '/a', '/a'), null);
  assert.equal(makeLegacyRedirect({})(LEGACY, '/a', '/a'), null);
});

test('trailing slash on the canonical origin is normalized away', () => {
  const t = makeLegacyRedirect({ canonicalOrigin: 'https://app.grafitiyul.co.il/', legacyHost: 'old.example' });
  assert.equal(t('old.example', '/pay/1', '/pay/1'), 'https://app.grafitiyul.co.il/pay/1');
});
