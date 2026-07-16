import { registerIssueType } from '../registry.js';
import { registerDetector } from '../sweepWorker.js';
import { raiseIssue, resolveMissing } from '../issueService.js';

// Reservation link anomaly — an unusually high submission volume from ONE
// agent link in 24h. The in-process rate limiter throttles bursts; this
// detector is the durable backstop (survives restarts, sees distributed
// abuse) and puts a human in the loop: the fix is rotating/disabling the
// link from the Contact page, so the action is a link, not a mutation.
// Auto-resolves once the 24h window drains below the threshold.

const TYPE = 'reservation_link_abuse';
const WINDOW_MS = 24 * 60 * 60 * 1000;
const THRESHOLD = 20; // a real agent submits a handful of sessions a day, not 20+
const dedupeKey = (linkId) => `${TYPE}:${linkId}`;

registerDetector({
  key: 'reservation-link-abuse',
  async run(client) {
    const since = new Date(Date.now() - WINDOW_MS);
    const counts = await client.reservationSession.groupBy({
      by: ['linkId'],
      where: { submittedAt: { gte: since }, linkId: { not: null } },
      _count: { _all: true },
    });
    const hot = counts.filter((c) => c._count._all >= THRESHOLD);
    const present = new Set();
    for (const c of hot) {
      const link = await client.agentReservationLink.findUnique({
        where: { id: c.linkId },
        select: {
          id: true,
          contactId: true,
          contact: { select: { firstNameHe: true, lastNameHe: true } },
        },
      });
      if (!link) continue;
      const agent = `${link.contact?.firstNameHe || ''} ${link.contact?.lastNameHe || ''}`.trim() || 'סוכן';
      present.add(dedupeKey(link.id));
      await raiseIssue(client, {
        type: TYPE,
        severity: 'warning',
        sourceModule: 'reservations',
        dedupeKey: dedupeKey(link.id),
        title: `כמות חריגה של בקשות הזמנה — ${agent}`,
        explanation:
          `הקישור של ${agent} הגיש ${c._count._all} בקשות ב־24 השעות האחרונות (סף: ${THRESHOLD}). ` +
          'אם זו פעילות לגיטימית — סגרו את הפנייה; אם לא — השביתו או החליפו את הקישור מדף איש הקשר.',
        entityRefs: [{ type: 'contact', id: link.contactId, label: agent }],
        data: {
          linkId: link.id,
          contactId: link.contactId,
          agent,
          sessions24h: c._count._all,
          threshold: THRESHOLD,
        },
      });
    }
    await resolveMissing(client, TYPE, present);
  },
});

registerIssueType(TYPE, {
  sourceModule: 'reservations',
  buildActions(issue) {
    return [
      {
        key: 'open_contact',
        label: 'פתח איש קשר',
        kind: 'link',
        style: 'primary',
        target: { type: 'contact', id: issue.data?.contactId },
      },
      {
        key: 'open_reservations',
        label: 'פתח הזמנות סוכנים',
        kind: 'link',
        target: { type: 'reservation', id: issue.data?.linkId },
      },
    ];
  },
  async recheck(client, issue) {
    const since = new Date(Date.now() - WINDOW_MS);
    const n = await client.reservationSession.count({
      where: { linkId: issue.data?.linkId, submittedAt: { gte: since } },
    });
    return n >= (issue.data?.threshold || THRESHOLD);
  },
});
