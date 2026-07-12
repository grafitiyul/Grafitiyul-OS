import { registerIssueType } from '../registry.js';
import { registerDetector } from '../sweepWorker.js';
import { raiseIssue, resolveMissing } from '../issueService.js';
import { pendingTourUpdate } from '../../tours/tourFromDeal.js';

// Deal ↔ Tour out of sync — the בקרה side of the Pending Tour Update concept.
// After a private/business tour exists, the Deal's planning fields are the
// DESIRED state and the TourEvent is the APPLIED state; their DIFF is computed
// (never stored) by pendingTourUpdate(). When that diff is non-empty the deal
// was edited but the tour wasn't converged — guides/calendar/customer may be
// on stale details. This detector surfaces it; the actions reuse the EXISTING
// apply / discard orchestration (POST /:id/apply-tour-update, .../discard-...).

const TYPE = 'deal_tour_out_of_sync';
const LANG_HE = { he: 'עברית', en: 'אנגלית', es: 'ספרדית', fr: 'צרפתית', ru: 'רוסית' };

const dedupeKey = (dealId) => `${TYPE}:${dealId}`;

function fmtDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

// Turn ONE raw diff ({ field, labelHe, dealValue, tourValue }) into a display
// row using the pre-fetched FK label maps.
function displayDiff(diff, maps) {
  const render = (field, value) => {
    if (value === null || value === undefined) return null;
    switch (field) {
      case 'tourDate':
        return fmtDate(value);
      case 'tourLanguage':
        return LANG_HE[value] || value;
      case 'productId':
        return maps.products.get(value) || 'מוצר';
      case 'productVariantId':
        return maps.variants.get(value) || 'וריאציה';
      case 'locationId':
        return maps.locations.get(value) || 'מיקום';
      default:
        return String(value);
    }
  };
  return {
    field: diff.field,
    labelHe: diff.labelHe,
    dealDisplay: render(diff.field, diff.dealValue),
    tourDisplay: render(diff.field, diff.tourValue),
  };
}

// Batch-resolve the FK display names referenced by all diffs — one query per
// entity type, no N+1.
async function buildLabelMaps(client, items) {
  const productIds = new Set();
  const variantIds = new Set();
  const locationIds = new Set();
  for (const { diffs } of items) {
    for (const d of diffs) {
      for (const v of [d.dealValue, d.tourValue]) {
        if (!v) continue;
        if (d.field === 'productId') productIds.add(v);
        else if (d.field === 'productVariantId') variantIds.add(v);
        else if (d.field === 'locationId') locationIds.add(v);
      }
    }
  }
  const [products, variants, locations] = await Promise.all([
    productIds.size
      ? client.product.findMany({ where: { id: { in: [...productIds] } }, select: { id: true, nameHe: true } })
      : [],
    variantIds.size
      ? client.productVariant.findMany({ where: { id: { in: [...variantIds] } }, select: { id: true, name: true } })
      : [],
    locationIds.size
      ? client.location.findMany({ where: { id: { in: [...locationIds] } }, select: { id: true, nameHe: true } })
      : [],
  ]);
  return {
    products: new Map(products.map((p) => [p.id, p.nameHe])),
    variants: new Map(variants.map((v) => [v.id, v.name])),
    locations: new Map(locations.map((l) => [l.id, l.nameHe])),
  };
}

function buildPayload(deal, tour, diffs, maps) {
  const title = deal.title || `דיל ${deal.orderNo ?? ''}`.trim();
  return {
    type: TYPE,
    severity: 'warning',
    sourceModule: 'deals',
    dedupeKey: dedupeKey(deal.id),
    title: `הדיל והסיור אינם מסונכרנים — ${title}`,
    explanation:
      `הדיל עודכן אך הסיור המקושר לא עודכן בהתאם (${diffs.length} שדות שונים). ` +
      'הסיור, היומן והמדריכים עלולים להציג פרטים ישנים. ' +
      'אפשר לעדכן את הסיור לפי הדיל, או לבטל את שינויי הדיל ולחזור לפרטי הסיור.',
    entityRefs: [
      { type: 'deal', id: deal.id, orderNo: deal.orderNo, label: title },
      { type: 'tour_event', id: tour.id, label: fmtDate(tour.date) || 'סיור' },
    ],
    data: {
      dealId: deal.id,
      dealOrderNo: deal.orderNo,
      tourEventId: tour.id,
      diffs: diffs.map((d) => displayDiff(d, maps)),
    },
  };
}

registerDetector({
  key: 'deal-tour-out-of-sync',
  async run(client) {
    // Active bookings on a private/business tour that is still live (scheduled
    // or postponed) — the only rows pendingTourUpdate can report on.
    const bookings = await client.booking.findMany({
      where: {
        status: 'active',
        tourEvent: { kind: { not: 'group_slot' }, status: { in: ['scheduled', 'postponed'] } },
      },
      include: { deal: true, tourEvent: true },
      take: 1000,
    });
    const items = [];
    for (const booking of bookings) {
      if (!booking.deal) continue;
      const diffs = pendingTourUpdate(booking.deal, booking);
      if (diffs.length) items.push({ deal: booking.deal, tour: booking.tourEvent, diffs });
    }
    const maps = await buildLabelMaps(client, items);
    const present = new Set();
    for (const { deal, tour, diffs } of items) {
      present.add(dedupeKey(deal.id));
      await raiseIssue(client, buildPayload(deal, tour, diffs, maps));
    }
    await resolveMissing(client, TYPE, present);
  },
});

// Re-derive the pending diff for ONE deal — reused by recheck (after an
// apply/discard action) so the card resolves the moment the drift is gone.
async function stillOutOfSync(client, dealId) {
  const [deal, booking] = await Promise.all([
    client.deal.findUnique({ where: { id: dealId } }),
    client.booking.findFirst({ where: { dealId, status: 'active' }, include: { tourEvent: true } }),
  ]);
  if (!deal || !booking) return false;
  return pendingTourUpdate(deal, booking).length > 0;
}

registerIssueType(TYPE, {
  sourceModule: 'deals',

  buildActions(issue) {
    return [
      { key: 'apply', label: 'עדכן סיור', kind: 'api', style: 'primary' },
      {
        key: 'discard',
        label: 'בטל שינויי דיל',
        kind: 'api',
        confirm: 'לבטל את שינויי הדיל ולהחזיר את פרטי הדיל למצב הסיור הנוכחי?',
      },
      {
        key: 'open_deal',
        label: 'פתח דיל',
        kind: 'link',
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

  async recheck(client, issue) {
    return stillOutOfSync(client, issue.data?.dealId);
  },
});
