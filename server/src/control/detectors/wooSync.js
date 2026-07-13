import { registerIssueType } from '../registry.js';
import { registerDetector } from '../sweepWorker.js';
import { raiseIssue, resolveMissing } from '../issueService.js';

// WooCommerce sync FAILURE — the בקרה side of the GOS→Woo mirror. A sellable
// TourEvent whose reconcile exhausted its retries (wooSyncStatus='failed') is
// surfaced here so an unresolved sync never sits silent: the website may be
// missing the occurrence or showing stale price/stock. The fix reuses the
// EXISTING controlled trigger (POST /woo/sync-one/:tourEventId) to requeue it.

const TYPE = 'woo_sync_failed';
const dedupeKey = (tourEventId) => `${TYPE}:${tourEventId}`;

function fmtDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(ymd || '');
}

function buildPayload(tour) {
  const when = `${fmtDate(tour.date)}${tour.startTime ? ' ' + tour.startTime : ''}`.trim();
  // The mapped Woo product(s) for this tour's failed links — surfaced, never a secret.
  const products = [...new Set((tour.wooVariationLinks || []).map((l) => l.wooProductId).filter(Boolean))];
  return {
    type: TYPE,
    severity: 'warning',
    sourceModule: 'tours',
    dedupeKey: dedupeKey(tour.id),
    title: `סנכרון WooCommerce נכשל — סיור ${when}`,
    explanation:
      'מועד סיור זמין למכירה לא הצליח להסתנכרן ל-WooCommerce לאחר מספר ניסיונות. ' +
      'ייתכן שהמועד חסר באתר או שהמחיר/המלאי מוצגים באופן שגוי. ' +
      'ניתן לנסות שוב את הסנכרון (מסמן את הסיור לסנכרון מבוקר) או לפתוח את הסיור.',
    entityRefs: [{ type: 'tour_event', id: tour.id, label: when }],
    data: {
      tourEventId: tour.id,
      date: tour.date,
      startTime: tour.startTime,
      wooProductIds: products,
      lastError: tour.wooSyncError || null,
    },
  };
}

registerDetector({
  key: 'woo-sync-failed',
  async run(client) {
    const tours = await client.tourEvent.findMany({
      where: { wooSyncStatus: 'failed' },
      select: {
        id: true,
        date: true,
        startTime: true,
        wooSyncError: true,
        wooVariationLinks: { select: { wooProductId: true } },
      },
      take: 1000,
    });
    const present = new Set();
    for (const tour of tours) {
      present.add(dedupeKey(tour.id));
      await raiseIssue(client, buildPayload(tour));
    }
    await resolveMissing(client, TYPE, present);
  },
});

registerIssueType(TYPE, {
  sourceModule: 'tours',

  buildActions(issue) {
    const id = issue.data?.tourEventId;
    return [
      // Reuse the controlled single-occurrence trigger — never a bulk sweep.
      // The client handler (issueActions.js) POSTs /woo/sync-one/:id.
      { key: 'retry', label: 'נסה סנכרון שוב', kind: 'api', style: 'primary' },
      { key: 'open_tour', label: 'פתח סיור', kind: 'link', target: { type: 'tour_event', id } },
    ];
  },

  async recheck(client, issue) {
    const tour = await client.tourEvent.findUnique({
      where: { id: issue.data?.tourEventId },
      select: { wooSyncStatus: true },
    });
    // Still an issue only while it remains 'failed'.
    return tour?.wooSyncStatus === 'failed';
  },
});
