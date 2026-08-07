import { registerIssueType } from '../registry.js';
import { registerDetector } from '../sweepWorker.js';
import { raiseIssue, resolveMissing } from '../issueService.js';
import { dealBookerLabel } from '../../tours/customerDisplay.js';
import {
  activityTourCompatibility,
  isActivityTourCompatible,
  ACTIVITY_TYPE_LABELS_HE,
} from '../../../../shared/dealActivity.mjs';
import { CAPACITY_STATUSES } from '../../tours/registrationStatus.js';

// Deal.activityType ⇄ TourEvent.kind DRIFT — and the recovery flow for it.
//
// The backstop for the hole the conversion service closes. Before that service
// existed, `activityType` was a plain field on PUT /deals/:id with no guard:
// flipping a WON group deal to 'private' left the Booking active on the group
// slot and the seat still consumed, while the deal claimed to be something
// else. Nothing noticed — pendingTourUpdate early-returns on a group slot
// (correctly: a slot's fields are slot-owned) and wonGate only runs on a WON
// transition.
//
// The router now refuses that write with 409 conversion_required, so new drift
// of this class should not occur. This detector stays permanently anyway,
// because Operations Control is the final safety net: it does not care WHO
// produced the state, only that it exists, so a future writer inventing a new
// way in is surfaced within one sweep.
//
// ── The recovery is TWO directions, and the operator picks ──────────────────
//
// Nothing here auto-decides. Both sides can legitimately be the correct one —
// "the customer really is on the open tour, the label is wrong" and "the label
// is right, they were put on the wrong tour" are both real situations, and only
// a person knows which happened. So every card offers both, and both route
// through the SAME canonical conversion service (deals/activityConversion.js):
//
//   A. "שנה את הסיור ל-<deal type>"  → convert with target = the DEAL's type.
//      The deal is right; the operational side moves. Depending on the pair
//      this is a real conversion (release seats + join a chosen slot, or leave
//      a slot for a dedicated tour) or an in-place relabel of the same
//      TourEvent — conversionMode() decides, never this file.
//
//   B. "שנה את הדיל ל-<tour type>"   → convert with target = the TOUR's type.
//      The tour is right; only the classification is wrong. Because the deal is
//      already booked on a tour of that kind, conversionMode() resolves this to
//      `align_classification`: not one seat moves.
//
// Both are LINKS carrying the target, not fire-and-forget API actions: a
// correction can need a group slot chosen, an organization decision, or a look
// at the money first. The conversion dialog is where that is collected and
// where the exact consequences are shown before anything is written.

const TYPE = 'deal_activity_tour_mismatch';
const dedupeKey = (dealId) => `${TYPE}:${dealId}`;

const KIND_LABEL_HE = {
  group_slot: 'סיור קבוצתי / פתוח',
  private: 'סיור פרטי',
  business: 'סיור עסקי',
};

function fmtDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

// Re-exported thin wrappers so this module has ONE dependency for the rule and
// call sites read naturally. The semantics live in shared/dealActivity.mjs.
export function activityMismatch(deal, tour) {
  if (!deal?.activityType || !tour?.kind) return false;
  return !isActivityTourCompatible(deal.activityType, tour.kind);
}

export function mismatchSeverity(deal, tour) {
  return activityTourCompatibility(deal?.activityType, tour?.kind).severity || 'warning';
}

// Everything §7 asks the card to show, resolved once, from rows already loaded.
function contextFor(deal, tour, booking, seatRows) {
  const liveSeats = (seatRows || [])
    .filter((r) => CAPACITY_STATUSES.includes(r.status))
    .reduce((n, r) => n + (r.quantity || 0), 0);
  return {
    dealOrderNo: deal.orderNo,
    dealActivityType: deal.activityType,
    dealActivityLabelHe: ACTIVITY_TYPE_LABELS_HE[deal.activityType] || deal.activityType,
    tourKind: tour.kind,
    tourKindLabelHe: KIND_LABEL_HE[tour.kind] || tour.kind,
    date: tour.date,
    startTime: tour.startTime,
    dateLabelHe: [fmtDate(tour.date), tour.startTime].filter(Boolean).join(' · ') || 'ללא מועד',
    productLabelHe: tour.product?.nameHe || deal.product?.nameHe || null,
    variantLabelHe: tour.productVariant
      ? [tour.productVariant.product?.nameHe, tour.productVariant.location?.nameHe].filter(Boolean).join(' · ') || null
      : null,
    participants: deal.participants ?? null,
    // The single most operationally important distinction: a generated open-tour
    // occurrence carries shared stock and a Woo variation; a dedicated tour does
    // not. The card says which one this is, in words.
    isOpenTourSlot: tour.kind === 'group_slot',
    openTourTemplateId: tour.openTourTemplateId || null,
    slotOriginHe:
      tour.kind !== 'group_slot'
        ? 'סיור ייעודי לדיל'
        : tour.openTourTemplateId
          ? 'מופע של סיור פתוח (נוצר מתבנית)'
          : 'סיור קבוצתי שנוצר ידנית',
    capacity: tour.capacity ?? null,
    bookingId: booking.id,
    bookingSeats: booking.seats,
    liveSeats,
  };
}

function buildPayload(deal, tour, booking, seatRows) {
  const verdict = activityTourCompatibility(deal.activityType, tour.kind);
  const customer = dealBookerLabel(deal) || 'לקוח';
  const ctx = contextFor(deal, tour, booking, seatRows);
  const opening = `הדיל מסווג כפעילות ${ctx.dealActivityLabelHe}, אך הוא משובץ ל${ctx.tourKindLabelHe} (${ctx.dateLabelHe}). `;

  return {
    type: TYPE,
    severity: verdict.severity,
    sourceModule: 'deals',
    dedupeKey: dedupeKey(deal.id),
    title:
      verdict.severity === 'critical'
        ? `סוג הפעילות בדיל אינו תואם לסיור המשובץ — ${customer}`
        : `סיווג הסיור לא עודכן לפי הדיל — ${customer}`,
    explanation:
      (verdict.severity === 'critical'
        ? opening
          + 'כלומר מבחינה מסחרית הדיל אומר דבר אחד ומבחינה תפעולית קורה דבר אחר: '
          + 'התמחור, מייל האישור, המסרים ללקוח והדוחות נגזרים מהסיווג שבדיל, '
          + 'בעוד שהמקומות, הקיבולת, המלאי בחנות והמדריכים נגזרים מהסיור בפועל.'
        : opening
          + 'ההבדל בין פרטי לעסקי הוא בתווית בלבד — המקומות, הקיבולת והתפעול זהים לגמרי, '
          + 'ולכן שום דבר לא שבור. מה שכן: ביומן ובאזור המדריכים הסיור מוצג בסיווג הישן.')
      + ' יש להחליט איזה צד נכון: לתקן את הסיור לפי הדיל, או את הדיל לפי הסיור. '
      + 'שתי האפשרויות עוברות דרך מסלול שינוי סוג הפעילות, שמראה בדיוק מה ישתנה לפני הביצוע.',
    entityRefs: [
      { type: 'deal', id: deal.id, orderNo: deal.orderNo, label: customer },
      { type: 'tour_event', id: tour.id, label: ctx.dateLabelHe },
    ],
    data: {
      dealId: deal.id,
      tourEventId: tour.id,
      customer,
      structural: verdict.structural,
      // The two correction targets, resolved by the ONE compatibility resolver
      // so the card can never offer a direction the service would refuse.
      tourSideTarget: verdict.tourTarget, // "make the TOUR match the deal"
      dealSideTarget: verdict.dealTarget, // "make the DEAL match the tour"
      ...ctx,
    },
  };
}

// Only ACTIVE bookings on LIVE tours can be incoherent: a cancelled booking is
// history, and a cancelled/completed tour is no longer operational truth.
const DETECT_WHERE = {
  status: 'active',
  tourEvent: { status: { in: ['scheduled', 'postponed'] } },
};

const DETECT_SELECT = {
  id: true,
  seats: true,
  ticketRegistrations: { select: { status: true, quantity: true } },
  tourEvent: {
    select: {
      id: true, kind: true, date: true, startTime: true, capacity: true,
      openTourTemplateId: true,
      product: { select: { nameHe: true } },
      productVariant: {
        select: { product: { select: { nameHe: true } }, location: { select: { nameHe: true } } },
      },
    },
  },
  deal: {
    select: {
      id: true, orderNo: true, activityType: true, title: true, participants: true,
      product: { select: { nameHe: true } },
      organization: { select: { name: true } },
      contacts: {
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        take: 1,
        select: {
          contact: {
            select: { firstNameHe: true, lastNameHe: true, firstNameEn: true, lastNameEn: true },
          },
        },
      },
    },
  },
};

registerDetector({
  key: 'deal-activity-tour-mismatch',
  async run(client) {
    const bookings = await client.booking.findMany({
      where: DETECT_WHERE,
      select: DETECT_SELECT,
      take: 1000,
    });
    const present = new Set();
    for (const b of bookings) {
      if (!b.deal || !b.tourEvent) continue;
      if (!activityMismatch(b.deal, b.tourEvent)) continue;
      present.add(dedupeKey(b.deal.id));
      await raiseIssue(client, buildPayload(b.deal, b.tourEvent, b, b.ticketRegistrations));
    }
    // Auto-resolve: the moment either correction lands, the pair is compatible
    // and the card closes on the next sweep without anyone dismissing it.
    await resolveMissing(client, TYPE, present);
  },
});

registerIssueType(TYPE, {
  labelHe: 'סוג פעילות שאינו תואם לסיור',
  purposeHe:
    'הדיל מסווג כסוג פעילות אחד אך משובץ לסיור מסוג אחר — התמחור והתקשורת עם הלקוח '
    + 'נגזרים מהסיווג, בעוד המקומות והתפעול נגזרים מהסיור בפועל. '
    + 'אי-התאמה שמערבת סיור קבוצתי היא קריטית (מקומות, קיבולת ומלאי); '
    + 'אי-התאמה בין פרטי לעסקי היא תווית בלבד ומסומנת כאזהרה.',
  fixHe:
    'נסגר אוטומטית ברגע שאחד הצדדים תוקן — דרך מסלול שינוי סוג הפעילות, '
    + 'שמשחרר ותופס מקומות, מסנכרן יומן, מלאי, שכר ומסרים מתוזמנים כנדרש.',
  sourceModule: 'deals',

  buildActions(issue) {
    const d = issue.data || {};
    const dealTarget = d.dealSideTarget;
    const tourTarget = d.tourSideTarget;
    const label = (t) => ACTIVITY_TYPE_LABELS_HE[t] || t;
    const dealRef = { type: 'deal', id: d.dealId, orderNo: d.dealOrderNo };
    return [
      // A — the deal is right, move the operational side.
      tourTarget && {
        key: 'fix_tour',
        label: `שנה את הסיור ל${label(tourTarget)}`,
        kind: 'link',
        style: 'primary',
        // The target rides in the URL; the Deal page opens the conversion
        // dialog pre-aimed, which is where the exact consequences are shown and
        // any missing input (a group slot, an organization decision) is
        // collected BEFORE anything is written.
        target: { ...dealRef, query: { convert: tourTarget } },
      },
      // B — the tour is right, correct the classification.
      dealTarget && {
        key: 'fix_deal',
        label: `שנה את הדיל ל${label(dealTarget)}`,
        kind: 'link',
        target: { ...dealRef, query: { convert: dealTarget } },
      },
      { key: 'open_tour', label: 'פתח סיור', kind: 'link', target: { type: 'tour_event', id: d.tourEventId } },
    ].filter(Boolean);
  },

  // Self-resolving, never dismissible: the state is either still wrong or it is
  // not. An operator must not be able to acknowledge away a deal that is one
  // thing commercially and another operationally.
  async recheck(client, issue) {
    const booking = await client.booking.findFirst({
      where: { dealId: issue.data?.dealId, ...DETECT_WHERE },
      select: DETECT_SELECT,
    });
    if (!booking?.deal || !booking?.tourEvent) return false;
    return activityMismatch(booking.deal, booking.tourEvent);
  },
});
