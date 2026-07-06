import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { buildPhoneIndex, matchContactId, normalizePhoneIntl } from '../whatsapp/phone.js';
import { bridgeUrlMap, callBridge } from '../whatsapp/bridgeClient.js';
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
    externalMessageId: m.externalMessageId,
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
    const chats = await prisma.whatsAppChat.findMany({
      where: {
        type: 'private',
        ...(accountId ? { accountId } : {}),
        // Both blocks are OR-shaped — combine under AND so they never
        // clobber each other on the same object key.
        AND: [scopeWhere, ...(searchWhere ? [searchWhere] : [])],
      },
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 200,
      include: {
        contact: { select: CONTACT_LITE_SELECT },
        account: { select: { id: true, label: true } },
        messages: { orderBy: { timestampFromSource: 'desc' }, take: 1 },
      },
    });
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
            select: { id: true, title: true, status: true, tourDate: true, activityType: true },
          })
        : [];
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
          dealByContact.set(cid, {
            id: candidates[0].id,
            title: candidates[0].title,
            activityType: candidates[0].activityType,
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
function dealSummary(d) {
  return {
    id: d.id,
    title: d.title,
    status: d.status,
    tourDate: d.tourDate,
    organizationName: d.organizationName ?? null,
    valueMinor: d.valueMinor,
    stageName: d.stageName ?? null,
  };
}

// The deals a contact is linked to, enriched with stage/org names. Written
// WITHOUT nested relation includes on purpose — the production Prisma client
// rejected `include.deal.include.dealStage` ("Unknown argument dealStage")
// even though the same query validates locally; plain scalar selects + two
// id-lookups are immune to that class of failure.
async function dealsForContact(contactId) {
  const rows = await prisma.deal.findMany({
    where: { contacts: { some: { contactId } } },
    select: {
      id: true,
      title: true,
      status: true,
      tourDate: true,
      valueMinor: true,
      dealStageId: true,
      organizationId: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  if (rows.length === 0) return [];
  const stageIds = [...new Set(rows.map((d) => d.dealStageId).filter(Boolean))];
  const orgIds = [...new Set(rows.map((d) => d.organizationId).filter(Boolean))];
  const [stages, orgs] = await Promise.all([
    stageIds.length
      ? // DealStage has label/labelEn — NOT name (live-QA Prisma error).
        prisma.dealStage.findMany({ where: { id: { in: stageIds } }, select: { id: true, label: true } })
      : [],
    orgIds.length
      ? prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } })
      : [],
  ]);
  const stageName = new Map(stages.map((s) => [s.id, s.label]));
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  return rows.map((d) => ({
    ...d,
    stageName: stageName.get(d.dealStageId) ?? null,
    organizationName: orgName.get(d.organizationId) ?? null,
  }));
}

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
    if (deals.length === 0) return res.json({ kind: 'no_deals', contactName });

    // tourDate is "YYYY-MM-DD" — lexicographic compare is date compare.
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const open = deals.filter((d) => d.status === 'open');
    const recentWon = deals.filter((d) => d.status === 'won' && d.tourDate && d.tourDate >= sevenDaysAgo);
    const candidates = [...open, ...recentWon];
    if (candidates.length === 1) return res.json({ kind: 'open', dealId: candidates[0].id });
    if (candidates.length > 1) {
      return res.json({ kind: 'choose', contactName, deals: candidates.map(dealSummary) });
    }
    return res.json({ kind: 'old_or_new', contactName, deals: deals.map(dealSummary) });
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
router.get(
  '/chats/:chatId/messages',
  handle(async (req, res) => {
    const chat = await prisma.whatsAppChat.findUnique({
      where: { id: req.params.chatId },
      select: { id: true },
    });
    if (!chat) return res.status(404).json({ error: 'not_found' });
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
      res.set('Cache-Control', 'no-store');
      return res.json({ count });
    }
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
    const row = await prisma.whatsAppScheduledMessage.create({
      data: {
        accountId: chat.accountId,
        chatId: chat.id,
        content: text,
        scheduledAt,
        createdById: req.adminAuth?.userId ?? null,
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
    const updated = await prisma.whatsAppScheduledMessage.updateMany({
      where: { id: req.params.id, status: { in: ['pending', 'failed', 'skipped'] } },
      data: { status: 'cancelled', claimedAt: null, claimedBy: null, nextRetryAt: null },
    });
    if (updated.count === 0) return res.status(409).json({ error: 'not_cancellable' });
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
