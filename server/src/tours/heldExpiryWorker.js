import { prisma } from '../db.js';
import { expireRegistration } from './registrationLifecycle.js';
import { emitTimelineEvent, systemOrigin } from '../timeline/events.js';

// Held-reservation expiry sweep — a HELD TicketRegistration whose expiresAt has
// passed becomes EXPIRED (capacity released, derived product refreshed) and an
// audit event is written on the Deal + TourEvent. In-process 60s tick, same
// convention as the other tour workers; idempotent (re-checks 'held' under the
// transaction so it never races a confirmation).

const TICK_MS = 60_000;
let started = false;
let inFlight = false;

// Expire all due holds. Returns the count expired. Injectable client for tests.
export async function sweepExpiredHolds(client, { now = new Date(), limit = 50 } = {}) {
  const due = await client.ticketRegistration.findMany({
    where: { status: 'held', expiresAt: { lte: now } },
    orderBy: { expiresAt: 'asc' },
    take: limit,
    select: { id: true, tourEventId: true, dealId: true, quantity: true, expiresAt: true },
  });
  let expired = 0;
  for (const reg of due) {
    const runIn = async (tx) => {
      const fresh = await tx.ticketRegistration.findUnique({ where: { id: reg.id }, select: { status: true } });
      if (fresh?.status !== 'held') return false; // confirmed/cancelled meanwhile
      await expireRegistration(tx, reg.id);
      if (reg.dealId) {
        await emitTimelineEvent(tx, {
          subjectType: 'deal',
          subjectId: reg.dealId,
          kind: 'tour',
          body: '⌛ השריון פג ללא תשלום — המקום שוחרר',
          data: { event: 'hold_expired', registrationId: reg.id, tourEventId: reg.tourEventId, quantity: reg.quantity, expiresAt: reg.expiresAt },
          origin: systemOrigin(),
        });
      }
      await emitTimelineEvent(tx, {
        subjectType: 'tour_event',
        subjectId: reg.tourEventId,
        kind: 'tour',
        data: { event: 'hold_expired', registrationId: reg.id, dealId: reg.dealId },
        origin: systemOrigin(),
      });
      return true;
    };
    // Use a transaction when the client supports it (real prisma); tests pass a
    // flat fake and run inline.
    const didExpire = client.$transaction ? await client.$transaction(runIn) : await runIn(client);
    if (didExpire) expired += 1;
  }
  return expired;
}

export function startHeldExpiryWorker(log = console) {
  if (started) return;
  started = true;
  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const n = await sweepExpiredHolds(prisma);
      if (n) log?.log?.(`[held-expiry] expired ${n} reservation(s)`);
    } catch (e) {
      log?.warn?.('[held-expiry] tick failed:', e?.message);
    } finally {
      inFlight = false;
    }
  };
  setInterval(tick, TICK_MS).unref?.();
}
