// Confirmation Email — THE send path. One service behind every caller:
// the operator route, the automatic WON hook and the tour-update resend.
// There is no second composer and no second queue path.
//
// Contract: compose (same pipeline the preview showed) → validate → freeze the
// Gmail account → in ONE transaction create the ScheduledEmail queue row + the
// immutable ConfirmationEmailSend snapshot (+ timeline for real sends). The
// queue owns delivery: retries, connection-deferral, sending windows, mirror.
//
// Returns { ok:true, sendId, scheduledEmailId, subject, sendKind } or
// { error, ... } — callers map errors to HTTP or to a log line. Never throws
// for business outcomes.

import { prisma as defaultPrisma } from '../db.js';
import { composeConfirmationEmail } from './composer.js';
import { countRealSends, buildSendSubject } from './sendHistory.js';
import { resolveSendAccount, cleanRecipientList } from '../email/composedSend.js';
import { emitTimelineEvent, userOrigin, systemOrigin } from '../timeline/events.js';

// Warnings an operator may knowingly send past (the preview shows them);
// anything else is a hard stop.
export const ACKNOWLEDGEABLE = new Set([
  'missing_content',
  'missing_policy',
  'no_tour',
  'missing_variable',
  'unknown_variable',
]);

// A second send for the same deal inside this window is a double-click, not a
// decision. Deliberate resends after it are allowed.
const DUPLICATE_WINDOW_MS = 10_000;

/**
 * @param {object} opts
 *  dealId, language?, overrideOverlay?, to?, subject? (operator edits),
 *  test?            — QA probe: no deal/thread linkage, no timeline, never
 *                     counts as a real send, never gets the repeat marker
 *  acknowledgeWarnings?
 *  allowNotWon?     — explicit override of the WON-workflow rule
 *  trigger?         — 'manual' | 'won_auto' | 'tour_update' | 'test' (audit)
 *  actorUserId?     — operator, when there is one
 *  languageOverridden?, contactLanguageUpdated? — audit flags from the preview
 */
export async function sendConfirmationEmail(opts = {}, { db = defaultPrisma } = {}) {
  const {
    dealId, language, overrideOverlay = null, to: toOverride, subject: subjectOverride,
    test: isTest = false, acknowledgeWarnings = false, allowNotWon = false,
    trigger = 'manual', actorUserId = null,
    languageOverridden = false, contactLanguageUpdated = false,
  } = opts;

  const composed = await composeConfirmationEmail(db, dealId, { language, overrideOverlay });
  if (composed.error) return { error: composed.error, meta: composed.meta || null };

  // Confirmation email is a WON workflow. A test goes to the operator, so it
  // is exempt; a real customer send needs WON or an explicit override.
  if (!isTest && !allowNotWon && composed.dealStatus !== 'won') {
    return { error: 'deal_not_won', status: composed.dealStatus };
  }

  const to = cleanRecipientList([
    { email: toOverride || composed.recipient?.email, name: isTest ? null : composed.recipient?.name },
  ]);
  if (!to.length) return { error: 'no_recipient_email' };

  const blocking = composed.warnings.filter((w) => ACKNOWLEDGEABLE.has(w.code));
  if (blocking.length && !acknowledgeWarnings) return { error: 'send_blocked', warnings: blocking };

  // First vs repeat is decided from immutable history, never from a flag the
  // caller passes — so a retry can't change what the subject says.
  const priorRealSends = isTest ? 0 : await countRealSends(db, composed.dealId);
  const baseSubject = String(subjectOverride ?? composed.subject ?? '').trim();
  const subject = buildSendSubject({
    subject: baseSubject, lang: composed.language, isTest, priorRealSends,
  });
  if (!subject) return { error: 'missing_subject' };

  const recent = await db.confirmationEmailSend.findFirst({
    where: { dealId: composed.dealId, createdAt: { gt: new Date(Date.now() - DUPLICATE_WINDOW_MS) } },
    select: { id: true },
  });
  if (recent) return { error: 'duplicate_send' };

  // ONE derivation: the composer already assembled + sanitized the exact body
  // the preview's final view displayed.
  const bodyHtml = composed.emailHtml;
  if (!bodyHtml) return { error: 'empty_body' };

  let account;
  try {
    account = await resolveSendAccount(null);
  } catch (e) {
    return { error: e.code || 'no_connected_account' };
  }

  const sendKind = isTest ? 'test' : priorRealSends > 0 ? 'repeat' : 'first';
  const origin = actorUserId ? await userOrigin(actorUserId) : systemOrigin();

  const { scheduled, snapshot } = await db.$transaction(async (tx) => {
    const scheduledRow = await tx.scheduledEmail.create({
      data: {
        accountId: account.id,
        toJson: to,
        subject,
        bodyHtml,
        dealId: isTest ? null : composed.dealId,
        contactId: isTest ? null : composed.recipient?.contactId || null,
        scheduledAt: new Date(),
        createdById: actorUserId || null,
      },
    });
    const snapshotRow = await tx.confirmationEmailSend.create({
      data: {
        dealId: composed.dealId,
        templateId: composed.template.id,
        templateName: composed.template.internalName,
        language: composed.language,
        recipientSnapshot: {
          ...to[0],
          contactId: isTest ? null : composed.recipient?.contactId || null,
          ...(isTest ? { test: true } : {}),
        },
        subject,
        bodyHtml,
        fillersSnapshot: composed.fillers,
        overridesSnapshot: overrideOverlay || null,
        imagesSnapshot: composed.sections
          .filter((s) => s.key === 'meeting_point_image' && s.data?.url)
          .map((s) => ({ role: 'meeting_point', url: s.data.url })),
        // Frozen "generated from" + the runtime story of THIS send.
        generationMeta: {
          templateName: composed.template.internalName,
          language: composed.language,
          blocks: composed.sections
            .filter((s) => s.kind === 'block')
            .map((s) => ({ id: s.id.replace(/^block:/, ''), internalName: s.title, type: s.type })),
          fillers: composed.fillers.map((f) => f.kind),
          sendKind, // first | repeat | test
          trigger, // manual | won_auto | tour_update | test
          languageOverridden: !!languageOverridden,
          contactLanguageUpdated: !!contactLanguageUpdated,
          ...(isTest ? { test: true } : {}),
        },
        scheduledEmailId: scheduledRow.id,
        createdById: actorUserId || null,
      },
    });
    if (!isTest) {
      await emitTimelineEvent(tx, {
        subjectId: composed.dealId,
        kind: 'communication',
        origin,
        data: {
          event: 'confirmation_email_queued',
          sendId: snapshotRow.id,
          channel: 'email',
          language: composed.language,
          recipientName: to[0].name || to[0].email,
          subject,
          sendKind,
          trigger,
          languageOverridden: !!languageOverridden,
          contactLanguageUpdated: !!contactLanguageUpdated,
          // Repeat sends must be distinguishable at a glance in the feed.
          eventName: sendKind === 'repeat' ? 'מייל אישור מעודכן' : 'מייל אישור',
          messageName: composed.template.internalName,
        },
      });
    }
    return { scheduled: scheduledRow, snapshot: snapshotRow };
  });

  return {
    ok: true, sendId: snapshot.id, scheduledEmailId: scheduled.id,
    subject, sendKind, language: composed.language,
  };
}
