import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { buildPhoneIndex, matchContactId } from '../whatsapp/phone.js';
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

// List accounts — straight from the DB (each bridge keeps its own row live).
// bridgeConfigured tells the UI whether live actions are possible per account.
router.get(
  '/accounts',
  handle(async (_req, res) => {
    const urls = bridgeUrlMap();
    const rows = await prisma.whatsAppAccount.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    res.json(rows.map((r) => ({ ...r, qr: undefined, bridgeConfigured: !!urls[r.id] })));
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
