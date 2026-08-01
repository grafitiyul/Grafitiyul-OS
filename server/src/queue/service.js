// Queue aggregation — merge, order, and compute queue position.
//
// Reads only. Every write an operator can perform from the queue screen is
// delegated to the endpoint that already owns that row (see the UI's action
// links), so there is exactly one write path per subsystem, unchanged.

import { prisma } from '../db.js';
import { sourcesForChannel } from './sources/index.js';
import { QUEUE_STATUS } from './types.js';
import { policyMatrix } from '../communication/sendingPolicy.js';

/**
 * One channel's queue.
 *
 * `scope`: 'pending' (waiting / sending / failed) or 'history' (sent / skipped).
 *
 * Ordering for pending is by the moment the message will ACTUALLY go —
 * effectiveAt when it is held, scheduledAt otherwise — because that is the order
 * an operator is really asking about ("what goes out next?").
 */
export async function loadQueue({ channel, scope = 'pending', limit = 200, db = prisma } = {}) {
  const adapters = sourcesForChannel(channel);
  const results = await Promise.all(
    adapters.map((s) => s.list({ channel, scope, limit, db }).catch((err) => {
      // One failing adapter must not blank the whole screen; the others still
      // render and the failure is reported alongside them.
      return { __error: `${s.key}: ${err?.message || err}` };
    })),
  );

  const errors = [];
  const items = [];
  for (const r of results) {
    if (r && r.__error) { errors.push(r.__error); continue; }
    items.push(...r);
  }

  const goesAt = (i) => new Date(i.effectiveAt || i.scheduledAt || i.createdAt || 0).getTime();
  items.sort((a, b) => (scope === 'pending' ? goesAt(a) - goesAt(b) : goesAt(b) - goesAt(a)));

  // Queue POSITION is per sending account: two accounts drain independently, so
  // a global position would be meaningless. Only rows actually queued to go get
  // one — a failed row is not "3rd in line".
  const counters = new Map();
  for (const item of items) {
    if (scope !== 'pending') continue;
    if (item.status !== QUEUE_STATUS.waiting && item.status !== QUEUE_STATUS.sending) continue;
    const bucket = item.sender.accountId || 'default';
    const next = (counters.get(bucket) || 0) + 1;
    counters.set(bucket, next);
    item.queuePosition = next;
  }

  return {
    channel,
    scope,
    items,
    counts: {
      total: items.length,
      waiting: items.filter((i) => i.status === QUEUE_STATUS.waiting).length,
      failed: items.filter((i) => i.status === QUEUE_STATUS.failed).length,
      held: items.filter((i) => !!i.waitReasonHe).length,
    },
    errors,
  };
}

/**
 * Everything the queue screen needs in one call: both channels' counts, the
 * sending-window matrix, and live provider health — because "why is nothing
 * going out?" is usually answered by the provider, not by the rows.
 */
export async function queueOverview({ db = prisma } = {}) {
  const [wa, email, policies] = await Promise.all([
    loadQueue({ channel: 'whatsapp', scope: 'pending', limit: 500, db }),
    loadQueue({ channel: 'email', scope: 'pending', limit: 500, db }),
    policyMatrix({ db }),
  ]);
  return {
    whatsapp: wa.counts,
    email: email.counts,
    policies,
  };
}
