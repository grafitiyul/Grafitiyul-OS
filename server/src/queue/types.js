// The canonical QueueItem — one shape for every outgoing message in GOS.
//
// ── Why aggregation and not a new queue ──────────────────────────────────────
// Four queues exist, each well built, each with its own idempotency contract,
// its own worker and its own retry semantics:
//
//   communication  CommunicationDelivery      (messageId, triggerKey, recipientKey)
//   wa_scheduled   WhatsAppScheduledMessage   gos-sched-<id>-<at>-a<n>
//   email          ScheduledEmail             gmailMessageId
//   admin_report   AdminReportDelivery        (reportNumber, idempotencyKey)
//
// Replacing them with one engine would be a rewrite of every send path in the
// system, for a UI benefit. So this module READS them and nothing else: no new
// table, no new worker, no second send path. Actions delegate to the endpoints
// that already own each row.
//
// The one real risk of aggregation is misreporting: four vocabularies flattened
// into one could easily lie about what is actually happening. So normalisation
// lives in the adapters, is unit-tested per source, and the raw source status
// travels alongside for the detail panel.

/** Normalised lifecycle. Deliberately small — the source status carries nuance. */
export const QUEUE_STATUS = {
  waiting: 'waiting',   // scheduled for later, or held (window / dependency / provider)
  sending: 'sending',   // claimed, in flight
  sent: 'sent',
  failed: 'failed',     // retryable OR terminal — `terminal` distinguishes
  skipped: 'skipped',   // deliberately not sent (config, no recipient, cancelled)
};

export const QUEUE_STATUS_LABELS_HE = {
  waiting: 'ממתין',
  sending: 'בשליחה',
  sent: 'נשלח',
  failed: 'נכשל',
  skipped: 'לא נשלח',
};

export const SOURCE_LABELS_HE = {
  communication: 'מרכז התקשורת',
  wa_scheduled: 'הודעה מתוזמנת',
  email: 'אימייל מתוזמן',
  admin_report: 'דיווחי מנהלים',
};

/**
 * Build one QueueItem. Every adapter goes through here, so a field can never be
 * present for one source and quietly missing for another.
 *
 *   scheduledAt  — when it was MEANT to go (never mutated)
 *   effectiveAt  — when it may actually go, if held
 *   waitReasonHe — why it has not gone yet, in the operator's language
 *   audienceKind — which sending-window policy governs it
 */
export function queueItem({
  source, sourceId, channel, status, sourceStatus,
  scheduledAt, effectiveAt = null, waitReasonHe = null, failureReasonHe = null,
  terminal = false,
  recipient = {}, sender = {}, audienceKind = null,
  preview = {}, origin = {},
  attemptCount = 0, sentAt = null, createdAt = null,
}) {
  return {
    source,
    sourceId,
    // Stable composite id for the client — the four sources have independent
    // id spaces and could collide.
    key: `${source}:${sourceId}`,
    channel,
    status,
    statusHe: QUEUE_STATUS_LABELS_HE[status] || status,
    sourceStatus,
    scheduledAt: scheduledAt || null,
    effectiveAt,
    waitReasonHe,
    failureReasonHe,
    terminal,
    recipient: {
      name: recipient.name || null,
      phone: recipient.phone || null,
      email: recipient.email || null,
      kindHe: recipient.kindHe || null,
    },
    sender: { accountId: sender.accountId || null, label: sender.label || null },
    audienceKind,
    preview: {
      subject: preview.subject || null,
      body: preview.body || '',
      attachments: preview.attachments || [],
    },
    origin: {
      moduleHe: SOURCE_LABELS_HE[source] || source,
      label: origin.label || null,
      link: origin.link || null,
    },
    attemptCount,
    sentAt,
    createdAt,
  };
}

/** Rows an operator still cares about — the "pending" tab. */
export const PENDING_STATUSES = [QUEUE_STATUS.waiting, QUEUE_STATUS.sending, QUEUE_STATUS.failed];
