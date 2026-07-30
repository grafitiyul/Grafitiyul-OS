// THE bridge between conversations (WhatsApp / Gmail) and Deal business
// activity. One module so both channels attribute messages to deals by the
// SAME rule, and so `lastMeaningfulActivityAt` has exactly one meaning.
//
// WHY THIS EXISTS
// Deal timeline entries funnel through emitTimelineEvent, which stamps the
// deal automatically. Conversations do NOT: WhatsApp chats are written by the
// bridge and merged into the timeline at READ time, and Gmail threads are
// mirrored per-thread. Neither creates a per-deal row, so neither could move
// the deal's activity stamp — a customer could message all week and their deal
// would sink down the list. This module closes that gap.
//
// ATTRIBUTION RULE (deliberate, and deliberately not "the one deal"):
//   * an EXPLICIT link wins — EmailThread.linkedDealId is a stored decision
//     (auto-matched on an unambiguous hit, or set by a human).
//   * otherwise every CANDIDATE deal of the linked contact is stamped, using
//     the same candidate definition the inbox's deal resolution uses (open
//     deals + WON deals toured within 7 days — crm/dealResolution.js).
// When a contact has two open deals we genuinely do not know which one the
// message concerns. Stamping both is honest ("this customer was in touch");
// stamping neither would silently lose the signal, and guessing one would be
// wrong half the time. Lost/old-won deals are excluded so an unrelated message
// can never resurrect a closed deal to the top of the list.

import { prisma } from '../db.js';
import { dealsForContact } from './dealResolution.js';
import { touchDealActivity } from '../timeline/events.js';

// Candidate deals for activity attribution — same rule as the inbox resolver,
// minus the "exactly one" requirement (see the header for why).
export async function activityDealIdsForContact(contactId, db = prisma) {
  if (!contactId) return [];
  const deals = await dealsForContact(contactId, db);
  if (!deals.length) return [];
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  return deals
    .filter((d) => d.status === 'open' || (d.status === 'won' && d.tourDate && d.tourDate >= sevenDaysAgo))
    .map((d) => d.id);
}

/**
 * Stamp the deals a WhatsApp chat belongs to. `at` is the MESSAGE's own
 * timestamp, so a backfilled/late-delivered message stamps when it happened —
 * and touchDealActivity's GREATEST keeps that monotonic.
 */
export async function touchDealsForWhatsAppChat(chat, at, db = prisma) {
  if (!chat?.contactId) return 0; // unmatched conversation — no deal to touch
  const ids = await activityDealIdsForContact(chat.contactId, db);
  for (const id of ids) await touchDealActivity(db, id, at);
  return ids.length;
}

/**
 * Stamp the deals an email thread belongs to. The explicit thread→deal link
 * wins; a contact-only thread falls back to the candidate rule.
 */
export async function touchDealsForEmailThread(thread, at, db = prisma) {
  if (!thread) return 0;
  if (thread.linkedDealId) {
    await touchDealActivity(db, thread.linkedDealId, at);
    return 1;
  }
  if (!thread.contactId) return 0;
  const ids = await activityDealIdsForContact(thread.contactId, db);
  for (const id of ids) await touchDealActivity(db, id, at);
  return ids.length;
}
