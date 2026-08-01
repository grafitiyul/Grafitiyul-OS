import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveSendPolicy, checkSendAllowed, policyMatrix,
  audienceKindFromCommunication, audienceKindFromScheduledMessage, audienceKindFromReport,
  AUDIENCE_KINDS, POLICY_CHANNELS,
} from './sendingPolicy.js';
import { israelLocalToMs } from './windows.js';

// "זמני שליחה" — one window policy for every sender.
//
// The non-negotiable behaviour proved here:
//   * a message held by a window WAITS and reports when it will go;
//   * a backlog released after an outage lands at the next legitimate opening,
//     never at 03:00;
//   * an explicit per-message window beats the global matrix.

// 09:00–18:00, Sunday(0) through Thursday(4).
const OFFICE_HOURS = {
  id: 'w1',
  name: 'שעות משרד',
  rules: [{ days: [0, 1, 2, 3, 4], start: '09:00', end: '18:00' }],
};

function stubDb({ policies = [], windows = {}, exceptions = [] } = {}) {
  return {
    communicationWindowException: { findMany: async () => exceptions },
    communicationSendingWindow: { findUnique: async ({ where }) => windows[where.id] ?? null },
    sendingWindowPolicy: {
      findUnique: async ({ where }) => {
        const { audienceKind, channel } = where.audienceKind_channel;
        return policies.find((p) => p.audienceKind === audienceKind && p.channel === channel) ?? null;
      },
      findMany: async () => policies,
    },
  };
}

// A Wednesday in Israel: 2026-09-16.
const at = (time) => israelLocalToMs('2026-09-16', Number(time.split(':')[0]) * 60 + Number(time.split(':')[1]));

// ── audience mapping ─────────────────────────────────────────────────────────

test('communication audiences map to the right policy', () => {
  assert.equal(audienceKindFromCommunication('primary_contact'), 'customer');
  assert.equal(audienceKindFromCommunication('field_contact'), 'customer');
  assert.equal(audienceKindFromCommunication('explicit_contact'), 'customer');
  assert.equal(audienceKindFromCommunication('assigned_guides'), 'guide');
  // Internal destinations follow the manager policy.
  assert.equal(audienceKindFromCommunication('explicit_staff'), 'manager');
  assert.equal(audienceKindFromCommunication('wa_group'), 'manager');
});

test('a staff scheduled message is a guide send; a CRM one is a customer send', () => {
  assert.equal(audienceKindFromScheduledMessage({ personRefId: 'p1' }), 'guide');
  assert.equal(audienceKindFromScheduledMessage({ personRefId: null }), 'customer');
});

test('guide-audience reports follow the guide policy, the rest follow managers', () => {
  assert.equal(audienceKindFromReport({ audience: 'guides' }), 'guide');
  assert.equal(audienceKindFromReport({}), 'manager');
});

// ── precedence ───────────────────────────────────────────────────────────────

test('with no policy row, nothing is held back', async () => {
  const r = await checkSendAllowed(
    { audienceKind: 'customer', channel: 'whatsapp', atMs: at('03:00') },
    { db: stubDb() },
  );
  assert.equal(r.allowed, true);
});

test('a DISABLED policy row does not hold anything back', async () => {
  // The migration seeds all six cells disabled, so behaviour is unchanged until
  // an operator turns one on. A migration must never silently start queueing.
  const db = stubDb({
    policies: [{ audienceKind: 'customer', channel: 'whatsapp', enabled: false, window: OFFICE_HOURS }],
    windows: { w1: OFFICE_HOURS },
  });
  const r = await checkSendAllowed({ audienceKind: 'customer', channel: 'whatsapp', atMs: at('03:00') }, { db });
  assert.equal(r.allowed, true);
});

test('an explicit per-message window beats the audience matrix', async () => {
  // An operator who deliberately chose a window for one message must not have
  // it silently overridden by a global default.
  const alwaysOpen = { id: 'w2', name: 'תמיד', rules: [{ days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '24:00' }] };
  const db = stubDb({
    policies: [{ audienceKind: 'customer', channel: 'whatsapp', enabled: true, window: OFFICE_HOURS }],
    windows: { w1: OFFICE_HOURS, w2: alwaysOpen },
  });
  const policy = await resolveSendPolicy({
    audienceKind: 'customer', channel: 'whatsapp',
    messageOverride: { windowEnabled: true, sendingWindowId: 'w2' },
  }, { db });
  assert.equal(policy.source, 'message');
  assert.equal(policy.window.id, 'w2');

  const r = await checkSendAllowed({
    audienceKind: 'customer', channel: 'whatsapp',
    messageOverride: { windowEnabled: true, sendingWindowId: 'w2' },
    atMs: at('03:00'),
  }, { db });
  assert.equal(r.allowed, true, 'the message-level window permits 03:00');
});

// ── the headline behaviour ───────────────────────────────────────────────────

test('an overnight backlog releases at the next opening, NOT at 03:00', async () => {
  // This is the requirement in one test: messages accumulated while the
  // provider was down must wait for the window rather than all firing at once
  // in the middle of the night.
  const db = stubDb({
    policies: [{ audienceKind: 'customer', channel: 'whatsapp', enabled: true, window: OFFICE_HOURS }],
    windows: { w1: OFFICE_HOURS },
  });

  const held = await checkSendAllowed(
    { audienceKind: 'customer', channel: 'whatsapp', atMs: at('03:00') },
    { db },
  );
  assert.equal(held.allowed, false, '03:00 is outside the window');
  assert.ok(held.reason, 'the operator must see WHY it is waiting');
  assert.equal(held.nextAt, at('09:00'), 'it must be scheduled for the window opening');

  const open = await checkSendAllowed(
    { audienceKind: 'customer', channel: 'whatsapp', atMs: at('10:00') },
    { db },
  );
  assert.equal(open.allowed, true);
  assert.equal(open.nextAt, null);
});

test('each audience and channel is configured independently', async () => {
  const db = stubDb({
    policies: [
      { audienceKind: 'customer', channel: 'whatsapp', enabled: true, window: OFFICE_HOURS },
      { audienceKind: 'guide', channel: 'whatsapp', enabled: false, window: null },
      { audienceKind: 'customer', channel: 'email', enabled: false, window: null },
    ],
    windows: { w1: OFFICE_HOURS },
  });
  const night = at('03:00');
  assert.equal((await checkSendAllowed({ audienceKind: 'customer', channel: 'whatsapp', atMs: night }, { db })).allowed, false);
  // A guide can be woken at 03:00 if that is how the office configured it —
  // the point is that the two are separate decisions.
  assert.equal((await checkSendAllowed({ audienceKind: 'guide', channel: 'whatsapp', atMs: night }, { db })).allowed, true);
  // Same audience, other channel, other policy.
  assert.equal((await checkSendAllowed({ audienceKind: 'customer', channel: 'email', atMs: night }, { db })).allowed, true);
});

test('a global BLOCK exception stops everything, even unwindowed sends', async () => {
  // Safety defeats urgency — the rule already lived in windows.js and must keep
  // applying to senders that have no window at all.
  const db = stubDb({
    exceptions: [{ id: 'e1', kind: 'block', label: 'יום כיפור', windowId: null, dateFrom: '2026-09-16', active: true }],
  });
  const r = await checkSendAllowed({ audienceKind: 'manager', channel: 'whatsapp', atMs: at('10:00') }, { db });
  assert.equal(r.allowed, false);
  assert.match(r.reason, /יום כיפור/);
});

test('an enabled policy with NO window fails closed, with a reason', async () => {
  // A configuration error must be visible, never silently permissive.
  const db = stubDb({ policies: [{ audienceKind: 'customer', channel: 'whatsapp', enabled: true, window: null }] });
  const r = await checkSendAllowed({ audienceKind: 'customer', channel: 'whatsapp', atMs: at('10:00') }, { db });
  assert.equal(r.allowed, false);
  assert.match(r.reason, /לא נבחר חלון שליחה/);
});

// ── the settings matrix ──────────────────────────────────────────────────────

test('the matrix always exposes every audience × channel cell', async () => {
  const matrix = await policyMatrix({ db: stubDb({ policies: [] }) });
  assert.equal(matrix.length, AUDIENCE_KINDS.length * POLICY_CHANNELS.length);
  for (const cell of matrix) {
    assert.ok(cell.audienceLabelHe, 'every cell needs a Hebrew label');
    assert.equal(cell.enabled, false);
  }
});
