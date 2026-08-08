// Staleness — a suggestion drafted five minutes ago may no longer be true.
//
// The race this prevents is ordinary and frequent: the customer sends another
// message, or a second operator answers, between the agent drafting a reply and
// a human clicking send. The answer that was correct for turn N can be wrong,
// contradictory, or simply confusing at turn N+1.

import test from 'node:test';
import assert from 'node:assert/strict';
import { stalenessOf } from './proposals.js';

const proposal = {
  status: 'open',
  fpLastMessageId: 'msg_100',
  fpMessageCount: 12,
  fpDealUpdatedAt: new Date('2026-08-08T10:00:00Z'),
};

test('an unchanged conversation is not stale', () => {
  const res = stalenessOf(proposal, {
    lastMessageId: 'msg_100',
    messageCount: 12,
    dealUpdatedAt: new Date('2026-08-08T10:00:00Z'),
  });
  assert.equal(res.stale, false);
});

test('a newer message makes it stale', () => {
  const res = stalenessOf(proposal, {
    lastMessageId: 'msg_101',
    messageCount: 13,
    dealUpdatedAt: proposal.fpDealUpdatedAt,
  });
  assert.equal(res.stale, true);
  assert.equal(res.reason, 'newer_message');
});

test('a higher message count alone makes it stale', () => {
  // Belt and braces: the id check can be defeated by an out-of-order write,
  // the count cannot go backwards.
  const res = stalenessOf(proposal, {
    lastMessageId: 'msg_100',
    messageCount: 14,
    dealUpdatedAt: proposal.fpDealUpdatedAt,
  });
  assert.equal(res.stale, true);
  assert.equal(res.reason, 'newer_message');
});

test('a changed deal makes it stale', () => {
  const res = stalenessOf(proposal, {
    lastMessageId: 'msg_100',
    messageCount: 12,
    dealUpdatedAt: new Date('2026-08-08T11:30:00Z'),
  });
  assert.equal(res.stale, true);
  assert.equal(res.reason, 'deal_changed');
});

test('a superseded proposal is stale regardless of the conversation', () => {
  const res = stalenessOf({ ...proposal, status: 'superseded' }, {
    lastMessageId: 'msg_100', messageCount: 12, dealUpdatedAt: proposal.fpDealUpdatedAt,
  });
  assert.equal(res.stale, true);
  assert.equal(res.reason, 'superseded');
});

test('a missing proposal is treated as stale, never as sendable', () => {
  assert.equal(stalenessOf(null, {}).stale, true);
});

test('an older deal timestamp does not make it stale', () => {
  // Clock skew or a replayed read must not spuriously kill a valid suggestion.
  const res = stalenessOf(proposal, {
    lastMessageId: 'msg_100',
    messageCount: 12,
    dealUpdatedAt: new Date('2026-08-08T09:00:00Z'),
  });
  assert.equal(res.stale, false);
});

test('an unknown live fingerprint does not fabricate staleness', () => {
  // A conversation with no deal has no dealUpdatedAt; that is not a change.
  const res = stalenessOf(proposal, { lastMessageId: 'msg_100', messageCount: 12, dealUpdatedAt: null });
  assert.equal(res.stale, false);
});
