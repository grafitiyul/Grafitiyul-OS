import { test } from 'node:test';
import assert from 'node:assert/strict';

// sendUpdates verification — proves each Calendar write carries the flag that
// makes GOOGLE send its normal invitation/update/cancellation emails (GOS
// never sends its own). Runs against the real calendarFetch with a captured
// global fetch and a real (test-key) encrypted access token, so the assertion
// covers the actual request URL that would hit Google.

process.env.EMAIL_TOKEN_KEY = process.env.EMAIL_TOKEN_KEY || 'unit-test-token-key-123456';

const { encryptToken } = await import('../../email/tokenCrypto.js');
const { gcal } = await import('./googleCalendar.js');

function makeAccount() {
  return {
    id: 'acc1',
    accessTokenEnc: encryptToken('unit-test-access-token'),
    accessTokenExpiresAt: new Date(Date.now() + 3600_000), // fresh → no refresh
    refreshTokenEnc: encryptToken('unit-test-refresh-token'),
  };
}

async function withFetchCapture(fn) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: new URL(url), init });
    return { ok: true, status: 200, text: async () => '{"id":"ev1","items":[]}' };
  };
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = orig;
  }
}

test('insertEvent → POST with sendUpdates=all (guides get Google invitations)', async () => {
  await withFetchCapture(async (calls) => {
    await gcal.insertEvent({}, makeAccount(), { summary: 'x' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].url.searchParams.get('sendUpdates'), 'all');
    assert.match(calls[0].url.pathname, /\/calendars\/primary\/events$/);
  });
});

test('patchEvent → PATCH with sendUpdates=all (updates/attendee changes notify)', async () => {
  await withFetchCapture(async (calls) => {
    await gcal.patchEvent({}, makeAccount(), 'ev1', { attendees: [] });
    assert.equal(calls[0].init.method, 'PATCH');
    assert.equal(calls[0].url.searchParams.get('sendUpdates'), 'all');
    // Regression guard: an emptied attendee list is SENT explicitly.
    assert.equal(calls[0].init.body, '{"attendees":[]}');
  });
});

test('deleteEvent → DELETE with sendUpdates=all (guides get cancellations)', async () => {
  await withFetchCapture(async (calls) => {
    await gcal.deleteEvent({}, makeAccount(), 'ev1');
    assert.equal(calls[0].init.method, 'DELETE');
    assert.equal(calls[0].url.searchParams.get('sendUpdates'), 'all');
  });
});

test('restore/recreate path reuses patch/insert — both notify (covered above)', async () => {
  // The worker restores a Google-side-cancelled event via patchEvent
  // ({...desired, status:'confirmed'}) and recreates via insertEvent — both
  // asserted to carry sendUpdates=all. This test pins the payload shape.
  await withFetchCapture(async (calls) => {
    await gcal.patchEvent({}, makeAccount(), 'ev1', { status: 'confirmed', summary: 't' });
    assert.equal(calls[0].url.searchParams.get('sendUpdates'), 'all');
    assert.match(calls[0].init.body, /"status":"confirmed"/);
  });
});

test('reads (getEvent / findByTourEventId) never carry sendUpdates', async () => {
  await withFetchCapture(async (calls) => {
    await gcal.getEvent({}, makeAccount(), 'ev1');
    await gcal.findByTourEventId({}, makeAccount(), 'tour1');
    for (const c of calls) {
      assert.equal(c.init.method || 'GET', 'GET');
      assert.equal(c.url.searchParams.get('sendUpdates'), null);
    }
    assert.equal(
      calls[1].url.searchParams.get('privateExtendedProperty'),
      'gosTourEventId=tour1',
    );
  });
});

test('deleteEvent tolerates the empty 204 body Google returns', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 204, text: async () => '' });
  try {
    const res = await gcal.deleteEvent({}, makeAccount(), 'ev1');
    assert.deepEqual(res, {});
  } finally {
    globalThis.fetch = orig;
  }
});
