// Source adapter: WhatsAppScheduledMessage (CRM scheduled sends + staff bulk).
//
// This is the queue that used to silently delete work: rows more than 2h overdue
// became 'skipped'. Since the sending-window change a row held by a window keeps
// its `waitReason` and `effectiveAt`, which is exactly what this adapter
// surfaces — so "why has this not gone out?" is answerable on the screen.

import { prisma } from '../../db.js';
import { queueItem, QUEUE_STATUS } from '../types.js';
import { audienceKindFromScheduledMessage } from '../../communication/sendingPolicy.js';

const STATUS_MAP = {
  pending: QUEUE_STATUS.waiting,
  sending: QUEUE_STATUS.sending,
  sent: QUEUE_STATUS.sent,
  failed: QUEUE_STATUS.failed,
  cancelled: QUEUE_STATUS.skipped,
  skipped: QUEUE_STATUS.skipped,
};

export const whatsappScheduledSource = {
  key: 'wa_scheduled',
  channels: ['whatsapp'],

  async list({ channel, scope = 'pending', limit = 200, db = prisma } = {}) {
    if (channel !== 'whatsapp') return [];
    const rows = await db.whatsAppScheduledMessage.findMany({
      where: scope === 'pending'
        ? { status: { in: ['pending', 'sending', 'failed'] } }
        : { status: { in: ['sent', 'cancelled', 'skipped'] } },
      orderBy: scope === 'pending' ? { scheduledAt: 'asc' } : { updatedAt: 'desc' },
      take: limit,
      include: {
        chat: { select: { savedContactName: true, phoneNumber: true, groupSubject: true, type: true } },
        account: { select: { id: true, label: true } },
      },
    });

    return rows.map((r) => {
      const audienceKind = audienceKindFromScheduledMessage(r);
      const chatName = r.chat?.type === 'group'
        ? (r.chat.groupSubject || 'קבוצה')
        : (r.chat?.savedContactName || r.chat?.phoneNumber || null);
      return queueItem({
        source: 'wa_scheduled',
        sourceId: r.id,
        channel: 'whatsapp',
        status: STATUS_MAP[r.status] || QUEUE_STATUS.waiting,
        sourceStatus: r.status,
        terminal: ['cancelled', 'skipped'].includes(r.status),
        scheduledAt: r.scheduledAt,
        effectiveAt: r.effectiveAt,
        waitReasonHe: r.waitReason || null,
        timingHe: r.bypassSendingWindow ? 'עוקף חלון שליחה לפי הגדרת הדיווח' : null,
        failureReasonHe: r.failureReason || null,
        recipient: {
          name: chatName,
          phone: r.destinationPhone || r.chat?.phoneNumber || null,
          kindHe: audienceKind === 'guide' ? 'מדריך' : 'לקוח',
        },
        sender: { accountId: r.accountId, label: r.account?.label || null },
        audienceKind,
        preview: {
          body: r.content || '',
          attachments: Array.isArray(r.attachments) ? r.attachments : [],
        },
        origin: {
          label: r.batchId ? 'שליחה לצוות' : (r.taskId ? 'משימת CRM' : 'הודעה מתוזמנת'),
          link: null,
        },
        attemptCount: r.attemptCount ?? 0,
        sentAt: r.sentAt,
        createdAt: r.createdAt,
      });
    });
  },
};
