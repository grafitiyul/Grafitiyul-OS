// THE Context Pack builder — the ONE thing that decides what the agent is
// allowed to see about a conversation.
//
// Three jobs, all of them load-bearing:
//
//   1. GROUNDING. The agent must not answer from the last WhatsApp message
//      alone. It gets the bounded recent conversation plus the canonical CRM
//      facts that actually bear on it.
//
//   2. BOUNDING. It must NOT be handed the whole Deal or the whole database.
//      Every field here is deliberate, projected, and length-capped. Adding a
//      field is a conscious decision made in this file, not a side effect of a
//      wider include somewhere else.
//
//   3. PRIVACY. Minimal PII, no secrets, no other customers, no internal
//      identifiers. Notably absent by design:
//        • Deal.title  — INTERNAL CRM wording (project rule 17). This module is
//          on the dealTitleGuard CUSTOMER_FACING list precisely because its
//          output becomes customer-facing text.
//        • payment tokens / capability URLs — a link is minted by an operator
//          action, never improvised into a draft.
//        • phone numbers, emails, staff contact details, internal ids.
//
// Canonical sources only: it PROJECTS communication/context.js#loadTriggerContext
// (the one include tree every real communication already uses) rather than
// re-deriving a second, quietly-diverging view of a Deal.

import { prisma } from '../../db.js';
import { loadTriggerContext, contactFullName } from '../../communication/context.js';
import { selectActivityDealForContact } from '../../crm/conversationActivity.js';
import { effectiveActivityType, ACTIVITY_TYPE_LABELS_HE } from '../../../../shared/dealActivity.mjs';

// Hard caps. The agent gets a readable slice of the conversation, never a
// transcript that silently doubles the bill.
const MAX_MESSAGE_CHARS = 700;
const MAX_TOTAL_MESSAGE_CHARS = 6000;
const MAX_TASKS = 5;

/** Sources that actually supplied data — recorded on the run for provenance. */
function sourceList(pack) {
  const out = ['conversation'];
  if (pack.customer) out.push('contact');
  if (pack.organization) out.push('organization');
  if (pack.deal) out.push('deal');
  if (pack.pricing) out.push('pricing');
  if (pack.payment) out.push('payment');
  if (pack.tour) out.push('tour');
  if (pack.tasks?.length) out.push('tasks');
  return out;
}

function clamp(text, max) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// Deal.tourDate and TourEvent.date are date-only STRINGS in this schema, not
// DateTime columns — passing them through `new Date()` would drag a timezone
// into a value that deliberately has none.
function isoDate(d) {
  if (!d) return null;
  if (typeof d === 'string') return /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
  const t = d instanceof Date ? d : new Date(d);
  return Number.isNaN(t.getTime()) ? null : t.toISOString().slice(0, 10);
}

// Money columns are BigInt. Number() is safe here (agorot, far below 2^53) but
// must be explicit — a BigInt reaches JSON.stringify as a throw, not a number.
function moneyText(minor, currency) {
  if (minor == null) return null;
  const n = Number(minor);
  if (!Number.isFinite(n)) return null;
  const sym = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '₪';
  return `${sym}${(n / 100).toLocaleString('he-IL', { maximumFractionDigits: 2 })}`;
}

const minorNumber = (v) => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

// Bilingual display names, canonical fallback order: requested language → the
// other language → null. Never a raw id, never internal wording.
const bilingual = (he, en, language, max = 120) =>
  clamp(language === 'en' ? en || he : he || en, max) || null;

// Operator-facing wording for the canonical collection status. Deliberately
// explicit: "unknown" must never be silently rendered as "not paid".
const PAYMENT_STATE_HE = {
  paid: 'שולם במלואו',
  partial: 'שולם חלקית',
  unpaid: 'טרם שולם',
  overpaid: 'שולם ביתר',
  review: 'התקבל תשלום שדורש בדיקה — אין לקבוע מה שולם',
  no_amount: 'לא נקבע סכום לעסקה',
};

/**
 * Build the bounded context for ONE conversation turn.
 *
 * @param {object} p
 *   chat      WhatsAppChat row (id, contactId, type, savedContactName, pushName…)
 *   messages  ascending WhatsAppMessage rows, already limited by the caller
 *   language  'he' | 'en' — the resolved sending language
 * @returns {{ pack: object, sources: string[], dealId: string|null }}
 */
export async function buildContextPack({ chat, messages = [], language = 'he' }, db = prisma) {
  const pack = {
    // Everything the model sees about "now".
    conversation: buildConversation(chat, messages, language),
    customer: null,
    organization: null,
    deal: null,
    pricing: null,
    payment: null,
    tour: null,
    tasks: [],
    // Explicit unknowns. Stating what we DON'T know is what lets the model
    // escalate instead of inventing — an absent key reads as "not mentioned".
    unknown: [],
  };

  // No CRM link at all: an unmatched conversation is a legitimate, common state
  // (a brand-new enquiry). The agent still gets the conversation, and every
  // business fact is explicitly unknown.
  if (!chat?.contactId) {
    pack.unknown.push('customer_not_linked', 'deal', 'pricing', 'payment', 'tour');
    return { pack, sources: sourceList(pack), dealId: null };
  }

  // The ONE canonical conversation→deal rule (priority ladder, retired deals
  // excluded). Never re-implemented here.
  const dealId = await selectActivityDealForContact(chat.contactId, db);

  let ctx = null;
  try {
    // allowMint stays FALSE: building context must never mutate a Deal.
    ctx = await loadTriggerContext({ dealId: dealId || null }, { allowMint: false });
  } catch {
    ctx = null;
  }

  const contact = ctx?.contact
    || (await db.contact.findUnique({
      where: { id: chat.contactId },
      select: { id: true, firstNameHe: true, lastNameHe: true, firstNameEn: true, lastNameEn: true },
    }).catch(() => null));

  if (contact) {
    pack.customer = {
      // First name only — enough to greet, no more PII than the task needs.
      firstName: clamp(language === 'en'
        ? contact.firstNameEn || contact.firstNameHe
        : contact.firstNameHe || contact.firstNameEn, 60) || null,
      fullName: clamp(contactFullName(contact, language), 120) || null,
      isKnownCustomer: true,
    };
  } else {
    pack.unknown.push('customer_not_linked');
  }

  const org = ctx?.org || null;
  if (org) pack.organization = { name: clamp(org.name, 120) };

  const deal = ctx?.deal || null;
  if (!deal) {
    pack.unknown.push('deal', 'pricing', 'payment', 'tour');
    return { pack, sources: sourceList(pack), dealId: null };
  }

  // ── Deal: business language only. No Deal.title, no stage ids, no internals.
  const activityType = effectiveActivityType(deal);
  pack.deal = {
    orderNo: deal.orderNo ?? null,
    status: deal.status || null, // open | won | lost — shared/dealStatus vocabulary
    activityType,
    activityTypeText: activityType ? ACTIVITY_TYPE_LABELS_HE[activityType] || null : null,
    product: bilingual(deal.product?.nameHe, deal.product?.nameEn, language),
    variant: bilingual(
      deal.productVariant?.agentDisplayName,
      deal.productVariant?.agentDisplayNameEn,
      language,
    ),
    city: bilingual(deal.location?.nameHe, deal.location?.nameEn, language),
    participants: Number.isFinite(deal.participants) ? deal.participants : null,
    plannedDate: isoDate(deal.tourDate),
  };
  if (pack.deal.participants == null) pack.unknown.push('participant_count');

  // ── Pricing: NEVER improvised. Only what a produced quote actually says.
  const quoteDoc = ctx?.quoteDoc || null;
  const totalMinor = minorNumber(deal.valueMinor);
  if (totalMinor != null || quoteDoc) {
    pack.pricing = {
      hasQuote: !!quoteDoc,
      quoteVersionNo: quoteDoc?.versionNo ?? null,
      totalMinor,
      totalText: moneyText(totalMinor, deal.currency || 'ILS'),
      currency: deal.currency || 'ILS',
    };
  } else {
    pack.unknown.push('pricing');
  }

  // ── Payment: the canonical collection state, already resolved by the loader.
  const payment = ctx?.payment || null;
  if (payment) {
    pack.payment = {
      state: payment.status || 'unknown',
      stateText: PAYMENT_STATE_HE[payment.status] || 'לא ידוע',
      paidText: moneyText(payment.paidMinor, payment.currency),
      balanceText: moneyText(payment.balanceMinor, payment.currency),
      // A flagged deal is one where nobody may state what was paid.
      needsReview: payment.status === 'review',
    };
  } else {
    pack.unknown.push('payment');
  }

  // ── Tour: only a LIVE operational tour, never a stale plan. The meeting-point
  // wording lives on Location (meetingPointHe/En) — the same text the customer
  // communications already use, so the agent can never invent a second version.
  const tour = ctx?.tour || null;
  if (tour && tour.status !== 'cancelled') {
    pack.tour = {
      date: isoDate(tour.date),
      time: clamp(tour.startTime, 12) || null,
      city: bilingual(tour.location?.nameHe, tour.location?.nameEn, language),
      meetingPoint: bilingual(
        tour.location?.meetingPointHe,
        tour.location?.meetingPointEn,
        language,
        400,
      ),
      status: tour.status || null,
    };
    if (!pack.tour.meetingPoint) pack.unknown.push('meeting_point');
  } else {
    pack.unknown.push('tour');
  }

  // ── Open tasks: what the office already intends to do about this deal.
  try {
    const tasks = await db.task.findMany({
      where: { dealId: deal.id, status: 'open' },
      orderBy: [{ dueDate: 'asc' }],
      take: MAX_TASKS,
      select: { title: true, dueDate: true },
    });
    pack.tasks = tasks.map((t) => ({ title: clamp(t.title, 120), dueDate: isoDate(t.dueDate) }));
  } catch {
    pack.tasks = [];
  }

  return { pack, sources: sourceList(pack), dealId: deal.id };
}

// Bounded conversation projection. Media becomes a labelled placeholder rather
// than being dropped, so the model can see that the customer sent a photo — and
// escalate rather than answering a question it never actually read.
function buildConversation(chat, messages, language) {
  const rows = [];
  let budget = MAX_TOTAL_MESSAGE_CHARS;
  // Newest-first while spending the budget, so a long history never starves the
  // messages that actually matter; re-sorted to chronological afterwards.
  for (const m of [...messages].reverse()) {
    if (budget <= 0) break;
    const text = m.textContent
      ? clamp(m.textContent, Math.min(MAX_MESSAGE_CHARS, budget))
      : mediaPlaceholder(m.messageType);
    if (!text) continue;
    budget -= text.length;
    rows.push({
      from: m.direction === 'outgoing' ? 'us' : 'customer',
      at: m.timestampFromSource ? new Date(m.timestampFromSource).toISOString() : null,
      text,
    });
  }
  rows.reverse();
  return {
    channel: 'whatsapp',
    language,
    isGroup: chat?.type === 'group',
    displayName: clamp(chat?.savedContactName || chat?.pushName, 80) || null,
    messages: rows,
  };
}

function mediaPlaceholder(type) {
  const map = {
    image: '[הלקוח שלח תמונה]',
    video: '[הלקוח שלח סרטון]',
    audio: '[הלקוח שלח הודעה קולית]',
    document: '[הלקוח שלח קובץ]',
    sticker: '[סטיקר]',
  };
  return map[type] || '';
}

/**
 * Every value the agent is allowed to state as a number/amount. The price guard
 * checks a draft against exactly this set — anything else is invention.
 */
export function knownAmountTexts(pack) {
  const out = [];
  for (const v of [pack?.pricing?.totalText, pack?.payment?.paidText, pack?.payment?.balanceText]) {
    if (v) out.push(v);
  }
  return out;
}
