import { registerIssueType } from '../registry.js';
import { registerDetector } from '../sweepWorker.js';
import { raiseIssue, resolveMissing } from '../issueService.js';
import { processReservationSession, MAX_ATTEMPTS } from '../../reservations/processor.js';

// Travel-agent reservation stuck — a submitted ReservationSession that is not
// fully processed within the grace window (inline attempt + sweep retries
// should normally land in seconds). Guarantees NO silent failure: the agent
// already saw "התקבל", so an unprocessed session is invisible everywhere else.
// Auto-resolves (resolveMissing) once the session reaches 'processed' or is
// cancelled. Severity escalates once retries are exhausted.

const TYPE = 'reservation_stuck';
const STUCK_AFTER_MS = 15 * 60 * 1000;
const dedupeKey = (sessionId) => `${TYPE}:${sessionId}`;

function buildPayload(session) {
  const agent = session.contact
    ? `${session.contact.firstNameHe || ''} ${session.contact.lastNameHe || ''}`.trim()
    : 'סוכן';
  const failedGroups = session.groups.filter((g) => g.status === 'failed');
  const pendingGroups = session.groups.filter((g) => !g.createdDealId);
  const exhausted = session.attemptCount >= MAX_ATTEMPTS;
  const reasons = [...new Set(failedGroups.map((g) => g.lastError).filter(Boolean))];
  return {
    type: TYPE,
    severity: exhausted ? 'critical' : 'warning',
    sourceModule: 'reservations',
    dedupeKey: dedupeKey(session.id),
    title: `בקשת הזמנה #${session.sessionNo} לא עובדה — ${agent}`,
    explanation:
      `הבקשה של ${agent} (${session.groups.length} קבוצות) התקבלה אך ${pendingGroups.length} קבוצות עדיין לא הפכו לדילים` +
      (reasons.length ? ` (סיבות: ${reasons.join(', ')})` : '') +
      (exhausted
        ? '. הניסיונות האוטומטיים מוצו — נדרש טיפול ידני ואז עיבוד מחדש.'
        : '. המערכת ממשיכה לנסות אוטומטית; ניתן גם לעבד מחדש עכשיו.'),
    entityRefs: [{ type: 'reservation', id: session.id, label: `בקשה #${session.sessionNo}` }],
    data: {
      sessionId: session.id,
      sessionNo: session.sessionNo,
      status: session.status,
      attemptCount: session.attemptCount,
      pendingGroups: pendingGroups.length,
      failedReasons: reasons,
      submittedAt: session.submittedAt,
    },
  };
}

registerDetector({
  key: 'reservation-stuck',
  async run(client) {
    const cutoff = new Date(Date.now() - STUCK_AFTER_MS);
    const sessions = await client.reservationSession.findMany({
      where: {
        status: { in: ['submitted', 'processing', 'partially_processed', 'failed'] },
        submittedAt: { lt: cutoff },
      },
      orderBy: { submittedAt: 'asc' },
      take: 200,
      select: {
        id: true,
        sessionNo: true,
        status: true,
        attemptCount: true,
        submittedAt: true,
        contact: { select: { firstNameHe: true, lastNameHe: true } },
        groups: { select: { status: true, createdDealId: true, lastError: true } },
      },
    });
    const present = new Set();
    for (const session of sessions) {
      present.add(dedupeKey(session.id));
      await raiseIssue(client, buildPayload(session));
    }
    await resolveMissing(client, TYPE, present);
  },
});

registerIssueType(TYPE, {
  sourceModule: 'reservations',
  buildActions(issue) {
    return [
      {
        key: 'reprocess',
        label: 'עבד מחדש',
        kind: 'server',
        style: 'primary',
      },
      {
        key: 'open_reservations',
        label: 'פתח הזמנות סוכנים',
        kind: 'link',
        target: { type: 'reservation', id: issue.data?.sessionId },
      },
    ];
  },
  serverActions: {
    // Reprocessing is the SAME processor call — inherently exactly-once, so a
    // double-click or a race with the sweep can never double-create deals.
    async reprocess(client, issue) {
      const r = await processReservationSession(issue.data?.sessionId, client);
      if (!r.claimed) {
        return { ok: false, status: 409, error: 'session_busy_or_done' };
      }
      if (r.status === 'processed') {
        return { ok: true, message: 'כל הקבוצות עובדו לדילים', resolve: { resolution: 'reprocessed' } };
      }
      return { ok: true, message: `עיבוד הסתיים: ${r.processed} הצליחו, ${r.failed} נכשלו` };
    },
  },
  async recheck(client, issue) {
    const session = await client.reservationSession.findUnique({
      where: { id: issue.data?.sessionId },
      select: { status: true },
    });
    if (!session) return false;
    return !['processed', 'cancelled'].includes(session.status);
  },
});
