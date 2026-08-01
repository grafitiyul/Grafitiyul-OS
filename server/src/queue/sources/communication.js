// Source adapter: CommunicationDelivery (the Communication Center).
//
// The richest of the four — it already had windows, dependency waits and a
// frozen rendered body, so most fields map directly. Its status vocabulary is
// the largest, which is why normalisation is explicit rather than clever.

import { prisma } from '../../db.js';
import { queueItem, QUEUE_STATUS, PENDING_STATUSES } from '../types.js';
import { audienceKindFromCommunication } from '../../communication/sendingPolicy.js';

const STATUS_MAP = {
  scheduled: QUEUE_STATUS.waiting,
  waiting_window: QUEUE_STATUS.waiting,
  waiting_dependency: QUEUE_STATUS.waiting,
  sending: QUEUE_STATUS.sending,
  sent: QUEUE_STATUS.sent,
  failed: QUEUE_STATUS.failed,
  failed_final: QUEUE_STATUS.failed,
  skipped: QUEUE_STATUS.skipped,
  cancelled: QUEUE_STATUS.skipped,
};

const AUDIENCE_HE = {
  customer: 'לקוח',
  guide: 'מדריך',
  manager: 'מנהלים',
};

export const communicationSource = {
  key: 'communication',
  channels: ['whatsapp', 'email'],

  async list({ channel, scope = 'pending', limit = 200, db = prisma } = {}) {
    const pendingSourceStatuses = ['scheduled', 'waiting_window', 'waiting_dependency', 'sending', 'failed'];
    const rows = await db.communicationDelivery.findMany({
      where: {
        channel,
        ...(scope === 'pending'
          ? { status: { in: pendingSourceStatuses } }
          : { status: { in: ['sent', 'failed_final', 'skipped', 'cancelled'] } }),
      },
      orderBy: scope === 'pending' ? { intendedAt: 'asc' } : { updatedAt: 'desc' },
      take: limit,
      include: {
        message: { select: { publicNumber: true, internalName: true, audienceType: true, waAccountId: true } },
        event: { select: { id: true, internalName: true } },
      },
    });

    return rows.map((r) => {
      const snap = r.recipientSnapshot || {};
      const rendered = r.renderedContent || {};
      const audienceKind = audienceKindFromCommunication(r.message?.audienceType);
      const status = STATUS_MAP[r.status] || QUEUE_STATUS.waiting;
      return queueItem({
        source: 'communication',
        sourceId: r.id,
        channel: r.channel,
        status,
        sourceStatus: r.status,
        terminal: ['failed_final', 'cancelled', 'skipped'].includes(r.status),
        scheduledAt: r.intendedAt,
        effectiveAt: r.effectiveAt,
        waitReasonHe: r.waitReason || null,
        failureReasonHe: r.skipReason || r.lastError || null,
        recipient: {
          name: snap.name,
          phone: snap.phone,
          email: snap.email,
          kindHe: AUDIENCE_HE[audienceKind],
        },
        sender: { accountId: snap.waAccountId || null, label: snap.groupSubject || null },
        audienceKind,
        // The frozen render when it exists (it is written at send time); before
        // that the queue honestly shows no body rather than re-rendering a
        // preview that might differ from what will actually go out.
        preview: {
          subject: rendered.subject || null,
          body: rendered.body || '',
          attachments: rendered.attachments || [],
        },
        origin: {
          label: `${r.event?.internalName || 'אירוע'} · מסר #${r.messageNumber}`,
          link: r.event?.id ? `/admin/settings/communication/events/${r.event.id}` : null,
        },
        attemptCount: r.attemptCount ?? 0,
        sentAt: r.sentAt,
        createdAt: r.createdAt,
      });
    });
  },
};

export { PENDING_STATUSES };
