import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildManifest,
  adminManifest,
  guideManifest,
  ADMIN_MANIFEST_ID,
} from './manifest.js';

// Manifest isolation suite (incident 2026-07-13). The one dynamic endpoint
// must be a pure function of the ?p= token: no token → admin; a token →
// that guide only; the two can never share an id or bleed start_urls.

test('no token → ADMIN manifest (start_url /admin, admin id)', () => {
  const m = buildManifest(undefined);
  assert.equal(m.start_url, '/admin');
  assert.equal(m.id, ADMIN_MANIFEST_ID);
  assert.equal(m.name, 'Grafitiyul Team');
  assert.equal(m.short_name, 'Grafitiyul Team');
});

test('empty / malformed token → ADMIN manifest, never a guide start_url', () => {
  for (const bad of ['', '   ', 'has/slash', 'a b', null, 42, {}]) {
    const m = buildManifest(bad);
    assert.equal(m.start_url, '/admin', `bad token ${JSON.stringify(bad)} must fall back to admin`);
    assert.equal(m.id, ADMIN_MANIFEST_ID);
  }
});

test('valid token → token-scoped GUIDE manifest', () => {
  const m = buildManifest('RAFAEL_tok9');
  assert.equal(m.start_url, '/launch/RAFAEL_tok9');
  assert.equal(m.id, '/p/RAFAEL_tok9');
});

test('admin and guide manifests have DISTINCT ids (installs never overwrite)', () => {
  const admin = adminManifest();
  const guideA = guideManifest('tokAAA');
  const guideB = guideManifest('tokBBB');
  assert.notEqual(admin.id, guideA.id);
  assert.notEqual(guideA.id, guideB.id);
  assert.notEqual(admin.start_url, guideA.start_url);
});

test('a previously built guide manifest cannot make the next no-token build a guide', () => {
  // Purity check: build a guide manifest, then a no-token one. The second
  // must be admin — there is no retained "last token" state.
  buildManifest('someGuideToken');
  const next = buildManifest(undefined);
  assert.equal(next.start_url, '/admin');
  assert.equal(next.id, ADMIN_MANIFEST_ID);
});

test('every manifest carries the brand icons + theme', () => {
  for (const m of [adminManifest(), guideManifest('t')]) {
    assert.equal(m.theme_color, '#28a8a8');
    assert.ok(m.icons.some((i) => i.src === '/icons/icon-192.png'));
    assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
  }
});
