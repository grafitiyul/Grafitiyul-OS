import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { buildPhoneIndex, matchContactId, normalizePhoneIntl } from '../whatsapp/phone.js';
import { isConfigured as r2Configured, presignGet } from '../r2.js';

// WhatsApp module — Slice 1 (accounts / connections admin).
//
// Deployment model: one bridge SERVICE per WhatsApp number (gos-whatsapp-main
// / gos-whatsapp-office), same code + same Postgres, account selected by env.
// This router is the admin UI's single door: account rows come from the DB
// (the bridge mirrors its live connection state into WhatsAppAccount), and
// live actions (QR data URL, readiness, restart/hard-reset/sign-out) proxy to
// the right bridge over Railway's private network.
//
// Bridge addressing: WHATSAPP_BRIDGE_URLS env maps accountId → base URL,
//   e.g. "main=http://gos-whatsapp-main.railway.internal:3000,office=http://gos-whatsapp-office.railway.internal:3000"
// WHATSAPP_BRIDGE_SECRET must equal each bridge's BRIDGE_INTERNAL_SECRET.
// Missing config degrades cleanly: accounts list still renders from the DB,
// live actions return 'bridge_not_configured'.

const router = Router();

function bridgeUrlMap() {
  const raw = String(process.env.WHATSAPP_BRIDGE_URLS || '').trim();
  const map = {};
  for (const pair of raw.split(',')) {
    const idx = pair.indexOf('=');
    if (idx <= 0) continue;
    const key = pair.slice(0, idx).trim();
    const url = pair.slice(idx + 1).trim().replace(/\/+$/, '');
    if (key && url) map[key] = url;
  }
  return map;
}

async function callBridge(accountId, path, { method = 'GET', timeoutMs = 10_000 } = {}) {
  const base = bridgeUrlMap()[accountId];
  const secret = process.env.WHATSAPP_BRIDGE_SECRET;
  if (!base || !secret) {
    const err = new Error('bridge_not_configured');
    err.code = 'bridge_not_configured';
    throw err;
  }
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok && res.status !== 202) {
    const err = new Error(`bridge_error: ${data?.error || res.status}`);
    err.code = 'bridge_error';
    err.status = res.status;
    throw err;
  }
  return data;
}

function bridgeErrorResponse(res, err) {
  if (err?.code === 'bridge_not_configured') {
    return res.status(503).json({ error: 'bridge_not_configured' });
  }
  // Timeouts / connection refused / bridge 5xx all land here — the account
  // row (DB) stays readable either way, so the UI can show "bridge unreachable"
  // next to the last persisted status.
  return res.status(502).json({ error: 'bridge_unreachable', detail: err?.message || String(err) });
}

// List accounts — DB rows (each bridge keeps its own row live) MERGED with
// accounts declared in WHATSAPP_BRIDGE_URLS that have no row yet. A declared-
// but-rowless account means its bridge never wrote to this DB (not booted /
// wrong start command / different DATABASE_URL) — the UI must show a card for
// it (with the diagnose hint) instead of a misleading "no accounts" empty
// state. provisioned=false marks those placeholder entries.
router.get(
  '/accounts',
  handle(async (_req, res) => {
    const urls = bridgeUrlMap();
    const rows = await prisma.whatsAppAccount.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const known = new Set(rows.map((r) => r.id));
    const placeholders = Object.keys(urls)
      .filter((id) => !known.has(id))
      .map((id) => ({
        id,
        label: id,
        active: true,
        status: 'disconnected',
        bridgeConfigured: true,
        provisioned: false,
      }));
    res.set('Cache-Control', 'no-store');
    res.json([
      ...rows.map((r) => ({ ...r, qr: undefined, bridgeConfigured: !!urls[r.id], provisioned: true })),
      ...placeholders,
    ]);
  }),
);

// Structured self-diagnosis for one account's bridge wiring. Probes the
// bridge over the private network and classifies the failure so the operator
// doesn't have to guess between "wrong hostname", "wrong start command",
// "secret mismatch", "wrong database". Read-only.
router.get(
  '/accounts/:id/diagnose',
  handle(async (req, res) => {
    const accountId = req.params.id;
    const base = bridgeUrlMap()[accountId];
    const secret = process.env.WHATSAPP_BRIDGE_SECRET;
    const dbRow = await prisma.whatsAppAccount.findUnique({ where: { id: accountId } });
    const out = {
      accountId,
      urlConfigured: !!base,
      url: base || null,
      secretConfigured: !!secret,
      dbRowExists: !!dbRow,
      health: null,
      statusCheck: null,
      bridgeAccountId: null,
      verdict: 'ok',
    };
    res.set('Cache-Control', 'no-store');

    if (!base) {
      out.verdict = 'bridge_not_configured';
      return res.json(out);
    }

    // 1. /health — unauthenticated by design; also our "is this even the
    //    bridge?" probe. The GOS server answering here (wrong start command)
    //    returns HTML (SPA fallback) or JSON without accountId.
    try {
      const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(6000) });
      const text = await r.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* non-JSON */ }
      if (!json || typeof json !== 'object' || !('accountId' in json)) {
        out.health = 'not_bridge';
        out.verdict = 'wrong_service_code';
        return res.json(out);
      }
      out.health = 'ok';
      out.bridgeAccountId = json.accountId;
      if (json.accountId !== accountId) {
        out.verdict = 'account_id_mismatch';
        return res.json(out);
      }
    } catch (err) {
      out.health = 'unreachable';
      out.healthDetail = err?.message || String(err);
      out.verdict = 'bridge_unreachable';
      return res.json(out);
    }

    // 2. /status — authenticated; a 401 here means the secrets differ.
    if (!secret) {
      out.statusCheck = 'skipped';
      out.verdict = 'secret_missing';
      return res.json(out);
    }
    try {
      const r = await fetch(`${base}/status`, {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(6000),
      });
      if (r.status === 401) {
        out.statusCheck = 'auth_failed';
        out.verdict = 'secret_mismatch';
        return res.json(out);
      }
      out.statusCheck = r.ok ? 'ok' : `http_${r.status}`;
    } catch (err) {
      out.statusCheck = 'error';
      out.statusDetail = err?.message || String(err);
    }

    // 3. Bridge alive + right account + auth fine, but no row in OUR DB →
    //    the bridge is writing somewhere else.
    if (!dbRow) out.verdict = 'different_database';
    return res.json(out);
  }),
);

// Admin-owned fields only — the connection-state fields are the bridge's.
router.put(
  '/accounts/:id',
  handle(async (req, res) => {
    const b = req.body || {};
    const existing = await prisma.whatsAppAccount.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const data = {};
    if (b.label !== undefined) {
      const label = String(b.label).trim();
      if (!label) return res.status(400).json({ error: 'label_required' });
      data.label = label;
    }
    if (b.active !== undefined) data.active = !!b.active;
    if (b.sortOrder !== undefined) data.sortOrder = Number(b.sortOrder) || 0;
    const row = await prisma.whatsAppAccount.update({ where: { id: existing.id }, data });
    res.json({ ...row, qr: undefined });
  }),
);

// Live status — proxies the account's bridge (adds readiness + QR data URL on
// top of the persisted row).
router.get(
  '/accounts/:id/status',
  handle(async (req, res) => {
    try {
      const data = await callBridge(req.params.id, '/status');
      res.set('Cache-Control', 'no-store');
      res.json({ bridgeReachable: true, ...data });
    } catch (err) {
      return bridgeErrorResponse(res, err);
    }
  }),
);

// Recovery actions — thin proxies; the bridge fire-and-forgets and the UI
// re-polls status.
for (const action of ['restart-socket', 'hard-reset-session', 'sign-out']) {
  router.post(
    `/accounts/:id/${action}`,
    handle(async (req, res) => {
      try {
        const data = await callBridge(req.params.id, `/${action}`, { method: 'POST', timeoutMs: 30_000 });
        res.json({ ok: true, ...data });
      } catch (err) {
        return bridgeErrorResponse(res, err);
      }
    }),
  );
}

// ── Chat mirror (Slice 2) ────────────────────────────────────────────────────
// The bridges write chats/messages into the shared store; these endpoints are
// the ONLY read path the UI uses (Deal tab / Contact page / inbox all consume
// the same data). Everything is no-store — the mirror must never be stale.

const CONTACT_LITE_SELECT = {
  id: true,
  firstNameHe: true,
  lastNameHe: true,
  firstNameEn: true,
  lastNameEn: true,
};

function contactDisplayName(c) {
  if (!c) return null;
  return (
    `${c.firstNameHe || ''} ${c.lastNameHe || ''}`.trim() ||
    `${c.firstNameEn || ''} ${c.lastNameEn || ''}`.trim() ||
    null
  );
}

// Display-name tiers (CRM-first flavor of the proven resolution): linked CRM
// contact → saved address-book name → the contact's own pushName → group
// subject → phone digits → null (the UI shows "לא מזוהה").
function chatDisplayName(chat) {
  return (
    contactDisplayName(chat.contact) ||
    chat.savedContactName ||
    chat.pushName ||
    chat.groupSubject ||
    chat.phoneNumber ||
    null
  );
}

function toClientMessage(m) {
  return {
    id: m.id,
    direction: m.direction,
    messageType: m.messageType,
    textContent: m.textContent,
    senderName: m.senderName,
    senderPhone: m.senderPhone,
    quotedExternalId: m.quotedExternalId,
    timestampFromSource: m.timestampFromSource,
    media: m.mediaStatus
      ? {
          status: m.mediaStatus,
          mimeType: m.mediaMimeType,
          sizeBytes: m.mediaSizeBytes,
          originalName: m.mediaOriginalName,
          thumbBase64: m.mediaThumbBase64,
          available: m.mediaStatus === 'stored',
        }
      : null,
  };
}

function toClientChat(chat) {
  return {
    id: chat.id,
    accountId: chat.accountId,
    type: chat.type,
    displayName: chatDisplayName(chat),
    phoneNumber: chat.phoneNumber,
    profilePictureUrl: chat.profilePictureUrl,
    contact: chat.contact
      ? { id: chat.contact.id, name: contactDisplayName(chat.contact) }
      : null,
    matchSource: chat.matchSource,
    lastMessageAt: chat.lastMessageAt,
    lastMessage: chat.messages?.[0] ? toClientMessage(chat.messages[0]) : null,
  };
}

// Lazy auto-matching: link unmatched private chats to Contacts by normalized
// phone — EXACTLY one owner or nothing (shared numbers stay unmatched for the
// manual inbox). Runs on list reads so new chats/contacts converge without a
// worker; matchSource='phone' keeps it reviewable, and it never touches the
// Contact itself (link-only, reversible).
async function autoMatchChats(chats) {
  const candidates = chats.filter((c) => !c.contactId && c.type === 'private' && c.phoneNumber);
  if (candidates.length === 0) return;
  const phones = await prisma.contactPhone.findMany({ select: { contactId: true, value: true } });
  const index = buildPhoneIndex(phones);
  for (const chat of candidates) {
    const contactId = matchContactId(chat.phoneNumber, index);
    if (!contactId) continue;
    await prisma.whatsAppChat.update({
      where: { id: chat.id },
      data: { contactId, matchSource: 'phone' },
    });
    chat.contactId = contactId;
    chat.matchSource = 'phone';
  }
}

// Chat list for one account (inbox order). ?search= filters by any identity
// facet; ?unmatched=1 keeps only chats without a linked contact.
router.get(
  '/accounts/:id/chats',
  handle(async (req, res) => {
    const accountId = req.params.id;
    const search = String(req.query.search || '').trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 300);
    const where = {
      accountId,
      ...(req.query.unmatched === '1' ? { contactId: null } : {}),
      ...(search
        ? {
            OR: [
              { savedContactName: { contains: search, mode: 'insensitive' } },
              { pushName: { contains: search, mode: 'insensitive' } },
              { groupSubject: { contains: search, mode: 'insensitive' } },
              { phoneNumber: { contains: search.replace(/\D/g, '') || search } },
            ],
          }
        : {}),
    };
    const chats = await prisma.whatsAppChat.findMany({
      where,
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: limit,
      include: {
        contact: { select: CONTACT_LITE_SELECT },
        messages: { orderBy: { timestampFromSource: 'desc' }, take: 1 },
      },
    });
    await autoMatchChats(chats);
    // Re-read the contacts we just linked (cheap: only for newly matched).
    for (const chat of chats) {
      if (chat.contactId && !chat.contact) {
        chat.contact = await prisma.contact.findUnique({
          where: { id: chat.contactId },
          select: CONTACT_LITE_SELECT,
        });
      }
    }
    res.set('Cache-Control', 'no-store');
    res.json(chats.map(toClientChat));
  }),
);

// Chats for a CRM subject (Deal / Contact / Organization page). Resolves the
// subject to its contact ids, proactively links any still-unmatched chats for
// those contacts' phones (same exactly-one rule as autoMatchChats — the deal
// tab must not depend on someone having opened the inbox first), and returns
// every linked chat across ALL accounts (the account rides on each chat so
// the UI can render a number switcher). Link-only, never creates Contacts.
router.get(
  '/context-chats',
  handle(async (req, res) => {
    const subjectType = String(req.query.subjectType || '');
    const subjectId = String(req.query.subjectId || '');
    if (!subjectId) return res.status(400).json({ error: 'subject_required' });

    let contactIds = [];
    if (subjectType === 'deal') {
      const links = await prisma.dealContact.findMany({
        where: { dealId: subjectId },
        select: { contactId: true },
      });
      contactIds = links.map((l) => l.contactId);
    } else if (subjectType === 'contact') {
      contactIds = [subjectId];
    } else if (subjectType === 'organization') {
      const links = await prisma.contactOrganization.findMany({
        where: { organizationId: subjectId },
        select: { contactId: true },
      });
      contactIds = [...new Set(links.map((l) => l.contactId))];
    } else {
      return res.status(400).json({ error: 'unsupported_subject_type' });
    }

    res.set('Cache-Control', 'no-store');
    if (contactIds.length === 0) return res.json({ chats: [] });

    // Proactive matching for THIS subject's phones only (cheap, targeted).
    const ownPhones = await prisma.contactPhone.findMany({
      where: { contactId: { in: contactIds } },
      select: { value: true },
    });
    const wanted = [...new Set(ownPhones.map((p) => normalizePhoneIntl(p.value)).filter(Boolean))];
    if (wanted.length > 0) {
      const candidates = await prisma.whatsAppChat.findMany({
        where: { contactId: null, type: 'private', phoneNumber: { in: wanted } },
        select: { id: true, phoneNumber: true },
      });
      if (candidates.length > 0) {
        const allPhones = await prisma.contactPhone.findMany({
          select: { contactId: true, value: true },
        });
        const index = buildPhoneIndex(allPhones);
        for (const chat of candidates) {
          const contactId = matchContactId(chat.phoneNumber, index);
          if (!contactId) continue; // shared number → stays unmatched
          await prisma.whatsAppChat.update({
            where: { id: chat.id },
            data: { contactId, matchSource: 'phone' },
          });
        }
      }
    }

    const chats = await prisma.whatsAppChat.findMany({
      where: { contactId: { in: contactIds } },
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      include: {
        contact: { select: CONTACT_LITE_SELECT },
        account: { select: { id: true, label: true, status: true } },
        messages: { orderBy: { timestampFromSource: 'desc' }, take: 1 },
      },
    });
    res.json({ chats: chats.map((c) => ({ ...toClientChat(c), account: c.account })) });
  }),
);

router.get(
  '/chats/:chatId',
  handle(async (req, res) => {
    const chat = await prisma.whatsAppChat.findUnique({
      where: { id: req.params.chatId },
      include: {
        contact: { select: CONTACT_LITE_SELECT },
        account: { select: { id: true, label: true } },
      },
    });
    if (!chat) return res.status(404).json({ error: 'not_found' });
    res.set('Cache-Control', 'no-store');
    res.json({ ...toClientChat(chat), account: chat.account });
  }),
);

// Thread page — newest-first, keyset-paged by ?before=<ISO timestamp>. The
// client renders in reverse and asks for the next page when scrolled to the
// top. hasMore tells it whether to keep asking.
router.get(
  '/chats/:chatId/messages',
  handle(async (req, res) => {
    const chat = await prisma.whatsAppChat.findUnique({
      where: { id: req.params.chatId },
      select: { id: true },
    });
    if (!chat) return res.status(404).json({ error: 'not_found' });
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const before = req.query.before ? new Date(String(req.query.before)) : null;
    const messages = await prisma.whatsAppMessage.findMany({
      where: {
        chatId: chat.id,
        ...(before && !Number.isNaN(before.getTime()) ? { timestampFromSource: { lt: before } } : {}),
      },
      orderBy: { timestampFromSource: 'desc' },
      take: limit + 1,
    });
    const hasMore = messages.length > limit;
    res.set('Cache-Control', 'no-store');
    res.json({ messages: messages.slice(0, limit).map(toClientMessage), hasMore });
  }),
);

// Media view/download — mints a short-lived presigned GET for the PRIVATE R2
// object and redirects. Media never sits on a public URL; this admin-authed
// route is the only door.
router.get(
  '/messages/:id/media',
  handle(async (req, res) => {
    const msg = await prisma.whatsAppMessage.findUnique({
      where: { id: req.params.id },
      select: { mediaKey: true, mediaStatus: true },
    });
    if (!msg || msg.mediaStatus !== 'stored' || !msg.mediaKey) {
      return res.status(404).json({ error: 'media_not_available' });
    }
    if (!r2Configured()) return res.status(503).json({ error: 'storage_not_configured' });
    const url = await presignGet({ key: msg.mediaKey, expiresIn: 300 });
    res.set('Cache-Control', 'no-store');
    res.redirect(302, url);
  }),
);

export default router;
