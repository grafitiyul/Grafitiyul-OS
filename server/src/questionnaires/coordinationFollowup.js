// A submitted coordination form → everything it sets in motion.
//
// ONE entry point, called once per submitted coordination form:
//   * a participant-change review card + manager WhatsApp (#21) + email (#22)
//   * a meeting-point message to THAT booking's customer (#23)
//   * a restaurant-recommendations message to THAT booking's customer (#24)
//
// ── Cardinality ─────────────────────────────────────────────────────────────
// Every decision here reads the SUBMISSION's own booking. There is no code path
// that can widen to the tour: an open tour with four bookings runs this function
// four times, once per submitted form, and each run can only reach its own
// customer. That is why four unrelated customers cannot receive each other's
// messages — not a filter, an absence of any wider reference.
//
// ── Exactly once ────────────────────────────────────────────────────────────
// Every action is keyed on the immutable submission id. The review card's
// dedupeKey and each report's idempotencyKey are unique indexes, so a re-submit,
// a page refresh, a queue retry and a replay all collapse onto the same rows.
//
// ── Never blocking ──────────────────────────────────────────────────────────
// Nothing here may fail a guide's submission. The form is the record; the
// follow-ups are consequences. Every step is caught individually so one broken
// consequence cannot take the others down with it.

import { prisma } from '../db.js';
import { createReviewItem } from '../reviewItems/service.js';
import { PARTICIPANT_CHANGE_KIND, participantChangeHeadline } from '../reviewItems/kinds/participantChange.js';
import { COORDINATION_ISSUE_KIND } from '../reviewItems/kinds/coordinationIssue.js';
import { fireAdminReport } from '../adminReports/dispatch.js';
import { participantVerdict, roleAnswered } from './coordinationRoles.js';
import { loadCoordinationScope } from './coordinationContext.js';
import { bookingSeatCount, coordinationContact } from './contextCatalog.js';
import { resolveMeetingPoint } from '../tours/meetingPoint.js';
import { publicLinksContext } from '../publicLinks.js';
import { notifiableGuides } from '../tours/guides.js';
import { resolveStaffDisplayName } from '../../../shared/staffAssignmentDisplay.mjs';
import { GENERIC_CUSTOMER_EN, GENERIC_CUSTOMER_HE } from '../displayFallbacks.js';

/**
 * The canonical customer label for THIS booking's deal (privacy rule):
 * organization name → coordination contact full name → generic "הלקוח".
 * NEVER Deal.title — internal CRM wording must not appear in follow-up
 * messages or review cards.
 */
export function coordinationCustomerLabel(deal, lang = 'he') {
  if (deal?.organization?.name) return deal.organization.name;
  const c = coordinationContact(deal);
  if (c) {
    const he = [c.firstNameHe, c.lastNameHe].filter(Boolean).join(' ').trim();
    const en = [c.firstNameEn, c.lastNameEn].filter(Boolean).join(' ').trim();
    const name = lang === 'en' ? en || he : he || en;
    if (name) return name;
  }
  return lang === 'en' ? GENERIC_CUSTOMER_EN : GENERIC_CUSTOMER_HE;
}

/** The customer we message for this booking — the same one the guide called. */
function customerRecipient(deal, lang) {
  const c = coordinationContact(deal);
  if (!c) return null;
  const phone = c.phones?.[0]?.value || null;
  if (!phone) return null;
  const he = [c.firstNameHe, c.lastNameHe].filter(Boolean).join(' ').trim();
  const en = [c.firstNameEn, c.lastNameEn].filter(Boolean).join(' ').trim();
  return {
    phone,
    name: (lang === 'en' ? en || he : he || en) || null,
    preferredLanguage: lang,
  };
}

/**
 * The tour's guide name(s), resolved from the CANONICAL TourEvent staff
 * assignments — never from the submission. Coordination forms are per-booking
 * (not perActor), so `submission.actorScope` is ALWAYS null in production;
 * resolving the name from it silently rendered "מדריך: —" on every #21/#22.
 * Lead guide(s) when assigned, otherwise every assigned guide — the same rule
 * every tour notification uses (tours/guides.js + resolveStaffDisplayName).
 */
function assignedGuideNames(tour, lang) {
  const names = notifiableGuides(tour?.assignments)
    .map((a) => resolveStaffDisplayName(a, lang))
    .filter(Boolean);
  return names.length ? names.join(', ') : null;
}

/**
 * Run every follow-up for one submitted coordination form.
 * Returns a summary of what happened, for tests and the submit log.
 */
export async function coordinationFollowups(
  { submission, questions = [], answers = {} },
  // `fire` is injectable ONLY so an integration test can prove this wiring
  // without messaging a real customer. Production always uses the canonical
  // dispatcher — there is no second sender.
  { db = prisma, log = console, fire = fireAdminReport } = {},
) {
  const out = { participantChange: null, meetingPoint: null, restaurants: null };
  if (submission?.purpose !== 'coordination' || submission?.subjectType !== 'booking') return out;

  const scope = await loadCoordinationScope(submission.subjectId, { db });
  if (!scope) return out;
  const { booking, deal, tour } = scope;

  // The customer's own language decides what THEY receive. The guide's language
  // and the office's language are irrelevant to a customer message.
  const customerLang = deal?.communicationLanguage
    || tour?.tourLanguage
    || deal?.tourLanguage
    || 'he';
  const recipient = customerRecipient(deal, customerLang === 'en' ? 'en' : 'he');

  const ctxBase = {
    dealId: deal?.id || null,
    tourEventId: tour?.id || null,
  };

  // ── 1. Participant count ──────────────────────────────────────────────────
  try {
    const registered = bookingSeatCount(booking);
    const verdict = participantVerdict({ questions, answers, registered });
    out.participantChange = verdict;

    if (verdict.changed) {
      const customerName = coordinationCustomerLabel(deal);
      const variantName = tour?.productVariant?.location?.nameHe || tour?.location?.nameHe || null;

      const frozen = {
        customerName,
        orgName: deal?.organization?.name || null,
        guideNameHe: assignedGuideNames(tour, 'he'),
        guideNameEn: assignedGuideNames(tour, 'en'),
        productName: tour?.product?.nameHe || null,
        variantName,
        tourDate: tour?.date || null,
        tourTime: tour?.startTime || null,
        registered: verdict.registered,
        corrected: verdict.corrected,
        delta: verdict.delta,
        note: verdict.note,
        dealOrderNo: deal?.orderNo ?? null,
        submissionId: submission.id,
      };

      // The card FIRST, so both notifications can link to something that exists.
      const card = await createReviewItem({
        kind: PARTICIPANT_CHANGE_KIND,
        dedupeKey: `${PARTICIPANT_CHANGE_KIND}:${submission.id}`,
        title: `שינוי בכמות משתתפים — ${customerName || 'לקוח'}`,
        summary: participantChangeHeadline(verdict),
        data: frozen,
        entityRefs: [
          tour?.id ? { type: 'tour_event', id: tour.id, label: [tour.date, tour.startTime].filter(Boolean).join(' ') } : null,
          deal?.id ? { type: 'deal', id: deal.id, orderNo: deal.orderNo, label: customerName || 'דיל' } : null,
        ].filter(Boolean),
        tourEventId: tour?.id || null,
        submissionId: submission.id,
        dealId: deal?.id || null,
      }, { db });
      out.participantChange.reviewItemId = card.item.id;

      // Only on FIRST creation — the card is per submission, so this is the
      // one moment the event is new.
      if (card.created) {
        const data = { participantChange: { ...frozen, reviewItemId: card.item.id } };
        await Promise.allSettled([
          fire({ number: 21, idempotencyKey: `participant_change:${submission.id}`, ...ctxBase, data }, log),
          fire({ number: 22, idempotencyKey: `participant_change:${submission.id}`, ...ctxBase, data }, log),
        ]);
      }
    }
  } catch (err) {
    log.error?.(`[coordination] participant follow-up failed: ${err?.message || err}`);
  }

  // ── 2. Meeting point to the customer ──────────────────────────────────────
  try {
    const asked = roleAnswered(questions, answers, 'send_meeting_point_followup');
    if (asked.yes) {
      const mp = await resolveMeetingPoint(tour?.id, customerLang === 'en' ? 'en' : 'he', { db });
      if (!mp.eligible) {
        // The guide asked for something we cannot send. That is an operational
        // problem to see, never an empty message and never a silent "sent".
        out.meetingPoint = { sent: false, reason: 'no_content' };
        await createReviewItem({
          kind: COORDINATION_ISSUE_KIND,
          dedupeKey: `meeting_point_missing:${submission.id}`,
          title: `לא נשלחה נקודת מפגש — אין תוכן ל${tour?.product?.nameHe || 'סיור'}`,
          summary: 'המדריך ביקש לשלוח ללקוח את נקודת המפגש, אך אין תוכן נקודת מפגש למוצר/מיקום הזה.',
          data: { reason: 'no_meeting_point_content', tourEventId: tour?.id || null, submissionId: submission.id },
          tourEventId: tour?.id || null,
          submissionId: submission.id,
          dealId: deal?.id || null,
        }, { db }).catch(() => {});
      } else if (!recipient) {
        out.meetingPoint = { sent: false, reason: 'no_recipient' };
      } else {
        const r = await fire({
          number: 23,
          idempotencyKey: `coordination_meeting_point:${submission.id}`,
          ...ctxBase,
          recipient,
          data: {
            meetingPoint: { text: mp.text, source: mp.source },
            // The canonical image rides the queue's existing media path.
            attachments: mp.image ? [mp.image] : [],
          },
        }, log);
        out.meetingPoint = { sent: !!r?.ok, hasImage: !!mp.image, source: mp.source };
      }
    }
  } catch (err) {
    log.error?.(`[coordination] meeting-point follow-up failed: ${err?.message || err}`);
  }

  // ── 3. Restaurant recommendations to the customer ─────────────────────────
  try {
    const asked = roleAnswered(questions, answers, 'send_restaurant_recommendations');
    if (asked.yes && recipient) {
      const r = await fire({
        number: 24,
        idempotencyKey: `coordination_restaurants:${submission.id}`,
        ...ctxBase,
        recipient,
        data: { publicLinks: publicLinksContext() },
      }, log);
      out.restaurants = { sent: !!r?.ok };
    } else if (asked.yes) {
      out.restaurants = { sent: false, reason: 'no_recipient' };
    }
  } catch (err) {
    log.error?.(`[coordination] restaurants follow-up failed: ${err?.message || err}`);
  }

  return out;
}
