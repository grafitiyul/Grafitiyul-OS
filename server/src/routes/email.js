import { Router } from 'express';
import { prisma } from '../db.js';
import { fireCommunicationTrigger } from '../communication/engine.js';
import { handle } from '../asyncHandler.js';
import {
  emailIntegrationConfigured,
  missingEmailConfig,
  buildAuthUrl,
  exchangeCode,
  decodeIdToken,
  mintOAuthState,
  verifyOAuthState,
  accountHasModifyScope,
  isInvalidGrant,
  sanitizeAuthError,
  markAccountAuthError,
  buildConnectData,
  gmail,
} from '../email/googleClient.js';
import { runHealthCheck, describeScopes } from '../email/health.js';
import { adminDisplayName, ADMIN_NAME_SELECT } from '../admin/displayName.js';
import { Prisma } from '@prisma/client';
import { contactSearchWhere } from '../search/contactWhere.js';
import { phoneQuery } from '../search/phoneQuery.js';
import { recomputeThreadState } from '../email/providerState.js';
import { normalizeEmail } from '../email/mime.js';
import { sendComposedEmail, resolveSendAccount, validateComposition } from '../email/composedSend.js';
import { sanitizeEmailHtml } from '../email/sanitize.js';
import { syncAccount } from '../email/syncWorker.js';
import { dealsForContact, classifyDealsForContact } from '../crm/dealResolution.js';
import { resolvePublicOrigin } from '../dealPayment.js';
import { isConfigured as r2Configured, buildKey, putObject, presignGet, bucket } from '../r2.js';
import { registerDealOrderNoParam } from './dealParam.js';
import { ensureInitialCallTask } from '../tasks/autoTasks.js';

// Email module — Gmail integration (admin router, cookie-gated at mount).
//
// Safety posture for the Make/Pipedrive transition period: the OAuth scopes are
// gmail.readonly + gmail.send only. GOS can mirror and send — it CANNOT
// archive, label, delete or mark-read in the mailbox, by construction.
// Read/unread inside GOS is GOS-side state on EmailThread.

const router = Router();

// /by-deal/:dealId accepts orderNo OR cuid — the shared resolver.
registerDealOrderNoParam(router, 'dealId');

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
  signature: true,
  createdAt: true,
  healthState: true,
  lastRefreshAt: true,
  lastGmailCheckAt: true,
  lastCalendarCheckAt: true,
  lastAuthError: true,
  lastAuthErrorAt: true,
};

const DEAL_LITE_SELECT = {
  id: true,
  // The deal's OPERATOR-FACING identity (מספר הזמנה) — what a thread row shows
  // so "which job is this about" is answerable without opening the deal.
  orderNo: true,
  title: true,
  status: true,
  tourDate: true,
  valueMinor: true,
  dealStage: { select: { id: true, label: true } },
  organization: { select: { id: true, name: true } },
};

// The last live message's row-level facts. Absent when the include did not ask
// for messages (older callers) — every field then reads null/false, so no
// consumer has to special-case a thread whose messages were not fetched.
export function lastMessageFacts(t) {
  const m = Array.isArray(t.messages) ? t.messages[0] : null;
  if (!m) return { lastDirection: null, lastFrom: null, lastTo: [], sentFromGos: false };
  return {
    lastDirection: m.direction || null,
    lastFrom: m.fromName || m.fromEmail || null,
    lastTo: (m.toRecipients || []).map((r) => r?.name || r?.email).filter(Boolean),
    // Only an OUTBOUND message can have come from GOS; the flag says "this
    // conversation's latest message left through GOS", never "GOS owns it".
    sentFromGos: m.direction === 'outbound' && !!m.createdByUserId,
  };
}

export function toClientThread(t) {
  return {
    id: t.id,
    accountId: t.accountId,
    subject: t.subject,
    snippet: t.snippet,
    participants: t.participants || [],
    ...lastMessageFacts(t),
    hasAttachments: (t._count?.messages || 0) > 0,
    lastMessageAt: t.lastMessageAt,
    messageCount: t.messageCount,
    unreadCount: t.unreadCount,
    manualUnread: t.manualUnread,
    inInbox: t.inInbox,
    pinnedAt: t.pinnedAt,
    contactId: t.contactId,
    matchSource: t.matchSource,
    contactName: contactDisplayName(t.contact),
    linkedDealId: t.linkedDealId,
    linkSource: t.linkSource,
    linkedDeal: t.linkedDeal
      ? {
          id: t.linkedDeal.id,
          orderNo: t.linkedDeal.orderNo ?? null,
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
  // The row-level facts a thread LIST needs and a subject/snippet cannot give:
  // which way the last message went, who wrote it / who it went to, and whether
  // GOS is the one that sent it. One extra joined row per thread — the list is
  // already capped, so this stays a bounded read.
  messages: {
    where: { providerDeletedAt: null },
    orderBy: [{ sentAt: 'desc' }, { createdAt: 'desc' }],
    take: 1,
    select: {
      direction: true,
      fromName: true,
      fromEmail: true,
      toRecipients: true,
      // AdminUser.id when the message left through GOS — the ONE honest
      // provenance signal (Gmail SENT alone cannot tell GOS from the Gmail UI).
      createdByUserId: true,
    },
  },
  // "Is anything attached anywhere in this conversation" — a filtered relation
  // count, so the answer covers the whole thread without loading its messages.
  _count: { select: { messages: { where: { hasAttachments: true, providerDeletedAt: null } } } },
};

// ── Canonical unread membership ──────────────────────────────────────────────
// ONE definition of "this thread is unread", shared by: the unread view's
// query, the unread-first sectioning of every other view, and the badge count.
// A thread is unread when Gmail still labels one of its live inbox messages
// UNREAD (unreadCount, derived in providerState.recomputeThreadState) or the
// team explicitly flagged it unread inside GOS (manualUnread).
const UNREAD_OR = [{ unreadCount: { gt: 0 } }, { manualUnread: true }];

function unreadWhere(accountId) {
  return { ...(accountId ? { accountId } : {}), inInbox: true, OR: UNREAD_OR };
}

// In-memory counterpart of unreadWhere — must stay in lockstep with it.
function isUnreadThread(t) {
  return t.unreadCount > 0 || t.manualUnread;
}

// ── Accounts & OAuth ─────────────────────────────────────────────────────────

router.get(
  '/accounts',
  handle(async (_req, res) => {
    const accounts = await prisma.emailAccount.findMany({
      orderBy: { createdAt: 'asc' },
      select: { ...ACCOUNT_SAFE_SELECT, refreshTokenEnc: true, scopes: true },
    });
    res.set('Cache-Control', 'no-store');
    res.json({
      configured: emailIntegrationConfigured(),
      missing: missingEmailConfig(),
      accounts: accounts.map(({ refreshTokenEnc, scopes, ...a }) => {
        const connected = !!refreshTokenEnc;
        const hasCalendarScope = String(scopes || '').includes('calendar.events');
        const hasModifyScope = String(scopes || '').includes('gmail.modify');
        return {
          ...a,
          connected,
          scopeLabels: describeScopes(scopes),
          hasCalendarScope,
          hasModifyScope,
          // Connected under the old read-only scopes → Gmail-write actions
          // (archive / mark read-unread) are gated until a re-consent reconnect.
          needsReconsent: connected && !hasModifyScope,
          // The whole Google connection needs a human reconnect: the token was
          // revoked/expired (healthState), or calendar sync was never granted.
          needsReconnect:
            connected && (a.healthState === 'reconnect_required' || !hasCalendarScope),
        };
      }),
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
    // This is a top-level browser navigation from Google, so EVERY exit must be
    // a redirect back into the GOS app — never a JSON 500 or (worse) a hung
    // request that Cloudflare turns into a raw 502 page. The whole body is
    // wrapped so any unexpected throw still lands the admin on a controlled
    // Hebrew screen. exchangeCode is timeout-bounded (googleClient), so a slow
    // Google now fails fast into `exchange_failed` instead of hanging.
    res.set('Cache-Control', 'no-store');
    const fail = (reason) => res.redirect(`/admin/email?connect_error=${encodeURIComponent(reason)}`);
    try {
      if (!emailIntegrationConfigured()) return fail('not_configured');
      if (req.query.error) return fail(String(req.query.error));
      if (!verifyOAuthState(req.query.state)) return fail('bad_state');
      const code = String(req.query.code || '');
      if (!code) return fail('missing_code');

      let tokens;
      try {
        tokens = await exchangeCode({ code, redirectUri: callbackRedirectUri(req) });
      } catch (e) {
        console.error('[email] code exchange failed:', e?.code || e?.message);
        return fail('exchange_failed');
      }
      const claims = decodeIdToken(tokens.id_token) || {};
      const emailAddress = normalizeEmail(claims.email);
      if (!emailAddress) return fail('no_email_claim');

      // Atomic reconnect: exchangeCode already VALIDATED the new credentials
      // (Google returned tokens + a signed id_token) before we touch the stored
      // record, so a failed reconnect never overwrites a working connection.
      // buildConnectData omits refreshTokenEnc when Google returns none, so a
      // token-only response never nulls a working refresh token.
      const data = buildConnectData({ tokens, claims, connectedById: req.adminAuth?.userId || null });
      const account = await prisma.emailAccount.upsert({
        where: { emailAddress },
        create: { emailAddress, ...data },
        update: data,
      });

      // Kick the first sync in the background — the UI polls account status.
      syncAccount(account.id).catch((e) => console.error('[email] initial sync failed:', e?.message));
      return res.redirect(`/admin/email?connected=${encodeURIComponent(emailAddress)}`);
    } catch (e) {
      console.error('[email] connect callback failed:', e?.message);
      return fail('server_error');
    }
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
      // 422 (not 502): a provider failure must pass through Cloudflare as JSON,
      // never be replaced by a raw CF error page. invalid_grant flips the shared
      // connection to reconnect_required so the UI shows a clean Hebrew state.
      if (isInvalidGrant(e)) await markAccountAuthError(prisma, account, e).catch(() => {});
      res.status(422).json({
        error: 'sync_failed',
        reconnectRequired: isInvalidGrant(e),
        message: sanitizeAuthError(e),
      });
    }
  }),
);

// Read-only connection health check — refreshes the access token and probes
// Gmail (profile) + Calendar (events.list, maxResults 1). Sends NO mail and
// creates NO events. Persists a sanitized verdict and returns it.
router.post(
  '/accounts/:id/health-check',
  handle(async (req, res) => {
    const account = await prisma.emailAccount.findUnique({ where: { id: req.params.id } });
    if (!account) return res.status(404).json({ error: 'not_found' });
    res.set('Cache-Control', 'no-store');
    const result = await runHealthCheck(account);
    res.json(result);
  }),
);

router.put(
  '/accounts/:id',
  handle(async (req, res) => {
    const account = await prisma.emailAccount.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!account) return res.status(404).json({ error: 'not_found' });
    const data = {};
    if (req.body?.isActive !== undefined) data.isActive = !!req.body.isActive;
    // Composer signature (rich HTML) — sanitized with the same email rules.
    if (req.body?.signature !== undefined) data.signature = sanitizeEmailHtml(req.body.signature);
    if (Object.keys(data).length === 0) return res.status(400).json({ error: 'nothing_to_update' });
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
        healthState: 'disconnected',
        lastAuthError: null,
        lastAuthErrorAt: null,
      },
      select: ACCOUNT_SAFE_SELECT,
    });
    res.json(updated);
  }),
);

// ── Recipient suggestions (composer autocomplete) ────────────────────────────
//
// Two sources, merged and de-duplicated by address:
//   1. CRM contacts — via the canonical contactSearchWhere (same matching the
//      Contacts list and global search use; never hand-rolled here).
//   2. Addresses already corresponded with — EmailThread.participants, which is
//      exactly "previously used email addresses" and covers people who are not
//      (yet) CRM contacts.
// Contacts rank first: a known person beats a raw address.
router.get(
  '/recipient-suggestions',
  handle(async (req, res) => {
    const q = String(req.query.q || '').trim();
    res.set('Cache-Control', 'no-store');
    if (q.length < 2) return res.json([]);

    const out = [];
    const seen = new Set();
    const push = (email, name, source) => {
      const addr = normalizeEmail(email);
      if (!addr || seen.has(addr)) return;
      seen.add(addr);
      out.push({ email: addr, name: name || null, source });
    };

    const { where } = await contactSearchWhere(q, phoneQuery(q), prisma, { includeLegacy: false });
    const contacts = await prisma.contact.findMany({
      where,
      take: 10,
      include: { emails: { orderBy: { isPrimary: 'desc' }, take: 2 } },
      orderBy: [{ lastNameHe: 'asc' }, { firstNameHe: 'asc' }],
    });
    for (const c of contacts) {
      for (const e of c.emails) push(e.value, contactDisplayName(c), 'contact');
    }

    // Previously-corresponded addresses. participants is JSON, so filter in JS
    // over a bounded recent window rather than pushing a JSON query into SQL.
    if (out.length < 10) {
      const recent = await prisma.emailThread.findMany({
        where: { participants: { not: Prisma.DbNull } },
        orderBy: { lastMessageAt: 'desc' },
        take: 400,
        select: { participants: true },
      });
      const needle = q.toLowerCase();
      for (const t of recent) {
        for (const p of Array.isArray(t.participants) ? t.participants : []) {
          const hay = `${p?.email || ''} ${p?.name || ''}`.toLowerCase();
          if (!hay.includes(needle)) continue;
          push(p?.email, p?.name, 'history');
          if (out.length >= 12) break;
        }
        if (out.length >= 12) break;
      }
    }
    res.json(out.slice(0, 12));
  }),
);

// ── Inbox ────────────────────────────────────────────────────────────────────

// GET /inbox?accountId=&filter=all|unread|unmatched|deal|nodeal|today|archive&q=
//
// ACTIVE INBOX = what Gmail itself would show today: only threads with a live
// INBOX-labeled message (inInbox, maintained by the sync's label tracking).
// The 'archive' filter exposes the rest of the mirror (archived / sent-only)
// deliberately; free-text search also spans the whole mirror.
// Ordering (product spec): unread section first, then read — newest activity
// first within each; GOS-pinned threads float above both.
router.get(
  '/inbox',
  handle(async (req, res) => {
    const accountId = req.query.accountId ? String(req.query.accountId) : null;
    const filter = String(req.query.filter || 'all');
    const q = String(req.query.q || '').trim();

    const where = { ...(accountId ? { accountId } : {}) };
    // Label-view filters escape the active-inbox scope (Gmail semantics:
    // ארכיון and נשלחו are their own views); free-text search spans everything.
    if (filter === 'archive') where.inInbox = false;
    else if (filter !== 'sent' && !q) where.inInbox = true;
    if (filter === 'unread') where.AND = [{ OR: UNREAD_OR }]; // same rule as unreadWhere/isUnreadThread
    else if (filter === 'read') where.AND = [{ unreadCount: 0, manualUnread: false }];
    else if (filter === 'unmatched') where.contactId = null;
    else if (filter === 'deal') where.linkedDealId = { not: null };
    else if (filter === 'nodeal') where.linkedDealId = null;
    else if (filter === 'sent') {
      where.messages = { some: { direction: 'outbound', providerDeletedAt: null } };
    } else if (filter === 'today') {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      where.lastMessageAt = { gte: start };
    } else if (filter === 'week') {
      where.lastMessageAt = { gte: new Date(Date.now() - 7 * 86_400_000) };
    }
    if (q) {
      // Search spans: subject/snippet, sender, recipients (via message
      // subject/from), body text, attachment names, the matched CONTACT's
      // name, and the linked DEAL's title.
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
                { bodyText: { contains: q, mode: 'insensitive' } },
                { attachments: { some: { fileName: { contains: q, mode: 'insensitive' } } } },
              ],
            },
          },
        },
        {
          contact: {
            OR: [
              { firstNameHe: { contains: q, mode: 'insensitive' } },
              { lastNameHe: { contains: q, mode: 'insensitive' } },
              { firstNameEn: { contains: q, mode: 'insensitive' } },
              { lastNameEn: { contains: q, mode: 'insensitive' } },
            ],
          },
        },
        { linkedDeal: { title: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const ORDER = [
      // Explicit nulls:'last' everywhere — Postgres DESC defaults to NULLS
      // FIRST, which pinned broken-dated threads to the TOP (live-QA bug).
      { pinnedAt: { sort: 'desc', nulls: 'last' } },
      { lastMessageAt: { sort: 'desc', nulls: 'last' } },
      { createdAt: 'desc' },
    ];

    const rows = await prisma.emailThread.findMany({
      where,
      include: THREAD_INCLUDE,
      orderBy: ORDER,
      take: 200,
    });

    // The paginated page is the NEWEST 200 threads, so an unread thread older
    // than that window would silently drop out of the "all" view even though
    // the unread view lists it — two different answers to "is this unread?".
    // Canonical rule: unread MEMBERSHIP (unreadWhere) never depends on
    // pagination. Every unread thread is unioned into the page, then the
    // sectioning below puts them on top; the remaining paginated threads follow
    // without duplicates.
    let page = rows;
    if (filter === 'all' && !q) {
      const unreadRows = await prisma.emailThread.findMany({
        where: unreadWhere(accountId),
        include: THREAD_INCLUDE,
        orderBy: ORDER,
      });
      const seen = new Set(rows.map((t) => t.id));
      page = [...rows, ...unreadRows.filter((t) => !seen.has(t.id))];
    }

    // Unread-first sectioning (stable — recency order kept inside each
    // section). Pinned threads stay on top regardless of read state; a manual
    // "סמן כלא נקרא" joins the unread section visually.
    const pinned = page.filter((t) => t.pinnedAt);
    const unread = page.filter((t) => !t.pinnedAt && isUnreadThread(t));
    const read = page.filter((t) => !t.pinnedAt && !isUnreadThread(t));
    const threads = [...pinned, ...unread, ...read];

    // Badge count uses the SAME membership rule as the unread view and the
    // sectioning above — previously it counted only unreadCount>0, so a
    // manually-unread thread was listed but never counted.
    const unreadTotal = await prisma.emailThread.count({ where: unreadWhere(accountId) });
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
      // Messages deleted in Gmail leave the reading view (like Gmail itself);
      // they stay in the mirror and in CRM history/timeline.
      where: { threadId: thread.id, providerDeletedAt: null },
      orderBy: { sentAt: 'asc' },
      include: {
        attachments: true,
        engagement: { select: { openCount: true, firstOpenedAt: true, lastOpenedAt: true } },
      },
    });
    res.json({ thread: toClientThread(thread), messages });
  }),
);

// ── Thread actions (Gmail-synced: GOS is a real Gmail client now) ───────────
//
// With the gmail.modify scope, read/unread/archive/unarchive WRITE TO GMAIL
// and update the mirror immediately (the snapshot sync confirms within a
// minute). Accounts still on the old read-only consent:
//   • read / unread fall back to the proven GOS-side behavior (lastReadAt /
//     manualUnread) and return gmailSynced:false
//   • archive / unarchive have no honest local equivalent → 409
//     reconsent_required (the UI routes the user to reconnect).
// No delete anywhere — permanent deletion stays out by design.

// Apply a label change to every live message of a thread in the MIRROR
// (matching what threads.modify just did in Gmail), then recompute.
async function applyLocalThreadLabels(threadId, { add = [], remove = [] }) {
  const messages = await prisma.emailMessage.findMany({
    where: { threadId, providerDeletedAt: null },
    select: { id: true, labelIds: true },
  });
  for (const m of messages) {
    const labels = new Set(Array.isArray(m.labelIds) ? m.labelIds : []);
    for (const l of add) labels.add(l);
    for (const l of remove) labels.delete(l);
    await prisma.emailMessage.update({ where: { id: m.id }, data: { labelIds: [...labels] } });
  }
  await recomputeThreadState(threadId);
}

const THREAD_ACTIONS = new Set(['read', 'unread', 'archive', 'unarchive']);

// → { ok, gmailSynced } — throws coded errors the routes translate.
async function performThreadAction(threadId, action) {
  const thread = await prisma.emailThread.findUnique({
    where: { id: threadId },
    select: { id: true, accountId: true, gmailThreadId: true },
  });
  if (!thread) {
    const e = new Error('not_found');
    e.code = 'not_found';
    throw e;
  }
  const account = await prisma.emailAccount.findUnique({ where: { id: thread.accountId } });
  const canModify = !!account?.refreshTokenEnc && account.isActive && accountHasModifyScope(account);

  if (action === 'read') {
    if (canModify) {
      try {
        await gmail.modifyThread(prisma, account, thread.gmailThreadId, { removeLabelIds: ['UNREAD'] });
        await applyLocalThreadLabels(thread.id, { remove: ['UNREAD'] });
        await prisma.emailThread.update({
          where: { id: thread.id },
          data: { lastReadAt: new Date(), manualUnread: false, unreadCount: 0 },
        });
        return { ok: true, gmailSynced: true };
      } catch (e) {
        console.error('[email] gmail mark-read failed (falling back to GOS-side):', e?.message);
      }
    }
    // GOS-side fallback (old consent / transient Gmail failure) — user intent
    // is honored locally either way.
    await prisma.emailThread.update({
      where: { id: thread.id },
      data: { unreadCount: 0, lastReadAt: new Date(), manualUnread: false },
    });
    return { ok: true, gmailSynced: false };
  }

  if (action === 'unread') {
    if (canModify) {
      // Gmail's own "mark as unread" semantics: flag the NEWEST message (not
      // the whole conversation — the count must read 1, not N).
      const newest = await prisma.emailMessage.findFirst({
        where: { threadId: thread.id, providerDeletedAt: null },
        orderBy: [{ direction: 'asc' } /* 'inbound' < 'outbound' */, { sentAt: 'desc' }],
        select: { id: true, gmailMessageId: true, labelIds: true },
      });
      if (newest) {
        try {
          await gmail.modifyMessage(prisma, account, newest.gmailMessageId, { addLabelIds: ['UNREAD'] });
          const labels = new Set(Array.isArray(newest.labelIds) ? newest.labelIds : []);
          labels.add('UNREAD');
          await prisma.emailMessage.update({ where: { id: newest.id }, data: { labelIds: [...labels] } });
          // Clear the GOS read cutoff so the UNREAD label actually counts.
          await prisma.emailThread.update({
            where: { id: thread.id },
            data: { lastReadAt: null, manualUnread: false },
          });
          await recomputeThreadState(thread.id);
          return { ok: true, gmailSynced: true };
        } catch (e) {
          console.error('[email] gmail mark-unread failed (falling back to GOS-side):', e?.message);
        }
      }
    }
    await prisma.emailThread.update({ where: { id: thread.id }, data: { manualUnread: true } });
    return { ok: true, gmailSynced: false };
  }

  // archive / unarchive — real mailbox moves; no honest local-only fallback.
  if (!canModify) {
    const e = new Error('reconsent_required');
    e.code = 'reconsent_required';
    throw e;
  }
  if (action === 'archive') {
    await gmail.modifyThread(prisma, account, thread.gmailThreadId, { removeLabelIds: ['INBOX'] });
    await applyLocalThreadLabels(thread.id, { remove: ['INBOX'] });
  } else {
    await gmail.modifyThread(prisma, account, thread.gmailThreadId, { addLabelIds: ['INBOX'] });
    await applyLocalThreadLabels(thread.id, { add: ['INBOX'] });
  }
  return { ok: true, gmailSynced: true };
}

function threadActionRoute(action) {
  return handle(async (req, res) => {
    try {
      const result = await performThreadAction(req.params.id, action);
      const updated = await prisma.emailThread.findUnique({
        where: { id: req.params.id },
        include: THREAD_INCLUDE,
      });
      res.json({ ...result, thread: toClientThread(updated) });
    } catch (e) {
      if (e.code === 'not_found') return res.status(404).json({ error: 'not_found' });
      if (e.code === 'reconsent_required') return res.status(409).json({ error: 'reconsent_required' });
      console.error(`[email] thread ${action} failed:`, e?.message);
      return res.status(502).json({ error: `${action}_failed`, detail: (e?.message || '').slice(0, 300) });
    }
  });
}

router.post('/threads/:id/read', threadActionRoute('read'));
router.post('/threads/:id/unread', threadActionRoute('unread'));
router.post('/threads/:id/archive', threadActionRoute('archive'));
router.post('/threads/:id/unarchive', threadActionRoute('unarchive'));

// Bulk (multi-select in the inbox): applies one action to many threads,
// per-thread isolation — one failure never aborts the rest.
router.post(
  '/threads/bulk-action',
  handle(async (req, res) => {
    const action = String(req.body?.action || '');
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x) => typeof x === 'string') : [];
    if (!THREAD_ACTIONS.has(action)) return res.status(400).json({ error: 'invalid_action' });
    if (!ids.length || ids.length > 100) return res.status(400).json({ error: 'invalid_ids' });
    let done = 0;
    let reconsent = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        await performThreadAction(id, action);
        done += 1;
      } catch (e) {
        if (e.code === 'reconsent_required') reconsent += 1;
        else failed += 1;
      }
    }
    res.json({ ok: failed === 0 && reconsent === 0, done, reconsent, failed });
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
        : // 'unlinked' sentinel: auto-matching (ingest + the worker's re-match
          // sweep) skips this thread forever — it never fights a manual unlink.
          { contactId: null, matchSource: 'unlinked', linkedDealId: null, linkSource: 'unlinked' },
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
        : // 'unlinked' sentinel — ingest never auto-re-links this thread.
          { linkedDealId: null, linkSource: 'unlinked' },
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
    // Communication Center — "ליד חדש נוצר" (deal opened from an email thread).
    fireCommunicationTrigger({ type: 'deal_created', dealId: deal.id });
    // New sales lead → exactly one "שיחה ראשונית" task (idempotent).
    ensureInitialCallTask({ dealId: deal.id });
    res.status(201).json({ dealId: deal.id, contactId });
  }),
);

// ── Send ─────────────────────────────────────────────────────────────────────
//
// Both "send now" and "send later" go through email/composedSend.js — one
// implementation, so a scheduled email is byte-for-byte what the composer would
// have sent immediately.

// Coded errors from the send path → HTTP. Provider/upstream failures return 422
// (never 5xx): Cloudflare replaces 502/504 bodies with its own HTML page.
const SEND_ERROR_STATUS = {
  email_not_configured: 503,
  no_connected_account: 400,
  recipient_required: 400,
  subject_required: 400,
  body_required: 400,
  attachments_too_large: 400,
  reply_source_not_found: 400,
  reply_account_mismatch: 400,
  forward_source_not_found: 400,
  forward_account_mismatch: 400,
  forward_attachment_failed: 422,
  send_failed: 422,
};

function sendErrorResponse(res, e) {
  const status = SEND_ERROR_STATUS[e?.code];
  if (!status) throw e; // unexpected → generic error handler
  const body = { error: e.code };
  if (e.detail) body.detail = e.detail;
  if (e.code === 'send_failed' || e.code === 'forward_attachment_failed') {
    body.message = sanitizeAuthError(e.cause || e);
  }
  if (e.code === 'email_not_configured') body.missing = missingEmailConfig();
  return res.status(status).json(body);
}

// POST /send — send NOW. { accountId?, to[], cc?, bcc?, subject, bodyHtml,
// replyToMessageId?, forwardOfMessageId?, dealId?, contactId?, attachments?[] }.
// All composition/threading/mirroring lives in email/composedSend.js so this
// route and the scheduled worker cannot drift apart.
router.post(
  '/send',
  handle(async (req, res) => {
    const b = req.body || {};
    try {
      const result = await sendComposedEmail({
        accountId: b.accountId,
        to: b.to,
        cc: b.cc,
        bcc: b.bcc,
        subject: b.subject,
        bodyHtml: b.bodyHtml,
        bodyText: b.bodyText,
        attachments: b.attachments,
        replyToMessageId: b.replyToMessageId,
        forwardOfMessageId: b.forwardOfMessageId,
        dealId: b.dealId,
        contactId: b.contactId,
        createdByUserId: req.adminAuth?.userId || null,
        origin: resolvePublicOrigin(req),
      });
      res.status(201).json(result);
    } catch (e) {
      if (e?.code !== 'send_failed') console.error('[email] send failed:', e?.code || e?.message);
      return sendErrorResponse(res, e);
    }
  }),
);

// ── Scheduled sending (send later) ───────────────────────────────────────────
//
// The composition is validated with the SAME rules as an immediate send and
// frozen on the row, then replayed through the same send path by
// email/scheduledWorker.js. `scheduledAt` is an absolute instant (ISO, stored
// UTC) computed by the client from the user's timezone — the server never
// re-interprets wall-clock text.

const SCHEDULE_SAFE_SELECT = {
  id: true,
  accountId: true,
  toJson: true,
  ccJson: true,
  bccJson: true,
  subject: true,
  scheduledAt: true,
  status: true,
  sentAt: true,
  cancelledAt: true,
  failureReason: true,
  attemptCount: true,
  connectionDeferredCount: true,
  dealId: true,
  contactId: true,
  threadId: true,
  createdById: true,
  createdAt: true,
  attachments: true,
  replyToMessageId: true,
  forwardOfMessageId: true,
};

// Rows → client DTOs. Resolves the sending ACCOUNT and the CREATOR in one
// batched pass (createdById is a loose key by convention — no FK relation — so
// it is resolved here rather than joined). `attachments` never leaves the
// server as bytes: only names/sizes, which is all any list or preview needs.
async function toScheduledDtos(rows) {
  if (!rows.length) return [];
  const accountIds = [...new Set(rows.map((r) => r.accountId))];
  const userIds = [...new Set(rows.map((r) => r.createdById).filter(Boolean))];
  const [accounts, users] = await Promise.all([
    prisma.emailAccount.findMany({ where: { id: { in: accountIds } }, select: { id: true, emailAddress: true } }),
    userIds.length
      ? prisma.adminUser.findMany({ where: { id: { in: userIds } }, select: ADMIN_NAME_SELECT })
      : Promise.resolve([]),
  ]);
  const accountBy = new Map(accounts.map((a) => [a.id, a.emailAddress]));
  const userBy = new Map(users.map((u) => [u.id, adminDisplayName(u)]));
  return rows.map(({ attachments, createdById, ...r }) => ({
    ...r,
    accountEmail: accountBy.get(r.accountId) || null,
    createdByName: createdById ? userBy.get(createdById) || null : null,
    attachments: (Array.isArray(attachments) ? attachments : []).map((a) => ({
      filename: a?.filename || null,
      mimeType: a?.mimeType || null,
      sizeBytes: a?.contentBase64 ? Math.floor(String(a.contentBase64).length * 0.75) : null,
    })),
  }));
}

// Minimum lead time — a schedule in the past (or a few seconds out) would fire
// on the very next tick, which is indistinguishable from "send now" and hides
// mistakes. 60s keeps the item visibly cancellable before it goes.
const MIN_LEAD_MS = 60_000;

function parseScheduledAt(value) {
  const at = new Date(String(value || ''));
  if (Number.isNaN(at.getTime())) throw Object.assign(new Error('invalid_schedule'), { code: 'invalid_schedule' });
  if (at.getTime() - Date.now() < MIN_LEAD_MS) {
    throw Object.assign(new Error('schedule_too_soon'), { code: 'schedule_too_soon' });
  }
  return at;
}

router.post(
  '/scheduled',
  handle(async (req, res) => {
    const b = req.body || {};
    try {
      if (!emailIntegrationConfigured()) throw Object.assign(new Error('x'), { code: 'email_not_configured' });
      const at = parseScheduledAt(b.scheduledAt);
      // Same account resolution and the same validation an immediate send runs,
      // so a scheduled item can never be accepted in an unsendable shape.
      const account = await resolveSendAccount(b.accountId);
      const clean = validateComposition({
        to: b.to,
        cc: b.cc,
        bcc: b.bcc,
        subject: b.subject,
        bodyHtml: b.bodyHtml,
        bodyText: b.bodyText,
        attachments: b.attachments,
        replyToMessageId: b.replyToMessageId,
        forwardOfMessageId: b.forwardOfMessageId,
      });
      const row = await prisma.scheduledEmail.create({
        data: {
          accountId: account.id,
          toJson: clean.to,
          ccJson: clean.cc,
          bccJson: clean.bcc,
          subject: clean.subject || null,
          bodyHtml: clean.bodyHtml,
          bodyText: clean.bodyText,
          attachments: clean.attachments.length ? clean.attachments : undefined,
          replyToMessageId: b.replyToMessageId ? String(b.replyToMessageId) : null,
          forwardOfMessageId: b.forwardOfMessageId ? String(b.forwardOfMessageId) : null,
          dealId: b.dealId ? String(b.dealId) : null,
          contactId: b.contactId ? String(b.contactId) : null,
          scheduledAt: at,
          createdById: req.adminAuth?.userId || null,
        },
        select: SCHEDULE_SAFE_SELECT,
      });
      res.status(201).json(row);
    } catch (e) {
      if (e?.code === 'invalid_schedule') return res.status(400).json({ error: 'invalid_schedule' });
      if (e?.code === 'schedule_too_soon') return res.status(400).json({ error: 'schedule_too_soon' });
      return sendErrorResponse(res, e);
    }
  }),
);

// Scheduled list. Optionally scoped to a deal or contact — the Deal/Contact
// email panels show only their own customer's pending mail.
//
// scope:
//   'open'    (default) — actionable queue: pending + failed. SENT items leave
//                         it deliberately; they live on in normal email history
//                         (the mirrored thread), so the queue never doubles as
//                         an archive.
//   'history'           — everything incl. cancelled + sent, so a cancelled item
//                         stays visible with its final state for audit.
router.get(
  '/scheduled',
  handle(async (req, res) => {
    const where = {};
    if (req.query.dealId) where.dealId = String(req.query.dealId);
    if (req.query.contactId) where.contactId = String(req.query.contactId);
    if (req.query.status) where.status = String(req.query.status);
    else if (String(req.query.scope || 'open') === 'history') {
      where.status = { in: ['pending', 'failed', 'cancelled', 'sent'] };
    } else where.status = { in: ['pending', 'failed'] };
    res.set('Cache-Control', 'no-store');
    const rows = await prisma.scheduledEmail.findMany({
      where,
      // Soonest-first for the queue; history reads newest-activity first.
      orderBy: where.status?.in?.includes('sent') ? { createdAt: 'desc' } : { scheduledAt: 'asc' },
      take: 200,
      select: SCHEDULE_SAFE_SELECT,
    });
    res.json(await toScheduledDtos(rows));
  }),
);

// One item WITH its body — powers Preview and Edit. Attachment bytes are still
// withheld (names/sizes only); editing keeps the stored files unless the caller
// explicitly replaces them.
router.get(
  '/scheduled/:id',
  handle(async (req, res) => {
    const row = await prisma.scheduledEmail.findUnique({
      where: { id: req.params.id },
      select: { ...SCHEDULE_SAFE_SELECT, bodyHtml: true, bodyText: true },
    });
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.set('Cache-Control', 'no-store');
    const [dto] = await toScheduledDtos([row]);
    res.json({ ...dto, bodyHtml: row.bodyHtml, bodyText: row.bodyText });
  }),
);

// Edit a still-pending scheduled email IN PLACE — same row, same id, so its
// audit trail (created-by, creation time, deal/contact context) survives an
// edit. Only a pending item is editable; the guard is part of the write, so an
// item the worker claimed mid-edit can never be silently rewritten.
// `attachments` omitted → the stored files are kept; passed → they replace.
router.put(
  '/scheduled/:id',
  handle(async (req, res) => {
    const b = req.body || {};
    const existing = await prisma.scheduledEmail.findUnique({
      where: { id: req.params.id },
      select: { id: true, status: true, attachments: true },
    });
    if (!existing) return res.status(404).json({ error: 'not_found' });
    if (existing.status !== 'pending') {
      return res.status(409).json({ error: 'not_editable', status: existing.status });
    }
    try {
      const at = b.scheduledAt !== undefined ? parseScheduledAt(b.scheduledAt) : undefined;
      const account = b.accountId ? await resolveSendAccount(b.accountId) : null;
      // Re-run the SAME validation a create/immediate send runs, so an edit can
      // never leave the row in an unsendable shape.
      const clean = validateComposition({
        to: b.to,
        cc: b.cc,
        bcc: b.bcc,
        subject: b.subject,
        bodyHtml: b.bodyHtml,
        bodyText: b.bodyText,
        attachments: b.attachments !== undefined ? b.attachments : existing.attachments,
        replyToMessageId: b.replyToMessageId,
        forwardOfMessageId: b.forwardOfMessageId,
      });
      const result = await prisma.scheduledEmail.updateMany({
        where: { id: existing.id, status: 'pending' }, // guarded: worker may have claimed it
        data: {
          ...(account ? { accountId: account.id } : {}),
          toJson: clean.to,
          ccJson: clean.cc,
          bccJson: clean.bcc,
          subject: clean.subject || null,
          bodyHtml: clean.bodyHtml,
          bodyText: clean.bodyText,
          attachments: clean.attachments.length ? clean.attachments : Prisma.DbNull,
          ...(at ? { scheduledAt: at } : {}),
          // A fresh intent gets a fresh retry ladder.
          attemptCount: 0,
          nextRetryAt: null,
          failureReason: null,
        },
      });
      if (!result.count) return res.status(409).json({ error: 'not_editable' });
      const row = await prisma.scheduledEmail.findUnique({
        where: { id: existing.id },
        select: SCHEDULE_SAFE_SELECT,
      });
      const [dto] = await toScheduledDtos([row]);
      res.json(dto);
    } catch (e) {
      if (e?.code === 'invalid_schedule' || e?.code === 'schedule_too_soon') {
        return res.status(400).json({ error: e.code });
      }
      return sendErrorResponse(res, e);
    }
  }),
);

// Cancel — terminal, and guarded on status:'pending' so an item the worker has
// already claimed/sent can never be "cancelled" after the fact.
router.post(
  '/scheduled/:id/cancel',
  handle(async (req, res) => {
    const result = await prisma.scheduledEmail.updateMany({
      where: { id: req.params.id, status: 'pending' },
      data: { status: 'cancelled', cancelledAt: new Date(), claimedAt: null, claimedBy: null },
    });
    if (!result.count) {
      const row = await prisma.scheduledEmail.findUnique({
        where: { id: req.params.id },
        select: { status: true },
      });
      if (!row) return res.status(404).json({ error: 'not_found' });
      return res.status(409).json({ error: 'not_cancellable', status: row.status });
    }
    const row = await prisma.scheduledEmail.findUnique({
      where: { id: req.params.id },
      select: SCHEDULE_SAFE_SELECT,
    });
    const [dto] = await toScheduledDtos([row]);
    res.json(dto);
  }),
);

// Reschedule (edit the time before it sends). Same guard + same lead-time rule.
router.post(
  '/scheduled/:id/reschedule',
  handle(async (req, res) => {
    let at;
    try {
      at = parseScheduledAt(req.body?.scheduledAt);
    } catch (e) {
      return res.status(400).json({ error: e.code || 'invalid_schedule' });
    }
    const result = await prisma.scheduledEmail.updateMany({
      where: { id: req.params.id, status: 'pending' },
      // Rescheduling resets the retry ladder — a fresh intent gets fresh attempts.
      data: { scheduledAt: at, nextRetryAt: null, attemptCount: 0, failureReason: null },
    });
    if (!result.count) return res.status(409).json({ error: 'not_reschedulable' });
    const row = await prisma.scheduledEmail.findUnique({
      where: { id: req.params.id },
      select: SCHEDULE_SAFE_SELECT,
    });
    const [dto] = await toScheduledDtos([row]);
    res.json(dto);
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
