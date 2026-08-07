// "הודעה למדריך" — the office writes to the guide of ONE tour.
//
// Born in Management Tasks (reviewing a tour summary), but deliberately keyed
// on the TOUR, not on the review card: the same flow serves any surface that
// can name a tour. The review item only supplies WHICH tour and WHICH guide
// submitted the summary.
//
// This module owns three things and delegates everything else:
//   1. WHO can receive — the canonical guide-assignment rule (tours/guides.js).
//      Never parsed from text, never the deal owner, never the reviewer.
//   2. WHAT the message says — the canonical template resolver
//      (whatsapp/templateResolve.js) over the canonical variable registry, with
//      the recipient guide as ctx.staff and the tour as ctx.tour.
//   3. HOW it leaves — the canonical WhatsAppScheduledMessage queue (the same
//      transport the Team-tab staff send uses), never the bridge directly.
//
// Preview/send parity is structural rather than promised: the dialog previews
// the exact markup string it later posts back, and this module renders any
// remaining token through the SAME resolver before queueing, so a hand-typed
// {{token}} cannot reach a guide raw.

import { prisma } from '../db.js';
import { loadTriggerContext } from '../communication/context.js';
import { extractTokens, resolveVariables, substituteTokens } from '../communication/variables.js';
import { guidePortalUrl } from './guidePortal/links.js';
import { GUIDE_ROLES, notifiableGuides } from './guides.js';
import { resolveStaffDisplayName } from '../../../shared/staffAssignmentDisplay.mjs';
import { staffLanguage } from '../../../shared/staffName.mjs';
import {
  resolveTemplateBody,
  canonicalTemplateKey,
  normalizeAfterEmptyFill,
  templateVariableKeys,
} from '../whatsapp/templateResolve.js';
import { normalizePhoneIntl } from '../whatsapp/phone.js';
import { phoneToJid } from '../whatsapp/send.js';
import { kickScheduledWorker } from '../whatsapp/scheduledWorker.js';
import { configuredAccounts } from '../whatsapp/senderAccount.js';

export const GUIDE_MESSAGE_BATCH_KIND = 'guide_message';

const PERSON_SELECT = {
  id: true,
  displayName: true,
  phone: true,
  email: true,
  status: true,
  portalToken: true,
  portalEnabled: true,
  lifecycleHint: true,
  team: { select: { displayName: true } },
  profile: {
    select: {
      firstNameHe: true, lastNameHe: true,
      firstNameEn: true, lastNameEn: true,
      preferredLanguage: true,
    },
  },
};

/**
 * Recipient eligibility, stated rather than implied.
 * 'ok' | 'missing_phone' | 'invalid_phone' | 'no_person' (a historical
 * assignment that was never linked to a GOS person — nothing to write to).
 */
function recipientState(person) {
  if (!person) return { state: 'no_person', phoneIntl: null };
  const raw = String(person.phone || '').trim();
  if (!raw) return { state: 'missing_phone', phoneIntl: null };
  const intl = normalizePhoneIntl(raw);
  if (!intl) return { state: 'invalid_phone', phoneIntl: null };
  return { state: 'ok', phoneIntl: intl };
}

/**
 * The guide's own communication language — THE canonical staff resolver.
 * Hebrew whenever nothing was recorded; never guessed from a name or a phone.
 */
export const guideLanguage = (person) => staffLanguage(person);

/**
 * WHO this tour's message may address.
 *
 * Candidates are every GUIDE-role assignment (canonical GUIDE_ROLES —
 * workshop assistants are not guides), plus the person who actually submitted
 * the summary when they are not among them (a real case: the roster changed
 * after the tour). Each candidate carries its own eligibility so the dialog can
 * show WHY someone cannot be written to instead of hiding them.
 *
 * The default recipient, in order:
 *   1. the guide the review card is about — the exact person whose summary is
 *      open on the screen;
 *   2. otherwise the canonical notifiable guide when that resolves to exactly
 *      one person (lead guide if any, else the single assigned guide);
 *   3. otherwise null — the operator chooses explicitly. Nothing is ever sent
 *      to several guides at once from here.
 */
export function buildRecipients({ assignments = [], submitter = null }) {
  const guideAssignments = (assignments || []).filter((a) => GUIDE_ROLES.includes(a.role));
  // The identity of an assignment's person is its LINKED PersonRef, read
  // through the relation rather than a scalar column: the assignment rows this
  // module loads select `personRef` (not `personRefId`), and a historical
  // assignment may carry an external identity with no GOS person at all.
  const notifiable = new Set(notifiableGuides(guideAssignments).map((a) => a.personRef?.id).filter(Boolean));

  const rows = guideAssignments.map((a) => {
    const person = a.personRef || null;
    const { state, phoneIntl } = recipientState(person);
    return {
      personRefId: person?.id || null,
      assignmentId: a.id,
      name: resolveStaffDisplayName(a),
      role: a.role,
      isLead: a.role === 'lead_guide',
      isNotifiable: !!person?.id && notifiable.has(person.id),
      submittedSummary: !!submitter && person?.id === submitter.id,
      phone: person?.phone || null,
      phoneIntl,
      language: guideLanguage(person),
      state,
      canSend: state === 'ok',
      person,
    };
  });

  // The summary's author, when the roster no longer lists them. Shown for the
  // same reason: a manager reading their summary must be able to answer them.
  if (submitter && !rows.some((r) => r.personRefId === submitter.id)) {
    const { state, phoneIntl } = recipientState(submitter);
    rows.push({
      personRefId: submitter.id,
      assignmentId: null,
      name: resolveStaffDisplayName({ personRef: submitter, displayName: submitter.displayName }),
      role: null,
      isLead: false,
      isNotifiable: false,
      submittedSummary: true,
      phone: submitter.phone || null,
      phoneIntl,
      language: guideLanguage(submitter),
      state,
      canSend: state === 'ok',
      person: submitter,
    });
  }

  let defaultPersonRefId = null;
  const bySubmitter = rows.find((r) => r.submittedSummary && r.canSend);
  if (bySubmitter) {
    defaultPersonRefId = bySubmitter.personRefId;
  } else {
    const sendableNotifiable = rows.filter((r) => r.isNotifiable && r.canSend);
    if (sendableNotifiable.length === 1) defaultPersonRefId = sendableNotifiable[0].personRefId;
  }

  return { recipients: rows, defaultPersonRefId };
}

/**
 * Everything the dialog needs to open, from a tour (and optionally the review
 * card that led there). Read-only.
 */
export async function loadGuideMessageSubject({ tourEventId, reviewItemId = null }, { db = prisma } = {}) {
  let tourId = tourEventId || null;
  let reviewItem = null;
  if (reviewItemId) {
    reviewItem = await db.reviewItem.findUnique({
      where: { id: reviewItemId },
      select: { id: true, kind: true, tourEventId: true, personRefId: true, dealId: true },
    });
    if (!reviewItem) return { error: 'review_item_not_found' };
    tourId = tourId || reviewItem.tourEventId;
  }
  if (!tourId) return { error: 'tour_required' };

  const tour = await db.tourEvent.findUnique({
    where: { id: tourId },
    select: {
      id: true, date: true, startTime: true, kind: true, status: true,
      product: { select: { nameHe: true, nameEn: true } },
      location: { select: { nameHe: true, nameEn: true } },
      assignments: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, role: true, displayName: true, externalPersonId: true,
          personRef: { select: PERSON_SELECT },
        },
      },
      bookings: {
        where: { status: { not: 'cancelled' } },
        orderBy: { createdAt: 'asc' },
        select: { deal: { select: { id: true, orderNo: true } } },
      },
    },
  });
  if (!tour) return { error: 'tour_not_found' };

  const submitter = reviewItem?.personRefId
    ? await db.personRef.findUnique({ where: { id: reviewItem.personRefId }, select: PERSON_SELECT })
    : null;

  const { recipients, defaultPersonRefId } = buildRecipients({ assignments: tour.assignments, submitter });

  return {
    tour: {
      id: tour.id,
      date: tour.date,
      startTime: tour.startTime,
      status: tour.status,
      productName: tour.product?.nameHe || null,
      cityName: tour.location?.nameHe || null,
    },
    dealId: reviewItem?.dealId || tour.bookings[0]?.deal?.id || null,
    reviewItemId: reviewItem?.id || null,
    recipients,
    defaultPersonRefId,
  };
}

/**
 * The rendering context for ONE (tour, guide) pair: the canonical trigger
 * context for the tour and its deal, with the RECIPIENT guide bound to the
 * staff branch. `nowMs` is pinned by the caller so the natural-date variable
 * ("אתמול") renders identically for the preview and the send.
 */
export async function guideMessageContext({ tourEventId, dealId = null, person, nowMs = Date.now() }) {
  const base = await loadTriggerContext({ dealId: dealId || null, tourEventId });
  return {
    ...base,
    nowMs,
    staff: { person, portalUrl: guidePortalUrl(person) },
  };
}

/**
 * Resolve a stored guide template into the editable markup draft.
 * Mirrors the Deal template modal exactly: a missing value resolves to EMPTY
 * and is REPORTED — never a raw {{token}} on its way to a guide.
 */
export async function resolveGuideTemplate({ template, lang, tourEventId, dealId, person, nowMs }) {
  const bodyHtml = lang === 'en' ? template.bodyEnHtml : template.bodyHeHtml;
  if (!bodyHtml) return { error: 'language_unavailable' };
  const ctx = await guideMessageContext({ tourEventId, dealId, person, nowMs });
  const { text, missing } = resolveTemplateBody(bodyHtml, ctx, lang);
  return { text, missing };
}

/**
 * Final safety pass over operator-authored markup: substitute any token still
 * present using the same resolver/context the preview used. Already-resolved
 * text has no tokens left, so this is a no-op in the normal path — it exists so
 * a hand-typed {{tour_date_natural}} behaves like a chip instead of shipping as
 * literal moustache.
 *
 * Only keys this audience supports are substituted; anything else is reported
 * so the caller can refuse rather than silently blank it.
 */
export function fillRemainingTokens(text, ctx, lang) {
  const markup = String(text ?? '');
  const referenced = [...new Set(extractTokens(markup))];
  if (!referenced.length) return { text: markup, missing: [], unknown: [] };

  const allowed = new Set(templateVariableKeys('guide'));
  const canonical = [...new Set(referenced.map(canonicalTemplateKey))];
  const unknown = canonical.filter((k) => !allowed.has(k));
  const resolvable = canonical.filter((k) => allowed.has(k));
  const { values, missing } = resolveVariables(resolvable, ctx, lang);

  const fill = {};
  for (const key of referenced) {
    const c = canonicalTemplateKey(key);
    if (!allowed.has(c)) continue; // left visible, and refused by the caller
    fill[key] = values[c] ?? '';
  }
  if (!Object.keys(fill).length) return { text: markup, missing, unknown };
  const substituted = substituteTokens(markup, fill);
  const hadEmpty = Object.values(fill).some((v) => !v);
  return { text: hadEmpty ? normalizeAfterEmptyFill(substituted) : substituted, missing, unknown };
}

/**
 * Queue ONE guide message.
 *
 * Transport is the canonical queue, unchanged: a WhatsAppSendBatch is the
 * idempotency door (a double click replays the first outcome rather than
 * messaging the guide twice) and ONE WhatsAppScheduledMessage carries the text.
 * personRefId is what marks the row as a staff/guide send, so the guide sending
 * WINDOW applies exactly as it does to every other guide-directed message.
 *
 * Returns the queue row's REAL state; the caller reports it verbatim. This
 * never claims a send that has not happened.
 */
export async function queueGuideMessage({
  idempotencyKey,
  accountId,
  person,
  phoneIntl,
  text,
  tourEventId,
  dealId = null,
  reviewItemId = null,
  createdById = null,
}, { db = prisma } = {}) {
  const content = String(text ?? '').trim();
  if (!content) return { error: 'content_required' };

  const existing = await db.whatsAppSendBatch.findUnique({ where: { idempotencyKey } });
  if (existing) {
    const row = await db.whatsAppScheduledMessage.findFirst({
      where: { batchId: existing.id },
      orderBy: { createdAt: 'asc' },
    });
    return { replay: true, batchId: existing.id, row };
  }

  const configured = configuredAccounts();
  if (configured.length && !configured.includes(accountId)) return { error: 'unknown_account' };
  const account = await db.whatsAppAccount.findUnique({ where: { id: accountId } });
  if (!account || !account.active) return { error: 'unknown_account' };

  // Thread continuity: an existing private chat with this number on this
  // account wins, so the message lands in the conversation the office already
  // has with the guide rather than starting a parallel one.
  const jid = phoneToJid(phoneIntl);
  const chat = await db.whatsAppChat.findFirst({
    where: {
      accountId,
      type: 'private',
      OR: [{ phoneNumber: phoneIntl }, { externalChatId: jid }, { phoneJid: jid }],
    },
    select: { id: true },
  });

  const now = new Date();
  let batchId;
  let rowId;
  try {
    const created = await db.$transaction(async (tx) => {
      const batch = await tx.whatsAppSendBatch.create({
        data: {
          idempotencyKey,
          accountId,
          kind: GUIDE_MESSAGE_BATCH_KIND,
          // The message is already resolved, so the authored text IS the sent
          // text. Both columns hold it: templateText is the queue's history
          // source, templateHtml keeps the batch row shape consistent.
          templateHtml: content,
          templateText: content,
          scheduledAt: now,
          sendNow: true,
          recipientCount: 1,
          createdById,
        },
      });
      const row = await tx.whatsAppScheduledMessage.create({
        data: {
          accountId,
          chatId: chat?.id || null,
          destinationJid: jid,
          destinationPhone: phoneIntl,
          personRefId: person.id,
          batchId: batch.id,
          content,
          scheduledAt: now,
          // Provenance, readable in the queue screen: which tour/card this came
          // from. Loose string like every other createdById in the module.
          createdById: createdById || `guide-message:${reviewItemId || tourEventId}`,
        },
        select: { id: true },
      });
      return { batchId: batch.id, rowId: row.id };
    });
    batchId = created.batchId;
    rowId = created.rowId;
  } catch (err) {
    if (err?.code === 'P2002') {
      const winner = await db.whatsAppSendBatch.findUnique({ where: { idempotencyKey } });
      if (winner) {
        const row = await db.whatsAppScheduledMessage.findFirst({
          where: { batchId: winner.id },
          orderBy: { createdAt: 'asc' },
        });
        return { replay: true, batchId: winner.id, row };
      }
    }
    throw err;
  }

  kickScheduledWorker();
  const row = await db.whatsAppScheduledMessage.findUnique({ where: { id: rowId } });
  return { replay: false, batchId, row };
}
