// Source adapter: ScheduledEmail (CRM scheduled email sends).

import { prisma } from '../../db.js';
import { queueItem, QUEUE_STATUS } from '../types.js';

const STATUS_MAP = {
  pending: QUEUE_STATUS.waiting,
  sending: QUEUE_STATUS.sending,
  sent: QUEUE_STATUS.sent,
  failed: QUEUE_STATUS.failed,
  cancelled: QUEUE_STATUS.skipped,
};

/** Recipients are stored as [{ email, name }] — show the first, count the rest. */
function primaryRecipient(toJson) {
  const list = Array.isArray(toJson) ? toJson : [];
  const first = list[0] || {};
  const extra = list.length > 1 ? ` (+${list.length - 1})` : '';
  return {
    name: first.name ? `${first.name}${extra}` : (first.email ? `${first.email}${extra}` : null),
    email: first.email || null,
  };
}

export const emailScheduledSource = {
  key: 'email',
  channels: ['email'],

  async list({ channel, scope = 'pending', limit = 200, db = prisma } = {}) {
    if (channel !== 'email') return [];
    const rows = await db.scheduledEmail.findMany({
      where: scope === 'pending'
        ? { status: { in: ['pending', 'sending', 'failed'] } }
        : { status: { in: ['sent', 'cancelled'] } },
      orderBy: scope === 'pending' ? { scheduledAt: 'asc' } : { updatedAt: 'desc' },
      take: limit,
      include: { account: { select: { id: true, emailAddress: true } } },
    });

    return rows.map((r) => {
      const to = primaryRecipient(r.toJson);
      return queueItem({
        source: 'email',
        sourceId: r.id,
        channel: 'email',
        status: STATUS_MAP[r.status] || QUEUE_STATUS.waiting,
        sourceStatus: r.status,
        terminal: r.status === 'cancelled',
        scheduledAt: r.scheduledAt,
        effectiveAt: r.effectiveAt,
        waitReasonHe: r.waitReason || null,
        failureReasonHe: r.failureReason || null,
        // A scheduled CRM email always addresses a customer.
        recipient: { name: to.name, email: to.email, kindHe: 'לקוח' },
        sender: { accountId: r.accountId, label: r.account?.emailAddress || null },
        audienceKind: 'customer',
        preview: {
          subject: r.subject || null,
          // The HTML body is the authored content; the text body is the
          // fallback. Neither is re-rendered here.
          body: r.bodyHtml || r.bodyText || '',
          attachments: Array.isArray(r.attachments)
            ? r.attachments.map((a) => ({ filename: a.filename, mimeType: a.mimeType }))
            : [],
        },
        origin: {
          label: r.dealId ? 'אימייל מדיל' : 'אימייל מתוזמן',
          link: r.dealId ? `/admin/crm/deals/${r.dealId}` : null,
        },
        attemptCount: r.attemptCount ?? 0,
        sentAt: r.sentAt,
        createdAt: r.createdAt,
      });
    });
  },
};
