// Source adapter: AdminReportDelivery (internal manager notifications).
//
// The frozen `renderedText` IS the preview — a report's text is decided at fire
// time and a retry re-sends exactly that, so what the queue shows is precisely
// what will go out.

import { prisma } from '../../db.js';
import { queueItem, QUEUE_STATUS } from '../types.js';
import { reportByNumber } from '../../adminReports/registry.js';
import { audienceKindFromReport } from '../../communication/sendingPolicy.js';

const STATUS_MAP = {
  pending: QUEUE_STATUS.waiting,
  sent: QUEUE_STATUS.sent,
  failed: QUEUE_STATUS.failed,
  failed_final: QUEUE_STATUS.failed,
  skipped: QUEUE_STATUS.skipped,
};

export const adminReportSource = {
  key: 'admin_report',
  // Reports are WhatsApp-only today; the email channel arrives with the manager
  // digest, and this adapter picks it up from the row's own channel then.
  channels: ['whatsapp', 'email'],

  async list({ channel, scope = 'pending', limit = 200, db = prisma } = {}) {
    const rows = await db.adminReportDelivery.findMany({
      where: scope === 'pending'
        ? { status: { in: ['pending', 'failed'] } }
        : { status: { in: ['sent', 'failed_final', 'skipped'] } },
      orderBy: scope === 'pending' ? { createdAt: 'asc' } : { updatedAt: 'desc' },
      take: limit,
    });

    return rows
      .map((r) => {
        const report = reportByNumber(r.reportNumber);
        const rowChannel = r.channel || 'whatsapp';
        if (rowChannel !== channel) return null;
        const audienceKind = audienceKindFromReport(report);
        return queueItem({
          source: 'admin_report',
          sourceId: r.id,
          channel: rowChannel,
          status: STATUS_MAP[r.status] || QUEUE_STATUS.waiting,
          sourceStatus: r.status,
          terminal: ['failed_final', 'skipped'].includes(r.status),
          scheduledAt: r.createdAt,
          effectiveAt: r.effectiveAt,
          waitReasonHe: r.waitReason || null,
          failureReasonHe: r.skipReason || r.lastError || null,
          recipient: {
            name: r.recipientName || r.destinationLabel || null,
            phone: r.recipientPhone || null,
            kindHe: audienceKind === 'guide' ? 'מדריך' : 'מנהלים',
          },
          sender: { accountId: r.waAccountId, label: r.destinationLabel || null },
          audienceKind,
          preview: { body: r.renderedText || '' },
          origin: {
            label: `דיווח #${r.reportNumber}${report ? ` · ${report.nameHe}` : ''}`,
            link: '/admin/settings/admin-reports',
          },
          attemptCount: r.attemptCount ?? 0,
          sentAt: r.sentAt,
          createdAt: r.createdAt,
        });
      })
      .filter(Boolean);
  },
};
