// THE bridge between conversations (WhatsApp / Gmail) and Deal business
// activity. One module so both channels attribute messages by the SAME rule,
// and so `lastMeaningfulActivityAt` has exactly one meaning.
//
// WHY THIS EXISTS
// Deal timeline entries funnel through emitTimelineEvent, which stamps the
// deal automatically. Conversations do NOT: WhatsApp chats are written by the
// bridge and merged into the timeline at READ time, and Gmail threads are
// mirrored per-thread. Neither creates a per-deal row, so neither could move
// the deal's activity stamp — a customer could message all week and their deal
// would sink down the list.
//
// ATTRIBUTION — EXACTLY ONE DEAL (product decision 2026-07-31)
// An explicit link wins outright: EmailThread.linkedDealId is a stored
// decision (auto-matched on an unambiguous hit, or set by a human).
//
// Otherwise a PRIORITY LADDER picks a single deal — one message must never
// move every deal a contact owns. The first non-empty bucket wins:
//
//   P1  open deals, and WON deals with a genuinely LIVE future tour
//   P2  WON deals toured within the last 14 days   (still being wrapped up)
//   P3  WON deals with an outstanding balance      (money still owed)
//   P4  LOST deals closed within the last 3 months (plausibly being revived)
//
// No bucket matches → NOTHING is stamped. A message about a deal that closed
// two years ago is not activity on it, and inventing a stamp would be worse
// than having none.
//
// Within the winning bucket, a deterministic tie-break: most recent activity →
// newest deal → lowest id. Deterministic matters because this runs from a
// sweep that may re-see the same messages: the same input must always pick the
// same deal, or a repeated message would alternate between deals.
//
// "FUTURE TOUR" IS THE CANONICAL LIVE RELATIONSHIP, NOT A DATE COLUMN
// A WON deal reaches P1 only through Booking → TourEvent, because Deal.tourDate
// is a plan that outlives the plan: a cancelled tour leaves the date sitting
// there, and a stale future date must never float a dead deal to the top.
// A link counts as LIVE only when BOTH sides are alive — Booking.status
// 'active' (the deal can be un-booked while the tour itself runs on for other
// deals) AND TourEvent.status not 'cancelled'.
//
// Deal.tourDate remains the fallback for exactly ONE state: a WON deal that has
// no Booking rows at all — genuinely pre-live, the tour not generated yet. The
// moment a deal has ever had a booking, its bookings are the truth and the date
// column is ignored; that is precisely what keeps cancelled and reopened deals
// out of P1.

import { prisma } from '../db.js';
import { touchDealActivity } from '../timeline/events.js';
import { israelToday, addDays, compareDates } from '../lib/israelDate.js';
import { computeCollection, RECEIPT_DOCTYPES, REFUND_DOCTYPE } from '../collection.js';

const RECENT_TOUR_DAYS = 14;
const LOST_REVIVAL_DAYS = 90; // "last 3 months"

// Only the columns the ladder needs — a lean, dedicated read rather than
// dealResolution.dealsForContact, which also fetches stage/organization names
// for the inbox UI (two extra queries this path has no use for).
const LADDER_SELECT = {
  id: true,
  status: true,
  tourDate: true,
  lostAt: true,
  valueMinor: true,
  createdAt: true,
  lastMeaningfulActivityAt: true,
};

// No booking information resolved (pure-function default, and the correct
// state for a contact with no WON deals): every WON deal then looks pre-live,
// so Deal.tourDate is the only available signal.
const EMPTY_TOUR_STATE = { futureActive: new Set(), hasAnyBooking: new Set() };

/**
 * Resolve the live tour relationship for a set of WON deals — ONE batched
 * query over Booking with its TourEvent.
 *
 *   futureActive  — deals with at least one LIVE booking on a tour that is
 *                   still ahead: 'scheduled' with a future date, or
 *                   'postponed'. Postponed counts on purpose: the schema's own
 *                   contract is that a postponed tour keeps its team/notes and
 *                   returns to 'scheduled' when a new date is applied, so it is
 *                   unresolved live work — the most likely thing a customer is
 *                   messaging about. (Say the word if you'd rather it didn't.)
 *   hasAnyBooking — deals that have EVER been booked, in any state. This is the
 *                   pre-live discriminator, not a liveness test: an all-
 *                   cancelled deal has bookings, so it gets no date fallback.
 */
export async function resolveTourState(wonDealIds, db, today) {
  if (!wonDealIds.length) return EMPTY_TOUR_STATE;
  const bookings = await db.booking.findMany({
    where: { dealId: { in: wonDealIds } },
    select: {
      dealId: true,
      status: true,
      tourEvent: { select: { status: true, date: true } },
    },
  });
  const futureActive = new Set();
  const hasAnyBooking = new Set();
  for (const b of bookings) {
    hasAnyBooking.add(b.dealId);
    if (b.status !== 'active') continue; // un-booked from this tour
    const ev = b.tourEvent;
    if (!ev || ev.status === 'cancelled' || ev.status === 'completed') continue;
    // 'postponed' carries no date by contract — it is future work by nature.
    if (ev.status === 'postponed' || (ev.date && compareDates(ev.date, today) > 0)) {
      futureActive.add(b.dealId);
    }
  }
  return { futureActive, hasAnyBooking };
}

// most recent activity → newest deal → lowest id (stable, total order).
function compareCandidates(a, b) {
  const at = a.lastMeaningfulActivityAt ? new Date(a.lastMeaningfulActivityAt).getTime() : -Infinity;
  const bt = b.lastMeaningfulActivityAt ? new Date(b.lastMeaningfulActivityAt).getTime() : -Infinity;
  if (at !== bt) return bt - at;
  const ac = a.createdAt ? new Date(a.createdAt).getTime() : -Infinity;
  const bc = b.createdAt ? new Date(b.createdAt).getTime() : -Infinity;
  if (ac !== bc) return bc - ac;
  return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
}

/**
 * The priority buckets, in order. Pure — `unpaidWonIds` is supplied by the
 * caller so the (relatively expensive) payment lookup happens ONLY when the
 * ladder actually reaches P3.
 */
export function attributionBuckets(
  deals,
  { today, now = Date.now(), unpaidWonIds = null, tourState = EMPTY_TOUR_STATE } = {},
) {
  const isWon = (d) => d.status === 'won';
  const recentTourFloor = addDays(today, -RECENT_TOUR_DAYS);
  const lostFloorMs = now - LOST_REVIVAL_DAYS * 86_400_000;

  // A WON deal has live future work when a live booking points at a future
  // (or postponed) tour. Only a deal that has NEVER been booked falls back to
  // its planned date — see the header.
  const hasLiveFutureTour = (d) =>
    tourState.futureActive.has(d.id) ||
    (!tourState.hasAnyBooking.has(d.id) && d.tourDate && compareDates(d.tourDate, today) > 0);

  return [
    // P1 — live work: anything open, plus WON deals with a live future tour.
    deals.filter((d) => d.status === 'open' || (isWon(d) && hasLiveFutureTour(d))),
    // P2 — just toured: the wrap-up window.
    deals.filter(
      (d) =>
        isWon(d) &&
        d.tourDate &&
        compareDates(d.tourDate, today) <= 0 &&
        compareDates(d.tourDate, recentTourFloor) >= 0,
    ),
    // P3 — money still owed (payment state resolved by the caller).
    unpaidWonIds ? deals.filter((d) => isWon(d) && unpaidWonIds.has(d.id)) : [],
    // P4 — recently lost: plausibly being revived by this very conversation.
    deals.filter((d) => d.status === 'lost' && d.lostAt && new Date(d.lostAt).getTime() >= lostFloorMs),
  ];
}

/** WON deal ids whose money has not fully arrived. One batched docs query. */
async function unpaidWonDealIds(deals, db) {
  const wonIds = deals.filter((d) => d.status === 'won').map((d) => d.id);
  if (!wonIds.length) return new Set();
  const docs = await db.icountDocument.findMany({
    where: {
      dealId: { in: wonIds },
      status: 'issued',
      doctype: { in: [...RECEIPT_DOCTYPES, REFUND_DOCTYPE] },
    },
    select: { dealId: true, doctype: true, amountMinor: true, createdAt: true },
  });
  const byDeal = new Map();
  for (const d of docs) {
    if (!byDeal.has(d.dealId)) byDeal.set(d.dealId, []);
    byDeal.get(d.dealId).push(d);
  }
  const unpaid = new Set();
  for (const deal of deals) {
    if (deal.status !== 'won') continue;
    // 'paid' is the only fully-settled state; 'no_amount' (WON but never
    // priced) deliberately counts as outstanding — same rule the Collection
    // screen uses, because those are exactly the deals that fall through.
    const summary = computeCollection(deal.valueMinor, byDeal.get(deal.id) || []);
    if (summary.status !== 'paid') unpaid.add(deal.id);
  }
  return unpaid;
}

/**
 * Pick THE one deal a conversation with this contact should stamp, or null.
 * Exported for tests and for anything that needs the decision without writing.
 */
export async function selectActivityDealForContact(contactId, db = prisma, { now = Date.now() } = {}) {
  if (!contactId) return null;
  const deals = await db.deal.findMany({
    where: { contacts: { some: { contactId } } },
    select: LADDER_SELECT,
  });
  if (!deals.length) return null;

  const today = israelToday(now);
  const wonIds = deals.filter((d) => d.status === 'won').map((d) => d.id);
  // P1 needs the live tour relationship — one batched query, and only when the
  // contact actually has WON deals (a purely-open contact needs no tour data).
  const tourState = await resolveTourState(wonIds, db, today);

  let buckets = attributionBuckets(deals, { today, now, tourState });
  // P3's payment lookup is the expensive one: reach for it ONLY when the cheap
  // buckets came back empty and there are WON deals that could populate it.
  if (!buckets[0].length && !buckets[1].length && wonIds.length) {
    const unpaidWonIds = await unpaidWonDealIds(deals, db);
    buckets = attributionBuckets(deals, { today, now, unpaidWonIds, tourState });
  }

  for (const bucket of buckets) {
    if (bucket.length) return [...bucket].sort(compareCandidates)[0].id;
  }
  return null; // nothing plausible — stamp nothing rather than guess
}

/**
 * Stamp the ONE deal a WhatsApp chat belongs to. `at` is the MESSAGE's own
 * timestamp, so a late-delivered message stamps when it happened —
 * touchDealActivity's GREATEST keeps that monotonic.
 * Returns the number of deals stamped (0 or 1).
 */
export async function touchDealsForWhatsAppChat(chat, at, db = prisma) {
  if (!chat?.contactId) return 0; // unmatched conversation — no deal to touch
  const dealId = await selectActivityDealForContact(chat.contactId, db);
  if (!dealId) return 0;
  await touchDealActivity(db, dealId, at);
  return 1;
}

/**
 * Stamp the ONE deal an email thread belongs to. The explicit thread→deal link
 * wins; a contact-only thread runs the same ladder as WhatsApp.
 */
export async function touchDealsForEmailThread(thread, at, db = prisma) {
  if (!thread) return 0;
  if (thread.linkedDealId) {
    await touchDealActivity(db, thread.linkedDealId, at);
    return 1;
  }
  if (!thread.contactId) return 0;
  const dealId = await selectActivityDealForContact(thread.contactId, db);
  if (!dealId) return 0;
  await touchDealActivity(db, dealId, at);
  return 1;
}
