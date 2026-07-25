import test from 'node:test';
import assert from 'node:assert/strict';

// Env must be in place before importing the module (config is read at call time
// but the crypto helpers need the key).
process.env.EMAIL_TOKEN_KEY = 'test-key-for-unit-tests-only-0123456789';
process.env.SESSION_SECRET = 'test-session-secret-0123456789abcdef';
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'GOCSPX-test-secret';

const {
  buildAuthUrl,
  mintOAuthState,
  verifyOAuthState,
  isInvalidGrant,
  sanitizeAuthError,
  buildConnectData,
  getFreshAccessToken,
  GMAIL_SCOPES,
} = await import('./googleClient.js');
const { encryptToken, decryptToken } = await import('./tokenCrypto.js');

// ── OAuth start URL ────────────────────────────────────────────────────────────

test('buildAuthUrl requests offline access + forced consent (guarantees refresh_token)', () => {
  const url = new URL(buildAuthUrl({ redirectUri: 'https://app.example/api/email/connect/callback', state: 'st' }));
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://app.example/api/email/connect/callback');
  assert.equal(url.searchParams.get('state'), 'st');
  // Both Gmail and Calendar scopes are requested together (one connection).
  const scope = url.searchParams.get('scope');
  assert.ok(scope.includes('gmail.modify'));
  assert.ok(scope.includes('calendar.events'));
  assert.deepEqual(scope.split(' '), GMAIL_SCOPES);
});

// ── Signed OAuth state (CSRF guard) ────────────────────────────────────────────

test('OAuth state round-trips and rejects tampering', () => {
  const s = mintOAuthState();
  assert.equal(verifyOAuthState(s), true);
  assert.equal(verifyOAuthState(s + 'x'), false);
  assert.equal(verifyOAuthState('a.b.c'), false);
  assert.equal(verifyOAuthState(''), false);
  assert.equal(verifyOAuthState(undefined), false);
});

test('OAuth state older than the max age is rejected', () => {
  const s = mintOAuthState();
  assert.equal(verifyOAuthState(s, -1), false); // any age exceeds a negative max
});

// ── Error classification + sanitization ─────────────────────────────────────────

test('isInvalidGrant recognizes the dead-refresh-token signal', () => {
  assert.equal(isInvalidGrant({ code: 'invalid_grant' }), true);
  assert.equal(isInvalidGrant({ message: 'google token endpoint 400: invalid_grant Token has been expired' }), true);
  assert.equal(isInvalidGrant({ code: 'google_timeout' }), false);
  assert.equal(isInvalidGrant(null), false);
});

test('sanitizeAuthError never leaks raw bodies — Hebrew per code', () => {
  assert.match(sanitizeAuthError({ code: 'invalid_grant' }), /התחבר מחדש/);
  assert.match(sanitizeAuthError({ code: 'google_timeout' }), /לא הגיב בזמן/);
  assert.match(sanitizeAuthError({ code: 'not_connected' }), /אינו מחובר/);
  assert.match(sanitizeAuthError({ status: 403 }), /נדחתה/);
  assert.match(sanitizeAuthError({ message: '<!DOCTYPE html> cloudflare' }), /נכשל/);
  // No HTML/angle brackets ever survive into the sanitized string.
  for (const e of [{ code: 'invalid_grant' }, { message: '<html>' }, { status: 500 }]) {
    assert.doesNotMatch(sanitizeAuthError(e), /[<>]/);
  }
});

// ── Reconnect payload: refresh-token preservation ───────────────────────────────

test('buildConnectData INCLUDES refreshTokenEnc when Google returns a refresh_token', () => {
  const data = buildConnectData({
    tokens: { access_token: 'at', expires_in: 3600, refresh_token: 'rt-new', scope: 'a b' },
    claims: { email: 'x@y.z', name: 'X', sub: '123' },
  });
  assert.ok('refreshTokenEnc' in data);
  assert.equal(decryptToken(data.refreshTokenEnc), 'rt-new');
  assert.equal(data.healthState, 'connected');
  assert.equal(data.lastAuthError, null);
});

test('buildConnectData OMITS refreshTokenEnc when Google returns none (preserves existing)', () => {
  const data = buildConnectData({
    tokens: { access_token: 'at', expires_in: 3600, scope: 'a b' }, // no refresh_token
    claims: { email: 'x@y.z' },
  });
  // The key must be ABSENT so an upsert `update` leaves the stored token intact.
  assert.equal('refreshTokenEnc' in data, false);
  assert.equal(data.healthState, 'connected');
});

// ── getFreshAccessToken: refresh + health persistence ───────────────────────────

function fakeClient() {
  const calls = [];
  return {
    calls,
    emailAccount: {
      update: async ({ where, data }) => {
        calls.push({ where, data });
        return { id: where.id, ...data };
      },
    },
  };
}

function withFetch(impl, fn) {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      globalThis.fetch = orig;
    });
}

test('getFreshAccessToken returns the cached token without a network call when unexpired', async () => {
  const account = {
    id: 'a1',
    accessTokenEnc: encryptToken('cached-access'),
    accessTokenExpiresAt: new Date(Date.now() + 60 * 60_000),
    refreshTokenEnc: encryptToken('rt'),
  };
  const client = fakeClient();
  await withFetch(
    () => {
      throw new Error('fetch must not be called');
    },
    async () => {
      const token = await getFreshAccessToken(client, account);
      assert.equal(token, 'cached-access');
      assert.equal(client.calls.length, 0);
    },
  );
});

test('getFreshAccessToken refreshes an expired token and marks the connection healthy', async () => {
  const account = {
    id: 'a2',
    accessTokenEnc: null,
    accessTokenExpiresAt: null,
    refreshTokenEnc: encryptToken('rt'),
  };
  const client = fakeClient();
  await withFetch(
    async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'fresh-at', expires_in: 3600 }) }),
    async () => {
      const token = await getFreshAccessToken(client, account);
      assert.equal(token, 'fresh-at');
      const patch = client.calls.at(-1).data;
      assert.equal(patch.healthState, 'connected');
      assert.ok(patch.lastRefreshAt instanceof Date);
      assert.equal(patch.lastAuthError, null);
    },
  );
});

test('getFreshAccessToken maps invalid_grant to reconnect_required and rethrows', async () => {
  const account = {
    id: 'a3',
    accessTokenEnc: null,
    accessTokenExpiresAt: null,
    refreshTokenEnc: encryptToken('rt'),
  };
  const client = fakeClient();
  await withFetch(
    async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }),
    }),
    async () => {
      await assert.rejects(() => getFreshAccessToken(client, account), /invalid_grant/);
      const patch = client.calls.at(-1).data;
      assert.equal(patch.healthState, 'reconnect_required');
      assert.match(patch.lastAuthError, /התחבר מחדש/);
      assert.ok(patch.lastAuthErrorAt instanceof Date);
    },
  );
});

test('getFreshAccessToken maps a network timeout to a coded error WITHOUT reconnect_required', async () => {
  const account = {
    id: 'a4',
    accessTokenEnc: null,
    accessTokenExpiresAt: null,
    refreshTokenEnc: encryptToken('rt'),
  };
  const client = fakeClient();
  await withFetch(
    async () => {
      const e = new Error('aborted');
      e.name = 'TimeoutError';
      throw e;
    },
    async () => {
      await assert.rejects(() => getFreshAccessToken(client, account), (e) => e.code === 'google_timeout');
      const patch = client.calls.at(-1).data;
      // A transient failure records a note but does NOT flip to reconnect_required.
      assert.equal(patch.healthState, undefined);
      assert.match(patch.lastAuthError, /לא הגיב בזמן/);
    },
  );
});
