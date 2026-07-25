import test from 'node:test';
import assert from 'node:assert/strict';

process.env.EMAIL_TOKEN_KEY = 'test-key-for-unit-tests-only-0123456789';
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'GOCSPX-test-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://u:p@localhost:5432/db';

const { runHealthCheck, describeScopes, parseScopes } = await import('./health.js');

const CAL_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const MODIFY_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';

function fakeDb() {
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

const okGmail = { getProfile: async () => ({ emailAddress: 'info@x.co.il' }) };
const okGcal = { probe: async () => ({ calendarId: 'primary', timeZone: 'Asia/Jerusalem' }) };
const invalidGrant = () => {
  const e = new Error('google token endpoint 400: invalid_grant');
  e.code = 'invalid_grant';
  throw e;
};

test('healthy account with both scopes → connected, both probes ok', async () => {
  const db = fakeDb();
  const account = { id: 'a1', emailAddress: 'info@x.co.il', refreshTokenEnc: 'enc', scopes: `${MODIFY_SCOPE} ${CAL_SCOPE}` };
  const r = await runHealthCheck(account, { db, gmail: okGmail, gcal: okGcal });
  assert.equal(r.healthState, 'connected');
  assert.equal(r.needsReconnect, false);
  assert.equal(r.gmail.ok, true);
  assert.equal(r.calendar.ok, true);
  assert.equal(r.calendar.scopeGranted, true);
  const patch = db.calls.at(-1).data;
  assert.equal(patch.healthState, 'connected');
  assert.ok(patch.lastGmailCheckAt instanceof Date);
  assert.ok(patch.lastCalendarCheckAt instanceof Date);
  assert.equal(patch.lastAuthError, null);
});

test('invalid_grant on the Gmail probe → reconnect_required (whole connection)', async () => {
  const db = fakeDb();
  const account = { id: 'a2', emailAddress: 'info@x.co.il', refreshTokenEnc: 'enc', scopes: `${MODIFY_SCOPE} ${CAL_SCOPE}` };
  const r = await runHealthCheck(account, { db, gmail: { getProfile: invalidGrant }, gcal: { probe: invalidGrant } });
  assert.equal(r.healthState, 'reconnect_required');
  assert.equal(r.needsReconnect, true);
  assert.equal(r.gmail.ok, false);
  assert.match(r.gmail.error, /התחבר מחדש/);
  const patch = db.calls.at(-1).data;
  assert.equal(patch.healthState, 'reconnect_required');
  assert.match(patch.lastAuthError, /התחבר מחדש/);
});

test('Gmail ok but Calendar scope missing → connected, calendar flagged not-connected', async () => {
  const db = fakeDb();
  const account = { id: 'a3', emailAddress: 'info@x.co.il', refreshTokenEnc: 'enc', scopes: MODIFY_SCOPE };
  const r = await runHealthCheck(account, { db, gmail: okGmail, gcal: okGcal });
  assert.equal(r.healthState, 'connected');
  assert.equal(r.gmail.ok, true);
  assert.equal(r.calendar.scopeGranted, false);
  assert.equal(r.calendar.ok, false);
  assert.match(r.calendar.error, /הרשאת יומן/);
  const patch = db.calls.at(-1).data;
  assert.equal(patch.lastCalendarCheckAt, undefined); // never probed calendar
});

test('disconnected account (no refresh token) → disconnected, needs reconnect', async () => {
  const db = fakeDb();
  const account = { id: 'a4', emailAddress: 'info@x.co.il', refreshTokenEnc: null, scopes: `${MODIFY_SCOPE} ${CAL_SCOPE}` };
  const r = await runHealthCheck(account, { db, gmail: okGmail, gcal: okGcal });
  assert.equal(r.healthState, 'disconnected');
  assert.equal(r.needsReconnect, true);
  // No probes are attempted when there is no token.
  assert.equal(db.calls.at(-1).data.healthState, 'disconnected');
});

test('a transient Gmail error (not invalid_grant) → error state, NOT reconnect_required', async () => {
  const db = fakeDb();
  const account = { id: 'a5', emailAddress: 'info@x.co.il', refreshTokenEnc: 'enc', scopes: `${MODIFY_SCOPE} ${CAL_SCOPE}` };
  const flaky = {
    getProfile: async () => {
      const e = new Error('gmail 503');
      e.status = 503;
      throw e;
    },
  };
  const r = await runHealthCheck(account, { db, gmail: flaky, gcal: okGcal });
  assert.equal(r.needsReconnect, false);
  assert.equal(r.healthState, 'error');
  assert.equal(r.gmail.ok, false);
});

test('describeScopes / parseScopes present business labels, not raw URLs', () => {
  const labels = describeScopes(`${MODIFY_SCOPE} ${CAL_SCOPE}`);
  assert.ok(labels.includes('ניהול אירועי יומן'));
  assert.ok(labels.some((l) => /Gmail/.test(l)));
  assert.equal(parseScopes('a  b   c').length, 3);
  assert.equal(parseScopes(null).length, 0);
});
