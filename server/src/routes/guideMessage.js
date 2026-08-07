// "הודעה למדריך" — HTTP door for the office→guide WhatsApp message.
//
// Three read endpoints and one write. Nothing here contains business rules:
// recipients, rendering and queueing all live in tours/guideMessage.js, and the
// wording library is the ordinary WhatsAppTemplate catalog filtered to the
// 'guide' audience. This file translates them into HTTP and nothing else.
//
// The write endpoint reports the queue row's REAL state — queued / waiting for
// the guide sending window / failed — instead of a blanket "sent". A message
// held by a window is not a failure and must not read as one; a message that
// failed is not a success and must never read as one either.

import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { listSelectableAccounts } from '../whatsapp/senderAccount.js';
import {
  getGuideMessageSettings,
  setGuideSendAccount,
  resolveGuideComposerAccount,
  DEFAULT_GUIDE_SEND_ACCOUNT_ID,
  GuideSettingsError,
} from '../whatsapp/guideMessageSettings.js';
import { checkSendAllowed } from '../communication/sendingPolicy.js';
import {
  loadGuideMessageSubject,
  guideMessageContext,
  resolveGuideTemplate,
  fillRemainingTokens,
  queueGuideMessage,
  guideLanguage,
} from '../tours/guideMessage.js';

const router = Router();

const MAX_TEXT = 8_000;
// How long the send endpoint waits for the worker it just kicked before
// answering. The queue paces automated sends ~20s apart per account, so a
// definite "sent" is not always available inside an HTTP request — after this
// the honest answer is "in the queue", with the reason it is still there.
const SETTLE_WAIT_MS = 2_500;
const SETTLE_POLL_MS = 250;

const langOf = (v) => (v === 'en' ? 'en' : 'he');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The recipient row the request names, or an error code. */
function pickRecipient(subject, personRefId) {
  const id = String(personRefId || '').trim() || subject.defaultPersonRefId;
  if (!id) return { error: 'recipient_required' };
  const row = subject.recipients.find((r) => r.personRefId === id);
  if (!row) return { error: 'recipient_not_on_tour' };
  return { row };
}

async function loadSubjectOr404(req, res) {
  const subject = await loadGuideMessageSubject({
    tourEventId: String(req.query.tourEventId || req.body?.tourEventId || '').trim() || null,
    reviewItemId: String(req.query.reviewItemId || req.body?.reviewItemId || '').trim() || null,
  });
  if (subject.error) {
    res.status(subject.error === 'tour_required' ? 400 : 404).json({ error: subject.error });
    return null;
  }
  return subject;
}

// ── Flow settings ("הגדרות כלליות") ─────────────────────────────────────────
//
// One setting for the whole guide-message flow, not one per template. The
// customer new-lead reply keeps its own, separate account setting — these two
// flows never read each other.
router.get(
  '/settings',
  handle(async (_req, res) => {
    const accounts = await listSelectableAccounts(prisma);
    const row = await getGuideMessageSettings();
    res.set('Cache-Control', 'no-store');
    res.json({
      sendAccountId: row?.sendAccountId || null,
      effectiveSendAccountId: (row?.sendAccountId || '').trim() || DEFAULT_GUIDE_SEND_ACCOUNT_ID,
      flowDefaultAccountId: DEFAULT_GUIDE_SEND_ACCOUNT_ID,
      accounts,
      updatedAt: row?.updatedAt || null,
    });
  }),
);

router.put(
  '/settings',
  handle(async (req, res) => {
    const accounts = await listSelectableAccounts(prisma);
    try {
      const saved = await setGuideSendAccount(
        req.body?.sendAccountId,
        accounts.map((a) => a.id),
        { updatedById: req.adminAuth?.userId || null },
      );
      return res.json({
        sendAccountId: saved.sendAccountId,
        effectiveSendAccountId: saved.sendAccountId,
        flowDefaultAccountId: DEFAULT_GUIDE_SEND_ACCOUNT_ID,
        accounts,
        updatedAt: saved.updatedAt,
      });
    } catch (err) {
      if (err instanceof GuideSettingsError) return res.status(400).json({ error: err.code });
      throw err;
    }
  }),
);

// ── Who / from where / in which language ─────────────────────────────────────
router.get(
  '/subject',
  handle(async (req, res) => {
    const subject = await loadSubjectOr404(req, res);
    if (!subject) return undefined;

    const accounts = await listSelectableAccounts(prisma);
    // The FLOW's number — one setting for "how this office writes to guides",
    // not the operator's personal remembered sender and not a per-template
    // choice. The operator can still change it for a single message; that
    // never writes back here.
    const flowAccount = await resolveGuideComposerAccount(accounts);

    const def = subject.recipients.find((r) => r.personRefId === subject.defaultPersonRefId) || null;
    res.set('Cache-Control', 'no-store');
    return res.json({
      tour: subject.tour,
      dealId: subject.dealId,
      reviewItemId: subject.reviewItemId,
      recipients: subject.recipients.map((r) => ({
        personRefId: r.personRefId,
        name: r.name,
        role: r.role,
        isLead: r.isLead,
        submittedSummary: r.submittedSummary,
        phone: r.phone,
        language: r.language,
        state: r.state,
        canSend: r.canSend,
      })),
      defaultPersonRefId: subject.defaultPersonRefId,
      // The guide's own recorded language, Hebrew when nothing was recorded.
      defaultLanguage: def ? guideLanguage(def.person) : 'he',
      accounts,
      // The id to preselect. An unavailable configured number is reported as
      // such rather than swapped for another — the composer then makes the
      // operator choose instead of quietly sending from the wrong number.
      defaultAccountId: flowAccount.available ? flowAccount.accountId : null,
      accountSetting: flowAccount,
    });
  }),
);

// ── Render one template for this (tour × guide × language) ───────────────────
router.post(
  '/resolve',
  handle(async (req, res) => {
    const subject = await loadSubjectOr404(req, res);
    if (!subject) return undefined;
    const picked = pickRecipient(subject, req.body?.personRefId);
    if (picked.error) return res.status(400).json({ error: picked.error });

    const templateId = String(req.body?.templateId || '').trim();
    if (!templateId) return res.status(400).json({ error: 'template_required' });
    const template = await prisma.whatsAppTemplate.findUnique({ where: { id: templateId } });
    if (!template || template.audience !== 'guide') return res.status(404).json({ error: 'not_found' });

    const lang = langOf(req.body?.lang);
    const out = await resolveGuideTemplate({
      template,
      lang,
      tourEventId: subject.tour.id,
      dealId: subject.dealId,
      person: picked.row.person,
      nowMs: Date.now(),
    });
    // An empty language version is NEVER silently replaced by the other one.
    if (out.error) return res.status(409).json({ error: out.error });

    res.set('Cache-Control', 'no-store');
    return res.json({ templateId, language: lang, text: out.text, missingVariables: out.missing });
  }),
);

// ── Send ─────────────────────────────────────────────────────────────────────
router.post(
  '/send',
  handle(async (req, res) => {
    const idempotencyKey = String(req.body?.idempotencyKey || '').trim();
    if (idempotencyKey.length < 8 || idempotencyKey.length > 100) {
      return res.status(400).json({ error: 'idempotency_key_required' });
    }

    const subject = await loadSubjectOr404(req, res);
    if (!subject) return undefined;
    const picked = pickRecipient(subject, req.body?.personRefId);
    if (picked.error) return res.status(400).json({ error: picked.error });
    const recipient = picked.row;
    if (!recipient.canSend) return res.status(400).json({ error: recipient.state });

    const accountId = String(req.body?.accountId || '').trim();
    if (!accountId) return res.status(400).json({ error: 'account_required' });

    const lang = langOf(req.body?.lang);
    const raw = String(req.body?.text ?? '').slice(0, MAX_TEXT);
    if (!raw.trim()) return res.status(400).json({ error: 'content_required' });

    // Final resolution pass over the operator's own wording. Normally a no-op
    // (the draft came back already resolved); it exists so a hand-typed token
    // behaves like a variable instead of shipping as literal moustache.
    const ctx = await guideMessageContext({
      tourEventId: subject.tour.id,
      dealId: subject.dealId,
      person: recipient.person,
      nowMs: Date.now(),
    });
    const filled = fillRemainingTokens(raw, ctx, lang);
    if (filled.unknown.length) {
      return res.status(400).json({ error: 'unknown_tokens', tokens: filled.unknown });
    }

    const queued = await queueGuideMessage({
      idempotencyKey,
      accountId,
      person: recipient.person,
      phoneIntl: recipient.phoneIntl,
      text: filled.text,
      tourEventId: subject.tour.id,
      dealId: subject.dealId,
      reviewItemId: subject.reviewItemId,
      createdById: req.adminAuth?.userId || null,
    });
    if (queued.error) return res.status(400).json({ error: queued.error });

    // Wait briefly for the worker we just kicked, so the common case answers
    // with a real 'sent' rather than an unhelpful "queued".
    let row = queued.row;
    const deadline = Date.now() + SETTLE_WAIT_MS;
    while (row && row.status === 'pending' && Date.now() < deadline) {
      await sleep(SETTLE_POLL_MS);
      row = await prisma.whatsAppScheduledMessage.findUnique({ where: { id: row.id } });
    }

    // Why it is still pending, if it is: a closed guide sending window is a
    // WAIT with a known opening time, not a failure.
    let hold = null;
    if (row?.status === 'pending') {
      const gate = await checkSendAllowed({ audienceKind: 'guide', channel: 'whatsapp' });
      hold = gate.allowed
        ? { reason: null, nextAt: null }
        : { reason: gate.reason, nextAt: gate.nextAt ? new Date(gate.nextAt).toISOString() : null };
    }

    res.set('Cache-Control', 'no-store');
    return res.json({
      replay: queued.replay,
      scheduledMessageId: row?.id || null,
      // 'sent' | 'pending' | 'sending' | 'failed' | 'skipped' — the queue's own
      // word for what happened, never a claim this route invented.
      status: row?.status || 'pending',
      failureReason: row?.failureReason || null,
      waitReason: row?.waitReason || hold?.reason || null,
      effectiveAt: row?.effectiveAt || hold?.nextAt || null,
      recipientName: recipient.name,
      missingVariables: filled.missing,
    });
  }),
);

export default router;
