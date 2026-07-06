import crypto from 'node:crypto';
import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import {
  emailIntegrationConfigured,
  missingEmailConfig,
  buildAuthUrl,
  exchangeCode,
  decodeIdToken,
  mintOAuthState,
  verifyOAuthState,
  gmail,
} from '../email/googleClient.js';
import { encryptToken } from '../email/tokenCrypto.js';
import { buildRawMessage, htmlToText, normalizeEmail, normalizeSubject } from '../email/mime.js';
import { sanitizeEmailHtml } from '../email/sanitize.js';
import { ingestGmailMessage } from '../email/ingest.js';
import { syncAccount } from '../email/syncWorker.js';
import { dealsForContact, classifyDealsForContact } from '../crm/dealResolution.js';
import { resolvePublicOrigin } from '../dealPayment.js';
import { isConfigured as r2Configured, buildKey, putObject, presignGet, bucket } from '../r2.js';

// Email module — Gmail integration (admin router, cookie-gated at mount).
//
// Safety posture for the Make/Pipedrive transition period: the OAuth scopes are
// gmail.readonly + gmail.send only. GOS can mirror and send — it CANNOT
// archive, label, delete or mark-read in the mailbox, by construction.
// Read/unread inside GOS is GOS-side state on EmailThread.

const router = Router();

const CONTACT_LITE_SELECT = {
  id: true,
  firstNameHe: true,
  lastNameHe: true,
  firstNameEn: true,
  lastNameEn: true,
};

function contactDisplayName(c) {
  if (!c) return null;
  const he = `${c.firstNameHe || ''} ${c.lastNameHe || ''}`.trim();
  return he || `${c.firstNameEn || ''} ${c.lastNameEn || ''}`.trim() || null;
}

const ACCOUNT_SAFE_SELECT = {
  id: true,
  provider: true,
  emailAddress: true,
  displayName: true,
  syncStatus: true,
  syncError: true,
  lastSyncAt: true,
  backfillDone: true,
  isActive: true,
  createdAt: true,
};

const DEAL_LITE_SELECT = {
  id: true,
  title: true,
  status: true,
  tourDate: true,
  valueMinor: true,
  dealStage: { select: { id: true, label: true } },
  organization: { select: { id: true, name: true } },
};

function toClientThread(t) {
  return {
    id: t.id,
    accountId: t.accountId,
    subject: t.subject,
    snippet: t.snippet,
    participants: t.participants || [],
    lastMessageAt: t.lastMessageAt,
    messageCount: t.messageCount,
    unreadCount: t.unreadCount,
    pinnedAt: t.pinnedAt,
    contactId: t.contactId,
    matchSource: t.matchSource,
    contactName: contactDisplayName(t.contact),
    linkedDealId: t.linkedDealId,
    linkSource: t.linkSource,
    linkedDeal: t.linkedDeal
      ? {
          id: t.linkedDeal.id,
          title: t.linkedDeal.title,
          status: t.linkedDeal.status,
          tourDate: t.linkedDeal.tourDate,
          valueMinor: t.linkedDeal.valueMinor,
          stageName: t.linkedDeal.dealStage?.label ?? null,
          organizationName: t.linkedDeal.organization?.name ?? null,
        }
      : null,
  };
}

const THREAD_INCLUDE = {
  contact: { select: CONTACT_LITE_SELECT },
  linkedDeal: { select: DEAL_LITE_SELECT },
};

// ── Accounts & OAuth ─────────────────────────────────────────────────────────

router.get(
  '/accounts',
  handle(async (_req, res) => {
    const accounts = await prisma.emailAccount.findMany({
      orderBy: { createdAt: 'asc' },
      select: { ...ACCOUNT_SAFE_SELECT, refreshTokenEnc: true },
    });
    res.json({
      configured: emailIntegrationConfigured(),
      missing: missingEmailConfig(),
      accounts: accounts.map(({ refreshTokenEnc, ...a }) => ({
        ...a,
        connected: !!refreshTokenEnc,
      })),
    });
  }),
);

function callbackRedirectUri(req) {
  return `${resolvePublicOrigin(req)}/api/email/connect/callback`;
}

router.get(
  '/connect/start',
  handle(async (req, res) => {
    if (!emailIntegrationConfigured()) {
      return res.status(503).json({ error: 'email_not_configured', missing: missingEmailConfig() });
    }
    const url = buildAuthUrl({ redirectUri: callbackRedirectUri(req), state: mintOAuthState() });
    res.json({ url });
  }),
);

// Google redirects the admin's browser here (session cookie rides along —
// SameSite=Lax allows top-level GET navigations). Errors redirect back into the
// app with a reason instead of dead-ending on JSON.
router.get(
  '/connect/callback',
  handle(async (req, res) => {
    const fail = (reason) => res.redirect(`/admin/email?connect_error=${encodeURIComponent(reason)}`);
    if (!emailIntegrationConfigured()) return fail('not_configured');
    if (req.query.error) return fail(String(req.query.error));
    if (!verifyOAuthState(req.query.state)) return fail('bad_state');
    const code = String(req.query.code || '');
    if (!code) return fail('missing_code');

    let tokens;
    try {
      tokens = await exchangeCode({ code, redirectUri: callbackRedirectUri(req) });
    } catch (e) {
      console.error('[email] code exchange failed:', e?.message);
      return fail('exchange_failed');
    }
    const claims = decodeIdToken(tokens.id_token) || {};
    const emailAddress = normalizeEmail(claims.email);
    if (!emailAddress) return fail('no_email_claim');

    const data = {
      provider: 'gmail',
      displayName: claims.name || null,
      googleAccountId: claims.sub || null,
      accessTokenEnc: encryptToken(tokens.access_token),
      accessTokenExpiresAt: new Date(Date.now() + (Number(tokens.expires_in) || 3600) * 1000),
      // prompt=consent guarantees a refresh_token on every connect; keep the
      // existing one if Google ever omits it anyway.
      ...(tokens.refresh_token ? { refreshTokenEnc: encryptToken(tokens.refresh_token) } : {}),
      scopes: tokens.scope || null,
      isActive: true,
      syncStatus: 'idle',
      syncError: null,
      connectedById: req.adminAuth?.userId || null,
    };
    const account = await prisma.emailAccount.upsert({
      where: { emailAddress },
      create: { emailAddress, ...data },
      update: data,
    });

    // Kick the first sync in the background — the UI polls account status.
    syncAccount(account.id).catch((e) => console.error('[email] initial sync failed:', e?.message));
    res.redirect(`/admin/email?connected=${encodeURIComponent(emailAddress)}`);
  }),
);

router.post(
  '/accounts/:id/sync',
  handle(async (req, res) => {
    const account = await prisma.emailAccount.findUnique({ where: { id: req.params.id } });
    if (!account) return res.status(404).json({ error: 'not_found' });
    if (!account.refreshTokenEnc) return res.status(400).json({ error: 'not_connected' });
    try {
      const result = await syncAccount(account);
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(502).json({ error: 'sync_failed', detail: (e?.message || '').slice(0, 300) });
    }
  }),
);

router.put(
  '/accounts/:id',
  handle(async (req, res) => {
    const account = await prisma.emailAccount.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!account) return res.status(404).json({ error: 'not_found' });
    const data = {};
    if (req.body?.isActive !== undefined) data.isActive = !!req.body.isActive;
    const updated = await prisma.emailAccount.update({
      where: { id: account.id },
      data,
      select: ACCOUNT_SAFE_SELECT,
    });
    res.json(updated);
  }),
);

// Disconnect = drop tokens (mirrored threads/messages stay — they are CRM
// history). Reconnecting the same address resumes into the same account row.
router.post(
  '/accounts/:id/disconnect',
  handle(async (req, res) => {
    const account = await prisma.emailAccount.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!account) return res.status(404).json({ error: 'not_found' });
    const updated = await prisma.emailAccount.update({
      where: { id: account.id },
      data: {
        accessTokenEnc: null,
        accessTokenExpiresAt: null,
        refreshTokenEnc: null,
        isActive: false,
        syncStatus: 'disconnected',
      },
      select: ACCOUNT_SAFE_SELECT,
    });
    res.json(updated);
  }),
);

// ── Inbox ────────────────────────────────────────────────────────────────────

// GET /inbox?accountId=&filter=all|unread|unmatched|deal|nodeal|today&q=
router.get(
  '/inbox',
  handle(async (req, res) => {
    const accountId = req.query.accountId ? String(req.query.accountId) : null;
    const filter = String(req.query.filter || 'all');
    const q = String(req.query.q || '').trim();

    const where = { ...(accountId ? { accountId } : {}) };
    if (filter === 'unread') where.unreadCount = { gt: 0 };
    else if (filter === 'unmatched') where.contactId = null;
    else if (filter === 'deal') where.linkedDealId = { not: null };
    else if (filter === 'nodeal') where.linkedDealId = null;
    else if (filter === 'today') {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      where.lastMessageAt = { gte: start };
    }
    if (q) {
      where.OR = [
        { subject: { contains: q, mode: 'insensitive' } },
        { snippet: { contains: q, mode: 'insensitive' } },
        {
          messages: {
            some: {
              OR: [
                { fromEmail: { contains: q, mode: 'insensitive' } },
                { fromName: { contains: q, mode: 'insensitive' } },
                { subject: { contains: q, mode: 'insensitive' } },
              ],
            },
          },
        },
      ];
    }

    const threads = await prisma.emailThread.findMany({
      where,
      include: THREAD_INCLUDE,
      orderBy: [{ pinnedAt: { sort: 'desc', nulls: 'last' } }, { lastMessageAt: 'desc' }],
      take: 200,
    });
    const unreadTotal = await prisma.emailThread.count({
      where: { ...(accountId ? { accountId } : {}), unreadCount: { gt: 0 } },
    });
    res.json({ threads: threads.map(toClientThread), unreadTotal });
  }),
);

// Threads linked to a Deal / matched to a Contact (Deal email tab, Contact card).
router.get(
  '/by-deal/:dealId',
  handle(async (req, res) => {
    const threads = await prisma.emailThread.findMany({
      where: { linkedDealId: req.params.dealId },
      include: THREAD_INCLUDE,
      orderBy: { lastMessageAt: 'desc' },
    });
    res.json(threads.map(toClientThread));
  }),
);

router.get(
  '/by-contact/:contactId',
  handle(async (req, res) => {
    const threads = await prisma.emailThread.findMany({
      where: { contactId: req.params.contactId },
      include: THREAD_INCLUDE,
      orderBy: { lastMessageAt: 'desc' },
    });
    res.json(threads.map(toClientThread));
  }),
);

// ── Thread detail & actions ──────────────────────────────────────────────────

router.get(
  '/threads/:id',
  handle(async (req, res) => {
    const thread = await prisma.emailThread.findUnique({
      where: { id: req.params.id },
      include: THREAD_INCLUDE,
    });
    if (!thread) return res.status(404).json({ error: 'not_found' });
    const messages = await prisma.emailMessage.findMany({
      where: { threadId: thread.id },
      orderBy: { sentAt: 'asc' },
      include: {
        attachments: true,
        engagement: { select: { openCount: true, firstOpenedAt: true, lastOpenedAt: true } },
      },
    });
    res.json({ thread: toClientThread(thread), messages });
  }),
);

// GOS-side read marker ONLY — Gmail is never touched.
router.post(
  '/threads/:id/read',
  handle(async (req, res) => {
    const thread = await prisma.emailThread.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!thread) return res.status(404).json({ error: 'not_found' });
    const updated = await prisma.emailThread.update({
      where: { id: thread.id },
      data: { unreadCount: 0, lastReadAt: new Date() },
      include: THREAD_INCLUDE,
    });
    res.json(toClientThread(updated));
  }),
);

router.put(
  '/threads/:id/pin',
  handle(async (req, res) => {
    const thread = await prisma.emailThread.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!thread) return res.status(404).json({ error: 'not_found' });
    const updated = await prisma.emailThread.update({
      where: { id: thread.id },
      data: { pinnedAt: req.body?.pinned ? new Date() : null },
      include: THREAD_INCLUDE,
    });
    res.json(toClientThread(updated));
  }),
);

// Manual contact link / unlink (reversible; the Contact itself is never
// created or modified here — same rule as WhatsApp).
router.put(
  '/threads/:id/link-contact',
  handle(async (req, res) => {
    const thread = await prisma.emailThread.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!thread) return res.status(404).json({ error: 'not_found' });
    const contactId = req.body?.contactId ?? null;
    if (contactId !== null) {
      const contact = await prisma.contact.findUnique({ where: { id: String(contactId) }, select: { id: true } });
      if (!contact) return res.status(400).json({ error: 'contact_not_found' });
    }
    const updated = await prisma.emailThread.update({
      where: { id: thread.id },
      data: contactId
        ? { contactId: String(contactId), matchSource: 'manual' }
        : { contactId: null, matchSource: null, linkedDealId: null, linkSource: null },
      include: THREAD_INCLUDE,
    });
    res.json(toClientThread(updated));
  }),
);

router.put(
  '/threads/:id/link-deal',
  handle(async (req, res) => {
    const thread = await prisma.emailThread.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!thread) return res.status(404).json({ error: 'not_found' });
    const dealId = req.body?.dealId ?? null;
    if (dealId !== null) {
      const deal = await prisma.deal.findUnique({ where: { id: String(dealId) }, select: { id: true } });
      if (!deal) return res.status(400).json({ error: 'deal_not_found' });
    }
    const updated = await prisma.emailThread.update({
      where: { id: thread.id },
      data: dealId
        ? { linkedDealId: String(dealId), linkSource: 'manual' }
        : { linkedDealId: null, linkSource: null },
      include: THREAD_INCLUDE,
    });
    res.json(toClientThread(updated));
  }),
);

// Which Deal does this thread belong to? Same classification as WhatsApp
// (shared crm/dealResolution.js). An explicit link always wins.
router.get(
  '/threads/:id/deal-resolution',
  handle(async (req, res) => {
    const thread = await prisma.emailThread.findUnique({
      where: { id: req.params.id },
      include: { contact: { select: CONTACT_LITE_SELECT } },
    });
    if (!thread) return res.status(404).json({ error: 'not_found' });
    res.set('Cache-Control', 'no-store');
    if (thread.linkedDealId) return res.json({ kind: 'open', dealId: thread.linkedDealId });
    if (!thread.contactId) {
      const first = (thread.participants || [])[0] || null;
      return res.json({
        kind: 'no_contact',
        suggestedName: first?.name || first?.email || null,
        suggestedEmail: first?.email || null,
      });
    }
    const contactName = contactDisplayName(thread.contact);
    const deals = await dealsForContact(thread.contactId);
    const outcome = classifyDealsForContact(deals);
    if (outcome.kind === 'open') return res.json({ kind: 'open', dealId: outcome.dealId });
    return res.json({ ...outcome, contactName });
  }),
);

// Create the Contact (when missing) and/or a fresh Deal from a thread — only
// ever called after the user confirmed in the UI (no auto-creation rule).
// Port of the WhatsApp open-deal flow with email instead of phone.
router.post(
  '/threads/:id/open-deal',
  handle(async (req, res) => {
    const thread = await prisma.emailThread.findUnique({
      where: { id: req.params.id },
      include: { contact: { select: CONTACT_LITE_SELECT } },
    });
    if (!thread) return res.status(404).json({ error: 'not_found' });

    const b = req.body || {};
    const s = (v) => (typeof v === 'string' ? v.trim() : '');
    let contactId = thread.contactId;
    let displayName = contactDisplayName(thread.contact);
    if (!contactId) {
      const first = (thread.participants || [])[0] || null;
      let firstNameHe = s(b.firstNameHe);
      let lastNameHe = s(b.lastNameHe);
      const firstNameEn = s(b.firstNameEn);
      const lastNameEn = s(b.lastNameEn);
      if (!firstNameHe && !firstNameEn) {
        const rawName = (first?.name || '').trim();
        const [firstWord, ...rest] = rawName.split(/\s+/).filter(Boolean);
        firstNameHe = firstWord || first?.email || 'אימייל';
        lastNameHe = rest.join(' ');
      }
      const email = normalizeEmail(s(b.email) || first?.email || '');
      const communicationLanguage = ['he', 'en'].includes(b.communicationLanguage)
        ? b.communicationLanguage
        : null;
      const contact = await prisma.contact.create({
        data: {
          firstNameHe,
          lastNameHe,
          firstNameEn,
          lastNameEn,
          communicationLanguage,
          ...(email ? { emails: { create: { value: email, isPrimary: true, label: 'אימייל' } } } : {}),
        },
        select: CONTACT_LITE_SELECT,
      });
      contactId = contact.id;
      displayName = contactDisplayName(contact);
      await prisma.emailThread.update({
        where: { id: thread.id },
        data: { contactId, matchSource: 'manual' },
      });
    }

    const firstStage = await prisma.dealStage.findFirst({
      orderBy: { sortOrder: 'asc' },
      select: { id: true },
    });
    if (!firstStage) return res.status(400).json({ error: 'no_stages' });
    const deal = await prisma.deal.create({
      data: {
        title: s(b.title) || displayName || thread.subject || 'שיחת אימייל',
        dealStageId: firstStage.id,
        status: 'open',
        contacts: { create: { contactId, isPrimary: true } },
      },
      select: { id: true },
    });
    await prisma.emailThread.update({
      where: { id: thread.id },
      data: { linkedDealId: deal.id, linkSource: 'manual' },
    });
    res.status(201).json({ dealId: deal.id, contactId });
  }),
);

// ── Send ─────────────────────────────────────────────────────────────────────

const MAX_ATTACHMENT_TOTAL = 16 * 1024 * 1024; // matches the app-wide JSON limit

function cleanRecipientList(input) {
  const out = [];
  for (const item of Array.isArray(input) ? input : []) {
    const email = normalizeEmail(typeof item === 'string' ? item : item?.email);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    out.push({ email, name: (typeof item === 'object' && item?.name) || null });
  }
  return out;
}

// POST /send — new email or reply. { accountId?, to[], cc?, bcc?, subject,
// bodyHtml, replyToMessageId?, dealId?, contactId?, attachments?[] }.
// The sent message is mirrored immediately (Gmail gives it back to us), an
// engagement row is created, and the thread is linked to the given deal/contact.
router.post(
  '/send',
  handle(async (req, res) => {
    if (!emailIntegrationConfigured()) {
      return res.status(503).json({ error: 'email_not_configured', missing: missingEmailConfig() });
    }
    const b = req.body || {};
    const account = b.accountId
      ? await prisma.emailAccount.findUnique({ where: { id: String(b.accountId) } })
      : await prisma.emailAccount.findFirst({
          where: { isActive: true, refreshTokenEnc: { not: null } },
          orderBy: { createdAt: 'asc' },
        });
    if (!account || !account.refreshTokenEnc || !account.isActive) {
      return res.status(400).json({ error: 'no_connected_account' });
    }

    const to = cleanRecipientList(b.to);
    const cc = cleanRecipientList(b.cc);
    const bcc = cleanRecipientList(b.bcc);
    if (!to.length) return res.status(400).json({ error: 'recipient_required' });

    // Reply context: inherit the Gmail thread + RFC 822 threading headers.
    let gmailThreadId = null;
    let inReplyTo = null;
    let references = null;
    let subject = String(b.subject || '').trim();
    if (b.replyToMessageId) {
      const orig = await prisma.emailMessage.findUnique({
        where: { id: String(b.replyToMessageId) },
        include: { thread: { select: { gmailThreadId: true, accountId: true } } },
      });
      if (!orig) return res.status(400).json({ error: 'reply_source_not_found' });
      if (orig.thread.accountId !== account.id) return res.status(400).json({ error: 'reply_account_mismatch' });
      gmailThreadId = orig.thread.gmailThreadId;
      inReplyTo = orig.messageIdHeader || null;
      references = [orig.referencesHeader, orig.messageIdHeader].filter(Boolean).join(' ') || null;
      if (!subject) {
        const base = normalizeSubject(orig.subject || '');
        subject = base ? `Re: ${base}` : 'Re:';
      }
    }
    if (!subject) return res.status(400).json({ error: 'subject_required' });

    // Body: sanitize the HTML we send too (defence in depth — the composer is
    // trusted, but the stored mirror must obey the same rules as ingest).
    const bodyHtml = sanitizeEmailHtml(b.bodyHtml || null);
    const bodyText = String(b.bodyText || '').trim() || htmlToText(bodyHtml || '');
    if (!bodyHtml && !bodyText) return res.status(400).json({ error: 'body_required' });

    const attachments = [];
    let attachmentBytes = 0;
    for (const a of Array.isArray(b.attachments) ? b.attachments : []) {
      const filename = String(a?.filename || '').trim();
      const contentBase64 = String(a?.dataBase64 || '');
      if (!filename || !contentBase64) continue;
      attachmentBytes += Math.floor(contentBase64.length * 0.75);
      if (attachmentBytes > MAX_ATTACHMENT_TOTAL) {
        return res.status(400).json({ error: 'attachments_too_large' });
      }
      attachments.push({ filename, mimeType: a?.mimeType || null, contentBase64 });
    }

    // Open-tracking pixel (GOS-sent mail only). Public unauthenticated GET —
    // the tracking id is unguessable. Honest signal, not proof of reading.
    const trackingId = crypto.randomBytes(16).toString('base64url');
    const pixelUrl = `${resolvePublicOrigin(req)}/api/track/email-open/${trackingId}.gif`;
    const htmlOut = `${bodyHtml || `<p>${bodyText.replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`}<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none">`;

    const raw = buildRawMessage({
      from: { email: account.emailAddress, name: account.displayName },
      to,
      cc,
      bcc,
      subject,
      bodyHtml: htmlOut,
      bodyText,
      inReplyTo,
      references,
      attachments,
    });

    let sent;
    try {
      sent = await gmail.sendRaw(prisma, account, raw, gmailThreadId);
    } catch (e) {
      console.error('[email] send failed:', e?.message);
      return res.status(502).json({ error: 'send_failed', detail: (e?.message || '').slice(0, 300) });
    }

    // Mirror immediately (don't wait for the worker) + engagement row.
    let mirrored = null;
    try {
      const full = await gmail.getMessage(prisma, account, sent.id);
      mirrored = await ingestGmailMessage(account, full, {
        createdByUserId: req.adminAuth?.userId || null,
        trackingId,
      });
      if (mirrored?.message?.id) {
        await prisma.emailEngagement.upsert({
          where: { messageId: mirrored.message.id },
          create: { messageId: mirrored.message.id },
          update: {},
        });
      }
      // Explicit CRM context from the composer wins over auto-linking.
      if (mirrored?.threadId) {
        const patch = {};
        const t = await prisma.emailThread.findUnique({
          where: { id: mirrored.threadId },
          select: { contactId: true, linkedDealId: true },
        });
        if (b.dealId && !t.linkedDealId) {
          patch.linkedDealId = String(b.dealId);
          patch.linkSource = 'manual';
        }
        if (b.contactId && !t.contactId) {
          patch.contactId = String(b.contactId);
          patch.matchSource = 'manual';
        }
        if (Object.keys(patch).length) {
          await prisma.emailThread.update({ where: { id: mirrored.threadId }, data: patch });
        }
      }
    } catch (e) {
      // The send SUCCEEDED — never fail the request on mirror hiccups; the
      // sync worker will pick the message up within a minute.
      console.error('[email] sent but mirror failed (worker will catch up):', e?.message);
    }

    res.status(201).json({
      ok: true,
      gmailMessageId: sent.id,
      gmailThreadId: sent.threadId,
      threadId: mirrored?.threadId || null,
      messageId: mirrored?.message?.id || null,
    });
  }),
);

// ── Attachments (private — Gmail-fetch on demand, cached to R2) ──────────────

router.get(
  '/attachments/:id/download',
  handle(async (req, res) => {
    const att = await prisma.emailAttachment.findUnique({
      where: { id: req.params.id },
      include: { message: { select: { id: true, gmailMessageId: true, accountId: true } } },
    });
    if (!att) return res.status(404).json({ error: 'not_found' });
    if (!r2Configured()) return res.status(503).json({ error: 'r2_not_configured' });

    let key = att.r2Key;
    if (!key) {
      if (!att.gmailAttachmentId) return res.status(410).json({ error: 'attachment_unavailable' });
      const account = await prisma.emailAccount.findUnique({ where: { id: att.message.accountId } });
      if (!account?.refreshTokenEnc) return res.status(400).json({ error: 'not_connected' });
      let payload;
      try {
        payload = await gmail.getAttachment(prisma, account, att.message.gmailMessageId, att.gmailAttachmentId);
      } catch (e) {
        return res.status(502).json({ error: 'gmail_fetch_failed', detail: (e?.message || '').slice(0, 200) });
      }
      const body = Buffer.from(payload.data || '', 'base64url');
      key = buildKey(`email/${att.message.accountId}/${att.message.id}`, att.fileName);
      await putObject({ key, body, contentType: att.mimeType || 'application/octet-stream' });
      await prisma.emailAttachment.update({
        where: { id: att.id },
        data: { r2Key: key, bucket, sizeBytes: att.sizeBytes ?? body.length },
      });
    }
    const url = await presignGet({ key });
    res.json({ url, filename: att.fileName, mimeType: att.mimeType });
  }),
);

export default router;
