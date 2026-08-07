import { registerIssueType } from '../registry.js';
import { registerDetector } from '../sweepWorker.js';
import { raiseIssue, resolveMissing } from '../issueService.js';
import { dealBookerLabel } from '../../tours/customerDisplay.js';
import { ACTIVITY_TO_TOUR_KIND, ACTIVITY_TYPE_LABELS_HE } from '../../../../shared/dealActivity.mjs';

// A Deal whose activity type disagrees with the tour it is actually booked on.
//
// This is the backstop for the hole the conversion flow closes. Before the
// conversion service existed, `activityType` was a plain field on PUT /deals/:id
// with no guard: flipping a WON group deal to 'private' left the Booking active
// on the group slot and the TicketRegistration still consuming a seat, while the
// deal claimed to be something else entirely. Nothing noticed — pendingTourUpdate
// early-returns on a group slot (correctly: a slot's fields are slot-owned, not
// deal-owned), and wonGate only runs on a WON transition.
//
// The router now refuses that write with 409 conversion_required, and the
// conversion service is the one writer that may change activityType on an
// operational deal. This detector does not care WHO produced the state, only
// that it exists — so a future writer inventing a new way in is surfaced within
// one sweep instead of being discovered by a guide holding a roster that does
// not match the tour.
//
// Deliberately NOT auto-repaired. "Which one is right — the deal or the tour?"
// is a business question with money and customers attached, and answering it by
// machine is exactly how a customer silently loses their seat. The card routes
// the operator to the conversion flow, which asks that question properly.

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

// The mismatch predicate — pure, and the ONE definition. A deal with no
// activityType at all is NOT a mismatch: that is the post-payment assumption
// card's business (resolveActivityType), and raising here too would put two
// cards on one problem.
export function activityMismatch(deal, tour) {
  if (!deal?.activityType || !tour?.kind) return false;
  const expected = ACTIVITY_TO_TOUR_KIND[deal.activityType];
  if (!expected) return false;
  return expected !== tour.kind;
}

// HOW BADLY wrong — and the two cases really are different in kind, which the
// first production sweep proved: it found 9 real mismatches, 6 of them
// business-deal-on-a-private-tour (the legacy residue of the old
// "organization forces business" rule, which flipped the deal without ever
// touching the tour) and 3 of them group-deal-on-a-dedicated-tour.
//
//   group ↔ dedicated  — CRITICAL. Genuinely incoherent: the seat model,
//     capacity, Woo stock and the open-tour reports all read the tour, while
//     pricing and customer communication read the deal. They disagree about
//     what is being sold.
//
//   private ↔ business — WARNING. Nothing in the server branches on this
//     distinction: every operational branch is group_slot vs not. It is the
//     calendar summary line and the guide portal label. Exactly the reason the
//     conversion service updates `kind` in place instead of replacing the tour
//     — and exactly why raising six CRITICAL cards for it would teach the
//     office to ignore the detector that catches the real thing.
export function mismatchSeverity(deal, tour) {
  const involvesGroup = deal?.activityType === 'group' || tour?.kind === 'group_slot';
  return involvesGroup ? 'critical' : 'warning';
}

function buildPayload(deal, tour) {
  const customer = dealBookerLabel(deal) || 'לקוח';
  const when = [fmtDate(tour.date), tour.startTime].filter(Boolean).join(' ');
  const dealLabel = ACTIVITY_TYPE_LABELS_HE[deal.activityType] || deal.activityType;
  const tourLabel = KIND_LABEL_HE[tour.kind] || tour.kind;
  const severity = mismatchSeverity(deal, tour);
  const opening = `הדיל מסווג כפעילות ${dealLabel}, אך הוא משובץ ל${tourLabel}${when ? ` בתאריך ${when}` : ''}. `;
  return {
    type: TYPE,
    severity,
    sourceModule: 'deals',
    dedupeKey: dedupeKey(deal.id),
    title:
      severity === 'critical'
        ? `סוג הפעילות בדיל אינו תואם לסיור המשובץ — ${customer}`
        : `סיווג הסיור לא עודכן לפי הדיל — ${customer}`,
    explanation:
      severity === 'critical'
        ? opening
          + 'כלומר מבחינה מסחרית הדיל אומר דבר אחד ומבחינה תפעולית קורה דבר אחר: '
          + 'התמחור, מייל האישור, המסרים ללקוח והדוחות נגזרים מהסיווג שבדיל, '
          + 'בעוד שהמקומות, הקיבולת, המלאי בחנות והמדריכים נגזרים מהסיור בפועל. '
          + 'יש להכריע מה נכון ולבצע שינוי סוג פעילות מסודר מתוך הדיל.'
        : opening
          + 'ההבדל בין פרטי לעסקי הוא בתווית בלבד — המקומות, הקיבולת והתפעול זהים לגמרי, '
          + 'ולכן שום דבר לא שבור. מה שכן: ביומן ובאזור המדריכים הסיור עדיין מוצג בסיווג הישן. '
          + 'שינוי סוג פעילות מתוך הדיל מיישר את התווית באותו סיור עצמו, בלי לגעת בשום דבר אחר.',
    entityRefs: [
      { type: 'deal', id: deal.id, orderNo: deal.orderNo, label: customer },
      { type: 'tour_event', id: tour.id, label: when || 'סיור' },
    ],
    data: {
      dealId: deal.id,
      dealOrderNo: deal.orderNo,
      tourEventId: tour.id,
      dealActivityType: deal.activityType,
      tourKind: tour.kind,
      dealActivityLabelHe: dealLabel,
      tourKindLabelHe: tourLabel,
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
  tourEvent: { select: { id: true, kind: true, date: true, startTime: true } },
  deal: {
    select: {
      id: true, orderNo: true, activityType: true, title: true,
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
      await raiseIssue(client, buildPayload(b.deal, b.tourEvent));
    }
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
  fixHe: 'נסגר אוטומטית כשמבצעים שינוי סוג פעילות מסודר מתוך הדיל, או כשהדיל משובץ לסיור מהסוג הנכון.',
  sourceModule: 'deals',
  buildActions(issue) {
    return [
      {
        key: 'open_deal',
        label: 'פתח דיל לשינוי סוג פעילות',
        kind: 'link',
        style: 'primary',
        target: { type: 'deal', id: issue.data?.dealId, orderNo: issue.data?.dealOrderNo },
      },
      {
        key: 'open_tour',
        label: 'פתח סיור',
        kind: 'link',
        target: { type: 'tour_event', id: issue.data?.tourEventId },
      },
    ];
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
