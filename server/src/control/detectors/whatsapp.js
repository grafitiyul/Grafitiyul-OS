import { registerIssueType } from '../registry.js';
import { registerDetector } from '../sweepWorker.js';
import { raiseIssue, resolveMissing } from '../issueService.js';

// Skipped / failed scheduled WhatsApp messages — the בקרה side of the
// scheduled-send worker. A message the worker gave up on (window expired,
// number not found, retries exhausted) is a silent hole unless someone is
// told: this detector surfaces each one as an actionable issue. The ACTIONS
// reuse the existing scheduled-message endpoints (reschedule / cancel) plus a
// server-side "send now"; nothing here re-implements the send path.

const TYPE = 'whatsapp_scheduled_stuck';

// Terminal problem states of WhatsAppScheduledMessage the operator must decide
// on. 'pending'/'sending'/'sent'/'cancelled' are healthy or already handled.
const STUCK_STATUSES = ['skipped', 'failed'];

const dedupeKey = (id) => `${TYPE}:${id}`;

// Human failure summary — the worker's failureReason is a code or the Hebrew
// stale sentence; map the codes to friendly text, pass Hebrew through.
function reasonHe(status, reason) {
  if (status === 'skipped') {
    return reason && /[֐-׿]/.test(reason)
      ? reason
      : 'חלון השליחה פג — ההודעה לא נשלחה במועד.';
  }
  const MAP = {
    whatsapp_number_not_found: 'המספר לא קיים ב-WhatsApp.',
    invalid_payload: 'תוכן ההודעה נדחה על ידי השרת.',
  };
  return MAP[reason] || `השליחה נכשלה לאחר מספר נסיונות (${reason || 'לא ידוע'}).`;
}

// `deal` is passed IN, resolved via the batched taskId lookup in run() — it is
// deliberately NOT a relation on msg (see MSG_INCLUDE). null when the message
// has no linked task, or when that task/deal no longer exists.
function buildPayload(msg, deal) {
  const chatName =
    msg.chat?.savedContactName || msg.chat?.groupSubject || msg.chat?.pushName || msg.chat?.phoneNumber || 'צ׳אט';
  const preview = (msg.content || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const entityRefs = [];
  if (deal) entityRefs.push({ type: 'deal', id: deal.id, orderNo: deal.orderNo, label: deal.title });
  entityRefs.push({ type: 'whatsapp', id: msg.chatId, label: chatName });
  return {
    type: TYPE,
    severity: 'warning',
    sourceModule: 'whatsapp',
    dedupeKey: dedupeKey(msg.id),
    title: `הודעת WhatsApp מתוזמנת לא נשלחה — ${chatName}`,
    explanation:
      `${reasonHe(msg.status, msg.failureReason)}\n` +
      `ההודעה: “${preview}${preview.length >= 80 ? '…' : ''}”. ` +
      'אפשר לשלוח עכשיו, לקבוע מועד חדש, או לבטל לצמיתות.',
    entityRefs,
    data: {
      messageId: msg.id,
      chatId: msg.chatId,
      status: msg.status,
      failureReason: msg.failureReason || null,
      deal: deal ? { id: deal.id, orderNo: deal.orderNo, title: deal.title } : null,
    },
  };
}

// `chat` is a REAL relation, so it is included. `task` is NOT:
// WhatsAppScheduledMessage.taskId is a LOOSE key with no FK relation, on
// purpose — it keeps the sensitive scheduled-message table decoupled from CRM
// (same convention as createdById). Prisma rejects `include: { task: … }`
// outright at validation time, which silently killed this detector on every
// sweep. Resolve the task through its id instead; @@index([taskId]) exists for
// exactly that. Do NOT add a `task` key here.
export const MSG_INCLUDE = {
  chat: {
    select: {
      savedContactName: true,
      groupSubject: true,
      pushName: true,
      phoneNumber: true,
    },
  },
};

// taskId → deal | null, for the whole batch in ONE query (never one per row).
// Returns an empty map when no message carries a taskId, so the query is
// skipped entirely rather than issued with an empty IN list.
async function dealsByTaskId(client, rows) {
  const taskIds = [...new Set(rows.map((r) => r.taskId).filter(Boolean))];
  if (!taskIds.length) return new Map();
  const tasks = await client.task.findMany({
    where: { id: { in: taskIds } },
    select: { id: true, deal: { select: { id: true, orderNo: true, title: true } } },
  });
  return new Map(tasks.map((t) => [t.id, t.deal || null]));
}

// Exported for tests: the sweep worker only ever reaches this through
// registerDetector, and an untested run() is what let the broken include ship.
export async function runWhatsAppStuckDetector(client) {
  const rows = await client.whatsAppScheduledMessage.findMany({
    where: { status: { in: STUCK_STATUSES } },
    include: MSG_INCLUDE,
    take: 500,
  });
  const dealByTaskId = await dealsByTaskId(client, rows);
  const present = new Set();
  for (const msg of rows) {
    present.add(dedupeKey(msg.id));
    await raiseIssue(client, buildPayload(msg, dealByTaskId.get(msg.taskId) ?? null));
  }
  await resolveMissing(client, TYPE, present);
}

registerDetector({
  key: 'whatsapp-scheduled-stuck',
  run: runWhatsAppStuckDetector,
});

registerIssueType(TYPE, {
  sourceModule: 'whatsapp',

  buildActions(issue) {
    const deal = issue.data?.deal;
    const actions = [
      { key: 'send_now', label: 'שלח עכשיו', kind: 'server', style: 'primary' },
      { key: 'reschedule', label: 'קבע מועד חדש', kind: 'api' },
      {
        key: 'cancel',
        label: 'בטל לצמיתות',
        kind: 'api',
        style: 'danger',
        confirm: 'לבטל את ההודעה המתוזמנת לצמיתות?',
      },
    ];
    if (deal) {
      actions.push({
        key: 'open_deal',
        label: 'פתח דיל',
        kind: 'link',
        target: { type: 'deal', id: deal.id, orderNo: deal.orderNo },
      });
    } else {
      actions.push({
        key: 'open_whatsapp',
        label: 'פתח WhatsApp',
        kind: 'link',
        target: { type: 'whatsapp', id: issue.data?.chatId },
      });
    }
    return actions;
  },

  // Still an issue while the message sits in a stuck state.
  async recheck(client, issue) {
    const msg = await client.whatsAppScheduledMessage.findUnique({
      where: { id: issue.data?.messageId },
      select: { status: true },
    });
    if (!msg) return false;
    return STUCK_STATUSES.includes(msg.status);
  },

  serverActions: {
    // Re-arm the message to send on the next worker tick. Server-authoritative,
    // so it bypasses the client-facing +30s guard; the worker's idempotency
    // key + claim keep it safe.
    send_now: async (client, issue) => {
      const id = issue.data?.messageId;
      const updated = await client.whatsAppScheduledMessage.updateMany({
        where: { id, status: { in: STUCK_STATUSES } },
        data: {
          status: 'pending',
          scheduledAt: new Date(),
          attemptCount: 0,
          nextRetryAt: null,
          failureReason: null,
          claimedAt: null,
          claimedBy: null,
        },
      });
      if (updated.count === 0) return { ok: false, error: 'not_resendable' };
      return {
        ok: true,
        resolve: { resolution: 'send_now' },
        payload: { message: 'ההודעה נכנסה לתור לשליחה מיידית.' },
      };
    },
  },
});
