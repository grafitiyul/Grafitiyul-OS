import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { buildPhoneIndex, matchContactId, normalizePhoneIntl } from '../whatsapp/phone.js';
import { bridgeUrlMap, callBridge } from '../whatsapp/bridgeClient.js';
import { isConfigured as r2Configured, presignGet } from '../r2.js';
import {
  markTaskNotSentByScheduled,
  createWhatsappTaskForScheduledMessage,
  syncTaskFromScheduledEdit,
} from '../tasks/taskService.js';
import { dealsForContact, classifyDealsForContact } from '../crm/dealResolution.js';

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

function toClientMessage(m, reactions = null) {
  return {
    id: m.id,
    externalMessageId: m.externalMessageId,
    direction: m.direction,
    messageType: m.messageType,
    textContent: m.textContent,
    senderName: m.senderName,
    senderPhone: m.senderPhone,
    quotedExternalId: m.quotedExternalId,
    timestampFromSource: m.timestampFromSource,
    deliveryStatus: m.deliveryStatus ?? null,
    starred: !!m.starredAt,
    ...(reactions ? { reactions } : {}),
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
    pinnedAt: chat.pinnedAt ?? null,
    snoozedUntil: chat.snoozedUntil ?? null,
    snoozedAt: chat.snoozedAt ?? null,
    lastMessage: chat.messages?.[0] ? toClientMessage(chat.messages[0]) : null,
  };
}

// Gmail-style snooze visibility: a snoozed chat is hidden until snoozedUntil,
// but wakes EARLY if a new message arrived after the snooze was set.
function isSnoozedNow(chat, now = new Date()) {
  if (!chat.snoozedUntil || chat.snoozedUntil <= now) return false;
  if (chat.snoozedAt && chat.lastMessageAt && chat.lastMessageAt > chat.snoozedAt) return false;
  return true;
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
    let primaryContactId = null;
    if (subjectType === 'deal') {
      const links = await prisma.dealContact.findMany({
        where: { dealId: subjectId },
        select: { contactId: true, isPrimary: true },
        orderBy: { createdAt: 'asc' },
      });
      contactIds = links.map((l) => l.contactId);
      primaryContactId = links.find((l) => l.isPrimary)?.contactId ?? links[0]?.contactId ?? null;
    } else if (subjectType === 'contact') {
      contactIds = [subjectId];
      primaryContactId = subjectId;
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
    if (contactIds.length === 0) return res.json({ chats: [], contacts: [], primaryContactId: null });

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
    // The subject's FULL contact list (not just contacts that already have a
    // chat) — the Deal panel shows a tab per contact, including ones with no
    // WhatsApp thread yet. Order: primary first, then linkage order.
    const contactRows = await prisma.contact.findMany({
      where: { id: { in: contactIds } },
      select: CONTACT_LITE_SELECT,
    });
    const byId = new Map(contactRows.map((c) => [c.id, c]));
    const contacts = contactIds
      .filter((id) => byId.has(id))
      .sort((a, b) => (a === primaryContactId ? -1 : 0) - (b === primaryContactId ? -1 : 0))
      .map((id) => ({
        id,
        name: contactDisplayName(byId.get(id)) || '—',
        isPrimary: id === primaryContactId,
      }));
    res.json({
      chats: chats.map((c) => ({ ...toClientChat(c), account: c.account, contactId: c.contactId })),
      contacts,
      primaryContactId,
    });
  }),
);

// ── Active WhatsApp inbox (Slice 8+) ────────────────────────────────────────
// The working CRM inbox: ALL private conversations (matched and unmatched),
// filterable per account, newest first. The lazy auto-matcher runs on the
// unmatched subset first so anything trivially matchable links itself before
// an admin ever sees it. ?unmatched=1 narrows to the repair view.
router.get(
  '/inbox-chats',
  handle(async (req, res) => {
    const search = String(req.query.search || '').trim();
    const accountId = String(req.query.accountId || '').trim();
    // Scope: 'active' (default work queue — linked conversations + unknown
    // ones with recent activity), 'unmatched' (repair view), 'all'.
    // Legacy unmatched=1 maps to 'unmatched'.
    const scope = req.query.unmatched === '1' ? 'unmatched' : String(req.query.scope || 'active');
    // Kind: 'private' (default — the CRM workflow), 'group', 'all'. Groups
    // are read/reply conversations only: they are NEVER auto-matched, never
    // linked to Contacts (PUT /link rejects them), and never resolve deals.
    const kind = ['group', 'all'].includes(String(req.query.kind || '')) ? String(req.query.kind) : 'private';
    const typeWhere = kind === 'all' ? { type: { in: ['private', 'group'] } } : { type: kind };
    const preliminary = await prisma.whatsAppChat.findMany({
      where: { contactId: null, type: 'private' },
      select: { id: true, contactId: true, type: true, phoneNumber: true },
    });
    await autoMatchChats(preliminary);
    const RECENT_UNKNOWN_DAYS = 30;
    const recentCutoff = new Date(Date.now() - RECENT_UNKNOWN_DAYS * 86_400_000);
    const scopeWhere =
      scope === 'unmatched'
        ? { contactId: null }
        : scope === 'active'
          ? { OR: [{ contactId: { not: null } }, { lastMessageAt: { gte: recentCutoff } }] }
          : {};
    const searchWhere = search
      ? {
          OR: [
            { savedContactName: { contains: search, mode: 'insensitive' } },
            { pushName: { contains: search, mode: 'insensitive' } },
            { groupSubject: { contains: search, mode: 'insensitive' } },
            { phoneNumber: { contains: search.replace(/\D/g, '') || search } },
            {
              contact: {
                OR: [
                  { firstNameHe: { contains: search, mode: 'insensitive' } },
                  { lastNameHe: { contains: search, mode: 'insensitive' } },
                  { firstNameEn: { contains: search, mode: 'insensitive' } },
                  { lastNameEn: { contains: search, mode: 'insensitive' } },
                ],
              },
            },
          ],
        }
      : null;
    const chatsRaw = await prisma.whatsAppChat.findMany({
      where: {
        ...typeWhere,
        ...(accountId ? { accountId } : {}),
        // Both blocks are OR-shaped — combine under AND so they never
        // clobber each other on the same object key.
        AND: [scopeWhere, ...(searchWhere ? [searchWhere] : [])],
      },
      // Pinned chats float to the top, then the usual recency order.
      orderBy: [
        { pinnedAt: { sort: 'desc', nulls: 'last' } },
        { lastMessageAt: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
      ],
      take: 200,
      include: {
        contact: { select: CONTACT_LITE_SELECT },
        account: { select: { id: true, label: true } },
        messages: { orderBy: { timestampFromSource: 'desc' }, take: 1 },
      },
    });
    // Snoozed chats leave the active work queue (until they wake); they stay
    // findable under 'all', in search, and in the unmatched repair view.
    const chats =
      scope === 'active' && !search ? chatsRaw.filter((c) => !isSnoozedNow(c)) : chatsRaw;
    const unmatchedCount = await prisma.whatsAppChat.count({
      where: { contactId: null, type: 'private', ...(accountId ? { accountId } : {}) },
    });
    // Attach the CONFIDENTLY-resolved deal per linked conversation (same
    // exactly-one candidate rule as deal-resolution: open deals + WON deals
    // toured ≤7 days ago) so the row can show the deal's activity type.
    const linkedContactIds = [...new Set(chats.map((c) => c.contactId).filter(Boolean))];
    const dealByContact = new Map();
    if (linkedContactIds.length) {
      const links = await prisma.dealContact.findMany({
        where: { contactId: { in: linkedContactIds } },
        select: { contactId: true, dealId: true },
      });
      const dealIds = [...new Set(links.map((l) => l.dealId))];
      const deals = dealIds.length
        ? await prisma.deal.findMany({
            where: { id: { in: dealIds } },
            select: {
              id: true,
              title: true,
              status: true,
              tourDate: true,
              activityType: true,
              organizationTypeId: true,
              organizationSubtypeId: true,
              organizationId: true,
            },
          })
        : [];
      // Resolve the SPECIFIC classification labels the same way the Deal header
      // does: effective org type = the deal's own type OR its organization's
      // default. Batched id-lookups only (no nested relation includes).
      const orgIds = [...new Set(deals.map((d) => d.organizationId).filter(Boolean))];
      const orgs = orgIds.length
        ? await prisma.organization.findMany({
            where: { id: { in: orgIds } },
            select: { id: true, organizationTypeId: true },
          })
        : [];
      const orgTypeIdByOrg = new Map(orgs.map((o) => [o.id, o.organizationTypeId]));
      const effTypeIdFor = (d) => d.organizationTypeId || orgTypeIdByOrg.get(d.organizationId) || null;
      const typeIds = [...new Set(deals.map(effTypeIdFor).filter(Boolean))];
      const subtypeIds = [...new Set(deals.map((d) => d.organizationSubtypeId).filter(Boolean))];
      const [types, subtypes] = await Promise.all([
        typeIds.length
          ? prisma.organizationType.findMany({ where: { id: { in: typeIds } }, select: { id: true, label: true } })
          : [],
        subtypeIds.length
          ? prisma.organizationSubtype.findMany({ where: { id: { in: subtypeIds } }, select: { id: true, label: true } })
          : [],
      ]);
      const typeLabel = new Map(types.map((t) => [t.id, t.label]));
      const subtypeLabel = new Map(subtypes.map((s) => [s.id, s.label]));

      const dealById = new Map(deals.map((d) => [d.id, d]));
      const byContact = new Map();
      for (const l of links) {
        const d = dealById.get(l.dealId);
        if (!d) continue;
        if (!byContact.has(l.contactId)) byContact.set(l.contactId, []);
        byContact.get(l.contactId).push(d);
      }
      const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
      for (const [cid, ds] of byContact) {
        const candidates = ds.filter(
          (d) => d.status === 'open' || (d.status === 'won' && d.tourDate && d.tourDate >= sevenDaysAgo),
        );
        if (candidates.length === 1) {
          const d = candidates[0];
          dealByContact.set(cid, {
            id: d.id,
            title: d.title,
            activityType: d.activityType,
            orgTypeLabel: typeLabel.get(effTypeIdFor(d)) ?? null,
            subtypeLabel: d.organizationSubtypeId ? subtypeLabel.get(d.organizationSubtypeId) ?? null : null,
          });
        }
      }
    }
    res.set('Cache-Control', 'no-store');
    res.json({
      chats: chats.map((c) => ({
        ...toClientChat(c),
        account: c.account,
        deal: c.contactId ? dealByContact.get(c.contactId) ?? null : null,
      })),
      unmatchedCount,
    });
  }),
);

// Which Deal does this conversation belong to? Deterministic when confident,
// asks when not (per product spec):
//   no linked contact              → no_contact (client confirms create)
//   exactly ONE candidate          → open       (candidates = open deals +
//                                                WON deals toured ≤7 days ago)
//   several candidates             → choose
//   contact with no deals at all   → no_deals   (client confirms new deal)
//   only stale LOST/old-WON deals  → old_or_new
// dealSummary / dealsForContact / classifyDealsForContact moved to
// ../crm/dealResolution.js — SHARED with the Email module (one source of truth
// for "which Deal does this conversation belong to?").

router.get(
  '/chats/:chatId/deal-resolution',
  handle(async (req, res) => {
    try {
    const chat = await prisma.whatsAppChat.findUnique({
      where: { id: req.params.chatId },
      include: { contact: { select: CONTACT_LITE_SELECT } },
    });
    if (!chat) return res.status(404).json({ error: 'not_found' });
    res.set('Cache-Control', 'no-store');
    if (!chat.contactId) {
      return res.json({
        kind: 'no_contact',
        suggestedName: chat.savedContactName || chat.pushName || chat.phoneNumber || null,
      });
    }
    const contactName = contactDisplayName(chat.contact);
    const deals = await dealsForContact(chat.contactId);
    const outcome = classifyDealsForContact(deals);
    if (outcome.kind === 'open') return res.json({ kind: 'open', dealId: outcome.dealId });
    return res.json({ ...outcome, contactName });
    } catch (err) {
      // Surfaced explicitly (not just the generic 500) so a live failure names
      // itself in the UI and in the Railway logs.
      console.error('[whatsapp] deal-resolution failed:', err);
      return res.status(500).json({ error: 'deal_resolution_failed', detail: err?.message?.slice(0, 300) });
    }
  }),
);

// Create the Contact (when missing) and/or a fresh Deal from a conversation —
// ONLY ever called after the user confirmed in the UI (the no-auto-create
// rule holds: this endpoint IS the confirmation's effect).
router.post(
  '/chats/:chatId/open-deal',
  handle(async (req, res) => {
    try {
    const chat = await prisma.whatsAppChat.findUnique({
      where: { id: req.params.chatId },
      include: { contact: { select: CONTACT_LITE_SELECT } },
    });
    if (!chat) return res.status(404).json({ error: 'not_found' });
    if (chat.type !== 'private') return res.status(400).json({ error: 'group_not_supported' });

    let contactId = chat.contactId;
    let displayName = contactDisplayName(chat.contact);
    if (!contactId) {
      // The creation dialog sends the (user-edited) contact details; server-
      // side inference from the WhatsApp identity remains the fallback.
      const b = req.body || {};
      const s = (v) => (typeof v === 'string' ? v.trim() : '');
      let firstNameHe = s(b.firstNameHe);
      let lastNameHe = s(b.lastNameHe);
      const firstNameEn = s(b.firstNameEn);
      const lastNameEn = s(b.lastNameEn);
      if (!firstNameHe && !firstNameEn) {
        const rawName = (chat.savedContactName || chat.pushName || '').trim();
        const [first, ...rest] = rawName.split(/\s+/).filter(Boolean);
        firstNameHe = first || chat.phoneNumber || 'WhatsApp';
        lastNameHe = rest.join(' ');
      }
      const phone = s(b.phone) || chat.phoneNumber || null;
      const communicationLanguage = ['he', 'en'].includes(b.communicationLanguage)
        ? b.communicationLanguage
        : null;
      const contact = await prisma.contact.create({
        data: {
          // All four name columns are REQUIRED (empty string is the schema's
          // "not set" convention, same as the contacts module).
          firstNameHe,
          lastNameHe,
          firstNameEn,
          lastNameEn,
          communicationLanguage,
          ...(phone
            ? { phones: { create: { value: phone, isPrimary: true, label: 'WhatsApp' } } }
            : {}),
        },
        select: { id: true, firstNameHe: true, lastNameHe: true, firstNameEn: true, lastNameEn: true },
      });
      contactId = contact.id;
      displayName =
        `${contact.firstNameHe} ${contact.lastNameHe}`.trim() ||
        `${contact.firstNameEn} ${contact.lastNameEn}`.trim();
      await prisma.whatsAppChat.update({
        where: { id: chat.id },
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
        title: displayName || chat.phoneNumber || 'שיחת WhatsApp',
        dealStageId: firstStage.id,
        status: 'open',
        contacts: { create: { contactId, isPrimary: true } },
      },
      select: { id: true },
    });
    res.status(201).json({ dealId: deal.id, contactId });
    } catch (err) {
      console.error('[whatsapp] open-deal failed:', err);
      return res.status(500).json({ error: 'open_deal_failed', detail: err?.message?.slice(0, 300) });
    }
  }),
);

// Manual link / unlink (Slice 8). Link-only, reversible: sets the chat's
// contactId (matchSource='manual') or clears it — the Contact itself is
// NEVER created or modified from WhatsApp.
router.put(
  '/chats/:chatId/link',
  handle(async (req, res) => {
    const chat = await prisma.whatsAppChat.findUnique({
      where: { id: req.params.chatId },
      select: { id: true, type: true },
    });
    if (!chat) return res.status(404).json({ error: 'not_found' });
    const contactId = req.body?.contactId ?? null;
    if (contactId === null) {
      const row = await prisma.whatsAppChat.update({
        where: { id: chat.id },
        data: { contactId: null, matchSource: null },
        include: { contact: { select: CONTACT_LITE_SELECT } },
      });
      return res.json(toClientChat(row));
    }
    if (chat.type !== 'private') return res.status(400).json({ error: 'group_not_linkable' });
    const contact = await prisma.contact.findUnique({ where: { id: String(contactId) }, select: { id: true } });
    if (!contact) return res.status(400).json({ error: 'contact_not_found' });
    const row = await prisma.whatsAppChat.update({
      where: { id: chat.id },
      data: { contactId: contact.id, matchSource: 'manual' },
      include: { contact: { select: CONTACT_LITE_SELECT } },
    });
    res.json(toClientChat(row));
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
// Attach reactions to a serialized page — reactions are keyed by the
// EXTERNAL message id (they can arrive before/without the target row).
async function reactionsFor(accountId, rows) {
  const extIds = rows.map((m) => m.externalMessageId).filter(Boolean);
  if (extIds.length === 0) return new Map();
  const reactions = await prisma.whatsAppMessageReaction.findMany({
    where: { accountId, externalMessageId: { in: extIds } },
    select: { externalMessageId: true, emoji: true, reactorPhone: true },
  });
  const byExt = new Map();
  for (const r of reactions) {
    if (!r.emoji) continue; // empty emoji = reaction removed
    if (!byExt.has(r.externalMessageId)) byExt.set(r.externalMessageId, []);
    byExt.get(r.externalMessageId).push({ emoji: r.emoji, reactorPhone: r.reactorPhone });
  }
  return byExt;
}

function serializePage(accountId, rows) {
  return reactionsFor(accountId, rows).then((byExt) =>
    rows.map((m) => toClientMessage(m, m.externalMessageId ? byExt.get(m.externalMessageId) ?? [] : [])),
  );
}

router.get(
  '/chats/:chatId/messages',
  handle(async (req, res) => {
    const chat = await prisma.whatsAppChat.findUnique({
      where: { id: req.params.chatId },
      select: { id: true, accountId: true },
    });
    if (!chat) return res.status(404).json({ error: 'not_found' });
    res.set('Cache-Control', 'no-store');
    // Count mode (?count=1&after=ISO): number of INCOMING messages newer than
    // `after` — powers the unread badge straight from the message store.
    if (req.query.count === '1') {
      const after = req.query.after ? new Date(String(req.query.after)) : null;
      const count = await prisma.whatsAppMessage.count({
        where: {
          chatId: chat.id,
          direction: 'incoming',
          ...(after && !Number.isNaN(after.getTime()) ? { timestampFromSource: { gt: after } } : {}),
        },
      });
      return res.json({ count });
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    // Search mode (?search=q): match text content, newest first — powers
    // search-inside-conversation. Results are jump anchors, not a page.
    const search = String(req.query.search || '').trim();
    if (search) {
      const matches = await prisma.whatsAppMessage.findMany({
        where: { chatId: chat.id, textContent: { contains: search, mode: 'insensitive' } },
        orderBy: { timestampFromSource: 'desc' },
        take: Math.min(limit, 30),
      });
      return res.json({ messages: await serializePage(chat.accountId, matches), hasMore: false });
    }
    // Forward paging (?after=ISO, ascending) — fills the window downward
    // after a jump-to-date / jump-to-message. Default is backward (?before=).
    const after = req.query.after ? new Date(String(req.query.after)) : null;
    if (after && !Number.isNaN(after.getTime())) {
      const rows = await prisma.whatsAppMessage.findMany({
        where: { chatId: chat.id, timestampFromSource: { gt: after } },
        orderBy: { timestampFromSource: 'asc' },
        take: limit + 1,
      });
      const hasMore = rows.length > limit;
      return res.json({ messages: await serializePage(chat.accountId, rows.slice(0, limit)), hasMore });
    }
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
    res.json({ messages: await serializePage(chat.accountId, messages.slice(0, limit)), hasMore });
  }),
);

// Pin / snooze — team-level inbox workflow state on the chat row. Both are
// display-state only (never touch messages/contacts); reversible.
router.put(
  '/chats/:chatId/state',
  handle(async (req, res) => {
    const chat = await prisma.whatsAppChat.findUnique({
      where: { id: req.params.chatId },
      select: { id: true, pinnedAt: true },
    });
    if (!chat) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    const data = {};
    if (b.pinned !== undefined) {
      data.pinnedAt = b.pinned ? chat.pinnedAt ?? new Date() : null;
    }
    if (b.snoozedUntil !== undefined) {
      if (b.snoozedUntil === null) {
        data.snoozedUntil = null;
        data.snoozedAt = null;
      } else {
        const until = new Date(String(b.snoozedUntil));
        if (Number.isNaN(until.getTime()) || until.getTime() < Date.now() + 30_000) {
          return res.status(400).json({ error: 'snoozed_until_invalid' });
        }
        data.snoozedUntil = until;
        data.snoozedAt = new Date();
      }
    }
    if (Object.keys(data).length === 0) return res.status(400).json({ error: 'nothing_to_update' });
    const row = await prisma.whatsAppChat.update({
      where: { id: chat.id },
      data,
      include: { contact: { select: CONTACT_LITE_SELECT } },
    });
    res.json(toClientChat(row));
  }),
);

// Star / unstar one message (team-level bookmark).
router.put(
  '/messages/:id/star',
  handle(async (req, res) => {
    const msg = await prisma.whatsAppMessage.findUnique({
      where: { id: req.params.id },
      select: { id: true, starredAt: true },
    });
    if (!msg) return res.status(404).json({ error: 'not_found' });
    const starred = !!req.body?.starred;
    const row = await prisma.whatsAppMessage.update({
      where: { id: msg.id },
      data: { starredAt: starred ? msg.starredAt ?? new Date() : null },
    });
    res.json(toClientMessage(row));
  }),
);

// Starred messages of one chat, newest first — the ⭐ panel in the thread.
router.get(
  '/chats/:chatId/starred',
  handle(async (req, res) => {
    const chat = await prisma.whatsAppChat.findUnique({
      where: { id: req.params.chatId },
      select: { id: true, accountId: true },
    });
    if (!chat) return res.status(404).json({ error: 'not_found' });
    const rows = await prisma.whatsAppMessage.findMany({
      where: { chatId: chat.id, starredAt: { not: null } },
      orderBy: { timestampFromSource: 'desc' },
      take: 100,
    });
    res.set('Cache-Control', 'no-store');
    res.json({ messages: await serializePage(chat.accountId, rows) });
  }),
);

// Send a text message into an existing chat (Slice 6, text-only V1).
// clientKey (a UUID the composer generates per logical message) becomes the
// bridge idempotency key — a network retry of the SAME message replays the
// recorded outcome instead of double-messaging the customer. Never marks
// anything else (no Deal/Contact side effects).
router.post(
  '/chats/:chatId/send',
  handle(async (req, res) => {
    const b = req.body || {};
    const text = typeof b.text === 'string' ? b.text.trim() : '';
    const clientKey = typeof b.clientKey === 'string' ? b.clientKey.trim() : '';
    if (!text) return res.status(400).json({ error: 'text_required' });
    if (!clientKey || clientKey.length > 100) return res.status(400).json({ error: 'client_key_required' });

    const chat = await prisma.whatsAppChat.findUnique({
      where: { id: req.params.chatId },
      select: { id: true, accountId: true, externalChatId: true, type: true },
    });
    if (!chat) return res.status(404).json({ error: 'not_found' });

    // Reply context: reconstruct from the quoted row (must belong to this
    // chat). participant (group sender) rides in the sanitised rawPayload.
    let quoted = null;
    if (b.quotedMessageId) {
      const q = await prisma.whatsAppMessage.findUnique({
        where: { id: String(b.quotedMessageId) },
        select: { chatId: true, externalMessageId: true, direction: true, textContent: true, messageType: true, rawPayload: true },
      });
      if (!q || q.chatId !== chat.id || !q.externalMessageId) {
        return res.status(400).json({ error: 'quoted_message_invalid' });
      }
      quoted = {
        externalId: q.externalMessageId,
        fromMe: q.direction === 'outgoing',
        participant: chat.type === 'group' ? q.rawPayload?.key?.participant || null : null,
        text: q.textContent || '',
      };
    }

    try {
      const data = await callBridge(chat.accountId, '/send', {
        method: 'POST',
        timeoutMs: 25_000,
        body: {
          jid: chat.externalChatId,
          text,
          quoted,
          idempotencyKey: `gos-${chat.id}-${clientKey}`,
        },
      });
      // Return the mirrored row when the bridge already persisted it, so the
      // composer can append instantly (poll covers the echo-only case).
      let message = null;
      if (data?.externalMessageId) {
        const row = await prisma.whatsAppMessage.findUnique({
          where: {
            accountId_externalMessageId: {
              accountId: chat.accountId,
              externalMessageId: data.externalMessageId,
            },
          },
        });
        if (row) message = toClientMessage(row);
      }
      res.json({ ok: true, externalMessageId: data?.externalMessageId ?? null, message });
    } catch (err) {
      if (err?.code === 'bridge_not_configured') {
        return res.status(503).json({ error: 'bridge_not_configured' });
      }
      if (err?.code === 'bridge_error' && err.data?.error) {
        // Pass the bridge's send taxonomy through with its status.
        return res.status(err.status || 500).json({ error: err.data.error });
      }
      return res.status(502).json({ error: 'bridge_unreachable' });
    }
  }),
);

// Send a voice note recorded in the composer. Same idempotency contract as
// text (clientKey per recording); the bridge transcodes to OGG/Opus (real
// WhatsApp PTT), sends serialized, and stores our copy in R2.
router.post(
  '/chats/:chatId/send-voice',
  handle(async (req, res) => {
    const b = req.body || {};
    const audioBase64 = typeof b.audioBase64 === 'string' ? b.audioBase64 : '';
    const clientKey = typeof b.clientKey === 'string' ? b.clientKey.trim() : '';
    if (!audioBase64 || audioBase64.length > 22_000_000) {
      return res.status(400).json({ error: 'audio_invalid' });
    }
    if (!clientKey || clientKey.length > 100) return res.status(400).json({ error: 'client_key_required' });
    const chat = await prisma.whatsAppChat.findUnique({
      where: { id: req.params.chatId },
      select: { id: true, accountId: true, externalChatId: true },
    });
    if (!chat) return res.status(404).json({ error: 'not_found' });
    try {
      const data = await callBridge(chat.accountId, '/send-voice', {
        method: 'POST',
        timeoutMs: 60_000, // transcode + upload + send
        body: {
          jid: chat.externalChatId,
          audioBase64,
          mimeType: typeof b.mimeType === 'string' ? b.mimeType : '',
          seconds: Number(b.seconds) || null,
          idempotencyKey: `gos-voice-${chat.id}-${clientKey}`,
        },
      });
      let message = null;
      if (data?.externalMessageId) {
        const row = await prisma.whatsAppMessage.findUnique({
          where: {
            accountId_externalMessageId: {
              accountId: chat.accountId,
              externalMessageId: data.externalMessageId,
            },
          },
        });
        if (row) message = toClientMessage(row);
      }
      res.json({ ok: true, externalMessageId: data?.externalMessageId ?? null, message });
    } catch (err) {
      if (err?.code === 'bridge_not_configured') {
        return res.status(503).json({ error: 'bridge_not_configured' });
      }
      if (err?.code === 'bridge_error' && err.data?.error) {
        return res.status(err.status || 500).json({ error: err.data.error });
      }
      return res.status(502).json({ error: 'bridge_unreachable' });
    }
  }),
);

// Send an attachment (image / video / document) from the composer. Same
// idempotency contract (clientKey per attachment); the bridge sends real
// WhatsApp media and stores our copy in R2.
router.post(
  '/chats/:chatId/send-media',
  handle(async (req, res) => {
    const b = req.body || {};
    const mediaBase64 = typeof b.mediaBase64 === 'string' ? b.mediaBase64 : '';
    const clientKey = typeof b.clientKey === 'string' ? b.clientKey.trim() : '';
    const kind = typeof b.kind === 'string' ? b.kind : '';
    if (!mediaBase64 || mediaBase64.length > 22_000_000) {
      return res.status(400).json({ error: 'media_invalid' });
    }
    if (!['image', 'video', 'document'].includes(kind)) return res.status(400).json({ error: 'kind_invalid' });
    if (!clientKey || clientKey.length > 100) return res.status(400).json({ error: 'client_key_required' });
    const chat = await prisma.whatsAppChat.findUnique({
      where: { id: req.params.chatId },
      select: { id: true, accountId: true, externalChatId: true },
    });
    if (!chat) return res.status(404).json({ error: 'not_found' });
    try {
      const data = await callBridge(chat.accountId, '/send-media', {
        method: 'POST',
        timeoutMs: 90_000, // upload to WhatsApp can take a while for videos
        body: {
          jid: chat.externalChatId,
          mediaBase64,
          mimeType: typeof b.mimeType === 'string' ? b.mimeType : '',
          fileName: typeof b.fileName === 'string' ? b.fileName : '',
          kind,
          caption: typeof b.caption === 'string' ? b.caption : '',
          idempotencyKey: `gos-media-${chat.id}-${clientKey}`,
        },
      });
      let message = null;
      if (data?.externalMessageId) {
        const row = await prisma.whatsAppMessage.findUnique({
          where: {
            accountId_externalMessageId: {
              accountId: chat.accountId,
              externalMessageId: data.externalMessageId,
            },
          },
        });
        if (row) message = toClientMessage(row);
      }
      res.json({ ok: true, externalMessageId: data?.externalMessageId ?? null, message });
    } catch (err) {
      if (err?.code === 'bridge_not_configured') {
        return res.status(503).json({ error: 'bridge_not_configured' });
      }
      if (err?.code === 'bridge_error' && err.data?.error) {
        return res.status(err.status || 500).json({ error: err.data.error });
      }
      return res.status(502).json({ error: 'bridge_unreachable' });
    }
  }),
);

// ── Scheduled messages (Slice 7, text-only V1) ─────────────────────────────
// The claim-based worker in whatsapp/scheduledWorker.js does the sending; the
// routes only manage rows. All mutations are guarded updateMany against the
// row's status, so an admin action can never race a send in progress — the
// API answers 409 instead of pretending.

function toClientScheduled(s) {
  return {
    id: s.id,
    chatId: s.chatId,
    content: s.content,
    scheduledAt: s.scheduledAt,
    status: s.status,
    attemptCount: s.attemptCount,
    failureReason: s.failureReason,
    sentAt: s.sentAt,
    createdAt: s.createdAt,
  };
}

router.post(
  '/chats/:chatId/scheduled',
  handle(async (req, res) => {
    const b = req.body || {};
    const text = typeof b.text === 'string' ? b.text.trim() : '';
    const scheduledAt = b.scheduledAt ? new Date(String(b.scheduledAt)) : null;
    if (!text) return res.status(400).json({ error: 'text_required' });
    if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
      return res.status(400).json({ error: 'scheduled_at_invalid' });
    }
    if (scheduledAt.getTime() < Date.now() + 30_000) {
      return res.status(400).json({ error: 'scheduled_at_past' });
    }
    const chat = await prisma.whatsAppChat.findUnique({
      where: { id: req.params.chatId },
      select: { id: true, accountId: true },
    });
    if (!chat) return res.status(404).json({ error: 'not_found' });

    // Deal context (scheduled from the Deal WhatsApp panel): also create a linked
    // WhatsApp Task so it shows in the Deal focus area with the shared lifecycle.
    // dueDate/dueTime are the user's LOCAL wall-clock (the client splits its
    // datetime picker); scheduledAt is the tz-correct instant.
    const dealId = typeof b.dealId === 'string' ? b.dealId.trim() : '';
    const ownerUserId = req.adminAuth?.userId || null;
    let deal = null;
    if (dealId && ownerUserId) {
      deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { id: true } });
    }

    if (deal) {
      const row = await prisma.$transaction(async (tx) => {
        const sched = await tx.whatsAppScheduledMessage.create({
          data: { accountId: chat.accountId, chatId: chat.id, content: text, scheduledAt, createdById: ownerUserId },
        });
        await createWhatsappTaskForScheduledMessage(tx, {
          dealId: deal.id,
          scheduledMessageId: sched.id,
          chatId: chat.id,
          accountId: chat.accountId,
          title: text,
          dueDate: b.dueDate ? new Date(String(b.dueDate)) : scheduledAt,
          dueTime: typeof b.dueTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(b.dueTime) ? b.dueTime : null,
          ownerUserId,
          createdByUserId: ownerUserId,
        });
        return sched;
      });
      return res.status(201).json(toClientScheduled(row));
    }

    const row = await prisma.whatsAppScheduledMessage.create({
      data: {
        accountId: chat.accountId,
        chatId: chat.id,
        content: text,
        scheduledAt,
        createdById: ownerUserId,
      },
    });
    res.status(201).json(toClientScheduled(row));
  }),
);

// Upcoming + recently-problematic rows for one chat (the thread strip).
router.get(
  '/chats/:chatId/scheduled',
  handle(async (req, res) => {
    const rows = await prisma.whatsAppScheduledMessage.findMany({
      where: { chatId: req.params.chatId, status: { in: ['pending', 'sending', 'failed', 'skipped'] } },
      orderBy: { scheduledAt: 'asc' },
      take: 50,
    });
    res.set('Cache-Control', 'no-store');
    res.json(rows.map(toClientScheduled));
  }),
);

// Cancel — only while still pending/failed/skipped; a row mid-send conflicts.
router.post(
  '/scheduled/:id/cancel',
  handle(async (req, res) => {
    const row = await prisma.whatsAppScheduledMessage.findUnique({
      where: { id: req.params.id },
      select: { taskId: true },
    });
    const updated = await prisma.whatsAppScheduledMessage.updateMany({
      where: { id: req.params.id, status: { in: ['pending', 'failed', 'skipped'] } },
      data: { status: 'cancelled', claimedAt: null, claimedBy: null, nextRetryAt: null },
    });
    if (updated.count === 0) return res.status(409).json({ error: 'not_cancellable' });
    // If a CRM Task scheduled this message, cancelling it here (from the thread's
    // scheduled strip) moves the linked task to 'not_sent' so both surfaces agree.
    if (row?.taskId) await markTaskNotSentByScheduled(row.taskId);
    res.json({ ok: true });
  }),
);

// Edit (content and/or time) — resets the retry state so the row is judged
// fresh. Content edits are allowed on PENDING rows only (a sent/failed/
// cancelled message keeps its audit trail); a time-only change may also
// re-arm a failed/skipped row. A row mid-send conflicts (409).
router.put(
  '/scheduled/:id',
  handle(async (req, res) => {
    const b = req.body || {};
    const data = { status: 'pending', attemptCount: 0, nextRetryAt: null, failureReason: null, claimedAt: null, claimedBy: null };
    if (b.scheduledAt !== undefined) {
      const scheduledAt = new Date(String(b.scheduledAt));
      if (Number.isNaN(scheduledAt.getTime())) return res.status(400).json({ error: 'scheduled_at_invalid' });
      if (scheduledAt.getTime() < Date.now() + 30_000) return res.status(400).json({ error: 'scheduled_at_past' });
      data.scheduledAt = scheduledAt;
    }
    if (b.text !== undefined) {
      const text = String(b.text).trim();
      if (!text) return res.status(400).json({ error: 'text_required' });
      data.content = text;
    }
    const allowedStatuses = b.text !== undefined ? ['pending'] : ['pending', 'failed', 'skipped'];
    const updated = await prisma.whatsAppScheduledMessage.updateMany({
      where: { id: req.params.id, status: { in: allowedStatuses } },
      data,
    });
    if (updated.count === 0) return res.status(409).json({ error: 'not_editable' });
    const row = await prisma.whatsAppScheduledMessage.findUnique({ where: { id: req.params.id } });
    // Keep the linked CRM Task's due date/time (and title) in lockstep — the two
    // must never drift. dueDate/dueTime are the client's LOCAL wall-clock parts.
    if (row?.taskId) {
      await syncTaskFromScheduledEdit(row.taskId, {
        dueDate: typeof b.dueDate === 'string' ? b.dueDate : undefined,
        dueTime: typeof b.dueTime === 'string' ? b.dueTime : undefined,
        title: b.text !== undefined ? String(b.text) : undefined,
      });
    }
    res.json(toClientScheduled(row));
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
