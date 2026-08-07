// Staff WhatsApp sends (צוות → שליחת וואטסאפ) — bulk-personalized outbound on
// the CANONICAL pipeline. This router creates data; it never sends:
//
//   * one WhatsAppSendBatch per user action (idempotency door), and
//   * one WhatsAppScheduledMessage PER recipient, each carrying that
//     recipient's OWN rendered text — drained by the existing scheduledWorker
//     with the shared per-account pacing (sendPace), retry ladder and bridge
//     idempotency. "Send now" is scheduledAt=now + a worker kick.
//
// Recipient ordering is deterministic: alphabetical by displayName (he), id
// tiebreak, frozen into per-row scheduledAt offsets (+1s per index) so the
// worker's scheduledAt-asc drain preserves it.
//
// Variables resolve through THE communication variable registry (context
// 'staff'); a recipient missing a referenced value is SKIPPED with a reason —
// the same "missing never silently substitutes" policy as the delivery engine.

import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { htmlToWhatsApp } from '../../../shared/waMarkup.mjs';
import {
  VARIABLES, VARIABLE_CATEGORIES, extractTokens, resolveVariables, substituteTokens,
} from '../communication/variables.js';
import { normalizePhoneIntl } from '../whatsapp/phone.js';
import { phoneToJid } from '../whatsapp/send.js';
import { SEND_GAP_MS } from '../whatsapp/sendPace.js';
import { configuredAccounts, listSelectableAccounts } from '../whatsapp/senderAccount.js';
import { kickScheduledWorker } from '../whatsapp/scheduledWorker.js';
import { guidePortalUrl } from '../tours/guidePortal/links.js';
import { ASSIGNABLE_WHERE } from '../people/eligibility.js';
import { isConfigured as r2Configured, buildKey, putObject } from '../r2.js';

const router = Router();

const STAFF_VARIABLES = VARIABLES.filter((v) => v.category === 'staff');
const STAFF_KEYS = new Set(STAFF_VARIABLES.map((v) => v.key));
const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024; // the composer's own cap
const ATTACHMENT_KEY_PREFIX = 'whatsapp-outbound/staff/';

const varLabel = (key) => STAFF_VARIABLES.find((v) => v.key === key)?.labelHe || key;

function staffCtx(person) {
  return { staff: { person, portalUrl: guidePortalUrl(person) } };
}

// ── Recipient resolution — ONE rule for review AND batch creation ────────────
//
// mode 'all'      → every eligible active staff member (the canonical
//                   assignable rule: active + trainee/staff/legacy-null).
// mode 'selected' → the explicitly chosen PersonRefs; blocked people are
//                   surfaced as skipped, never silently dropped.
//
// Classification per person (in deterministic order):
//   valid | missing_phone | invalid_phone | duplicate_phone (first owner of a
//   normalized number wins; later ones skip).
async function resolveStaffRecipients({ mode, personRefIds }) {
  const where = mode === 'all'
    ? ASSIGNABLE_WHERE
    : { id: { in: personRefIds } };
  const people = await prisma.personRef.findMany({
    where,
    // The profile travels with the person because the canonical staff-name
    // resolver reads its structured he/en name fields. Without it every
    // {{staff_first_name}} silently degrades to the legacy displayName split.
    include: { team: { select: { displayName: true } }, profile: true },
  });
  const byId = new Map(people.map((p) => [p.id, p]));
  const missingIds = mode === 'selected'
    ? personRefIds.filter((id) => !byId.has(id))
    : [];

  const sorted = [...people].sort((a, b) => (
    String(a.displayName || '').localeCompare(String(b.displayName || ''), 'he') || a.id.localeCompare(b.id)
  ));

  const seenPhones = new Map(); // intl → displayName of the first owner
  const entries = [];
  for (const person of sorted) {
    const entry = {
      personRefId: person.id,
      name: person.displayName,
      phone: person.phone || null,
      person,
    };
    if (mode === 'selected' && person.status !== 'active') {
      entries.push({ ...entry, state: 'not_eligible' });
      continue;
    }
    if (!person.phone || !String(person.phone).trim()) {
      entries.push({ ...entry, state: 'missing_phone' });
      continue;
    }
    const intl = normalizePhoneIntl(person.phone);
    if (!intl) {
      entries.push({ ...entry, state: 'invalid_phone' });
      continue;
    }
    if (seenPhones.has(intl)) {
      entries.push({ ...entry, state: 'duplicate_phone', phoneIntl: intl, duplicateOf: seenPhones.get(intl) });
      continue;
    }
    seenPhones.set(intl, person.displayName);
    entries.push({ ...entry, state: 'valid', phoneIntl: intl });
  }
  for (const id of missingIds) {
    entries.push({ personRefId: id, name: null, phone: null, person: null, state: 'not_found' });
  }
  return entries;
}

// Per-recipient render against the frozen template TEXT. Missing values are
// reported, never substituted; `missingLabels` is for preview surfaces only.
function renderForPerson(templateText, keys, person, { missingLabels = false } = {}) {
  const { values, missing } = resolveVariables(keys, staffCtx(person), 'he');
  return {
    text: substituteTokens(templateText, values, { missingLabels }),
    missing,
  };
}

function parseRecipientInput(body) {
  const mode = body?.mode === 'all' ? 'all' : 'selected';
  const personRefIds = Array.isArray(body?.personRefIds)
    ? [...new Set(body.personRefIds.map((x) => String(x || '').trim()).filter(Boolean))].slice(0, 2000)
    : [];
  return { mode, personRefIds };
}

// ── Meta: sender accounts + staff variables + queue pacing facts ─────────────
router.get(
  '/meta',
  handle(async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      // Same builder as GET /connected-accounts — one definition of which
      // numbers exist and which are usable, shared by every sending surface.
      accounts: await listSelectableAccounts(prisma),
      variables: STAFF_VARIABLES.map((v) => ({
        key: v.key, labelHe: v.labelHe, labelEn: v.labelEn, category: v.category, descriptionHe: v.labelHe,
      })),
      categories: { staff: VARIABLE_CATEGORIES.staff },
      gapSeconds: Math.round(SEND_GAP_MS / 1000),
      maxAttachments: MAX_ATTACHMENTS,
      maxAttachmentBytes: MAX_ATTACHMENT_BYTES,
      storageConfigured: r2Configured(),
    });
  }),
);

// ── Review: classify recipients (+ per-recipient missing variables) ──────────
router.post(
  '/review',
  handle(async (req, res) => {
    const { mode, personRefIds } = parseRecipientInput(req.body);
    if (mode === 'selected' && personRefIds.length === 0) {
      return res.status(400).json({ error: 'recipients_required' });
    }
    const bodyHtml = typeof req.body?.bodyHtml === 'string' ? req.body.bodyHtml : '';
    const templateText = bodyHtml ? htmlToWhatsApp(bodyHtml) : '';
    const keys = templateText ? extractTokens(templateText).filter((k) => STAFF_KEYS.has(k)) : [];

    const entries = await resolveStaffRecipients({ mode, personRefIds });
    const out = entries.map((e) => {
      const row = {
        personRefId: e.personRefId,
        name: e.name,
        phone: e.phone,
        state: e.state,
        duplicateOf: e.duplicateOf || null,
      };
      if (e.state === 'valid' && keys.length) {
        const { missing } = renderForPerson(templateText, keys, e.person);
        if (missing.length) row.missingVariables = missing.map(varLabel);
      }
      return row;
    });
    res.set('Cache-Control', 'no-store');
    res.json({
      recipients: out,
      counts: {
        valid: out.filter((r) => r.state === 'valid').length,
        missingPhone: out.filter((r) => r.state === 'missing_phone').length,
        invalidPhone: out.filter((r) => r.state === 'invalid_phone').length,
        duplicates: out.filter((r) => r.state === 'duplicate_phone').length,
        other: out.filter((r) => ['not_eligible', 'not_found'].includes(r.state)).length,
        missingVariables: out.filter((r) => r.state === 'valid' && r.missingVariables?.length).length,
      },
    });
  }),
);

// ── Preview: one recipient's fully rendered message ──────────────────────────
router.post(
  '/preview',
  handle(async (req, res) => {
    const bodyHtml = typeof req.body?.bodyHtml === 'string' ? req.body.bodyHtml : '';
    const personRefId = String(req.body?.personRefId || '').trim();
    if (!personRefId) return res.status(400).json({ error: 'person_required' });
    const person = await prisma.personRef.findUnique({
      where: { id: personRefId },
      // Same include as the recipient resolver above — the preview must render
      // from exactly the shape the batch will render from.
      include: { team: { select: { displayName: true } }, profile: true },
    });
    if (!person) return res.status(404).json({ error: 'not_found' });
    const templateText = htmlToWhatsApp(bodyHtml);
    const keys = extractTokens(templateText);
    const unknown = keys.filter((k) => !STAFF_KEYS.has(k));
    const { text, missing } = renderForPerson(templateText, keys.filter((k) => STAFF_KEYS.has(k)), person, { missingLabels: true });
    res.set('Cache-Control', 'no-store');
    res.json({
      text,
      missingVariables: missing.map(varLabel),
      unknownTokens: unknown,
    });
  }),
);

// ── Attachment upload: ONE R2 object per file, shared by reference ───────────
// Base64 body like the composer's send-media (same 16MB cap), but stored in R2
// instead of sent — scheduled/bulk sends need bytes that outlive the request.
router.post(
  '/attachments',
  handle(async (req, res) => {
    if (!r2Configured()) return res.status(503).json({ error: 'storage_not_configured' });
    const b = req.body || {};
    const dataBase64 = typeof b.dataBase64 === 'string' ? b.dataBase64 : '';
    if (!dataBase64 || dataBase64.length > 22_000_000) {
      return res.status(400).json({ error: 'media_invalid' });
    }
    let buffer;
    try {
      buffer = Buffer.from(dataBase64, 'base64');
    } catch {
      return res.status(400).json({ error: 'media_invalid' });
    }
    if (!buffer.length || buffer.length > MAX_ATTACHMENT_BYTES) {
      return res.status(400).json({ error: 'media_invalid' });
    }
    const mimeType = typeof b.mimeType === 'string' && b.mimeType ? b.mimeType.slice(0, 120) : 'application/octet-stream';
    const fileName = typeof b.fileName === 'string' && b.fileName.trim() ? b.fileName.trim().slice(0, 200) : 'file';
    const kind = mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('video/') ? 'video' : 'document';
    const key = buildKey('whatsapp-outbound/staff', fileName);
    await putObject({ key, body: buffer, contentType: mimeType });
    res.status(201).json({ key, fileName, mimeType, kind, sizeBytes: buffer.length });
  }),
);

function normalizeAttachmentRefs(raw) {
  if (!Array.isArray(raw)) return { attachments: [] };
  if (raw.length > MAX_ATTACHMENTS) return { error: 'too_many_attachments' };
  const attachments = [];
  for (const a of raw) {
    const key = typeof a?.key === 'string' ? a.key : '';
    // Only keys OUR upload endpoint minted are sendable — an arbitrary R2 key
    // in the payload must never turn into an outbound file.
    if (!key.startsWith(ATTACHMENT_KEY_PREFIX) || key.includes('..')) return { error: 'attachment_key_invalid' };
    attachments.push({
      key,
      fileName: typeof a.fileName === 'string' ? a.fileName.slice(0, 200) : 'file',
      mimeType: typeof a.mimeType === 'string' ? a.mimeType.slice(0, 120) : 'application/octet-stream',
      kind: ['image', 'video', 'document'].includes(a.kind) ? a.kind : 'document',
      sizeBytes: Number.isFinite(a.sizeBytes) ? a.sizeBytes : null,
    });
  }
  return { attachments };
}

function batchSummary(batch, rows, namesById) {
  const counts = {};
  for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
  return {
    batch: {
      id: batch.id,
      accountId: batch.accountId,
      scheduledAt: batch.scheduledAt,
      sendNow: batch.sendNow,
      recipientCount: batch.recipientCount,
      skipped: batch.skipped || [],
      createdAt: batch.createdAt,
    },
    counts,
    rows: rows.map((r) => ({
      id: r.id,
      personRefId: r.personRefId,
      name: namesById?.get(r.personRefId) || null,
      destinationPhone: r.destinationPhone,
      status: r.status,
      failureReason: r.failureReason,
      scheduledAt: r.scheduledAt,
      sentAt: r.sentAt,
    })),
  };
}

async function loadBatchSummary(batchId) {
  const batch = await prisma.whatsAppSendBatch.findUnique({ where: { id: batchId } });
  if (!batch) return null;
  const rows = await prisma.whatsAppScheduledMessage.findMany({
    where: { batchId: batch.id },
    orderBy: { scheduledAt: 'asc' },
  });
  const people = await prisma.personRef.findMany({
    where: { id: { in: rows.map((r) => r.personRefId).filter(Boolean) } },
    select: { id: true, displayName: true },
  });
  return batchSummary(batch, rows, new Map(people.map((p) => [p.id, p.displayName])));
}

// ── Create a batch: the ONE write door ───────────────────────────────────────
router.post(
  '/batches',
  handle(async (req, res) => {
    const b = req.body || {};
    const idempotencyKey = typeof b.idempotencyKey === 'string' ? b.idempotencyKey.trim() : '';
    if (idempotencyKey.length < 8 || idempotencyKey.length > 100) {
      return res.status(400).json({ error: 'idempotency_key_required' });
    }

    // Replay door FIRST: the same user action never creates a second wave.
    const existing = await prisma.whatsAppSendBatch.findUnique({ where: { idempotencyKey } });
    if (existing) {
      const summary = await loadBatchSummary(existing.id);
      return res.status(200).json({ ...summary, replay: true });
    }

    // Sender account: explicit, validated against the configured bridges AND
    // the DB row. No guessing, no fallback (senderAccount doctrine).
    const accountId = String(b.accountId || '').trim();
    if (!accountId) return res.status(400).json({ error: 'account_required' });
    const configured = configuredAccounts();
    if (configured.length && !configured.includes(accountId)) {
      return res.status(400).json({ error: 'unknown_account' });
    }
    const account = await prisma.whatsAppAccount.findUnique({ where: { id: accountId } });
    if (!account || !account.active) return res.status(400).json({ error: 'unknown_account' });

    // Timing.
    const sendNow = b.sendNow === true;
    let baseAt;
    if (sendNow) {
      baseAt = new Date();
    } else {
      baseAt = b.scheduledAt ? new Date(String(b.scheduledAt)) : null;
      if (!baseAt || Number.isNaN(baseAt.getTime())) {
        return res.status(400).json({ error: 'scheduled_at_invalid' });
      }
      if (baseAt.getTime() < Date.now() + 30_000) {
        return res.status(400).json({ error: 'scheduled_at_past' });
      }
    }

    // Content.
    const bodyHtml = typeof b.bodyHtml === 'string' ? b.bodyHtml : '';
    const templateText = htmlToWhatsApp(bodyHtml).trim();
    const att = normalizeAttachmentRefs(b.attachments);
    if (att.error) return res.status(400).json({ error: att.error });
    const attachments = att.attachments;
    if (!templateText && attachments.length === 0) {
      return res.status(400).json({ error: 'content_required' });
    }
    if (attachments.length && !r2Configured()) {
      return res.status(503).json({ error: 'storage_not_configured' });
    }
    const keys = extractTokens(templateText);
    const unknown = keys.filter((k) => !STAFF_KEYS.has(k));
    if (unknown.length) {
      return res.status(400).json({ error: 'unknown_tokens', tokens: unknown });
    }

    // Recipients — same resolution as /review, so what the operator reviewed
    // is exactly what happens.
    const { mode, personRefIds } = parseRecipientInput(b);
    if (mode === 'selected' && personRefIds.length === 0) {
      return res.status(400).json({ error: 'recipients_required' });
    }
    const entries = await resolveStaffRecipients({ mode, personRefIds });

    const skipped = [];
    const sendable = [];
    for (const e of entries) {
      if (e.state !== 'valid') {
        skipped.push({ personRefId: e.personRefId, name: e.name, reason: e.state, detail: e.duplicateOf || null });
        continue;
      }
      const { text, missing } = renderForPerson(templateText, keys, e.person);
      if (missing.length) {
        skipped.push({ personRefId: e.personRefId, name: e.name, reason: 'missing_variables', detail: missing.map(varLabel).join(', ') });
        continue;
      }
      sendable.push({ ...e, renderedText: text });
    }
    if (sendable.length === 0) {
      return res.status(400).json({ error: 'no_valid_recipients', skipped });
    }

    // Thread continuity: recipients who already have a mirrored chat on this
    // account get chatId (the send lands in their existing thread); the rest
    // ride destinationJid. Looked up in ONE query.
    const intls = sendable.map((e) => e.phoneIntl);
    const jids = intls.map((i) => `${i}@s.whatsapp.net`);
    const chats = await prisma.whatsAppChat.findMany({
      where: {
        accountId,
        type: 'private',
        OR: [{ phoneNumber: { in: intls } }, { externalChatId: { in: jids } }, { phoneJid: { in: jids } }],
      },
      select: { id: true, phoneNumber: true, externalChatId: true, phoneJid: true },
    });
    const chatByIntl = new Map();
    for (const c of chats) {
      const key = c.phoneNumber
        || String(c.phoneJid || c.externalChatId || '').split('@')[0];
      if (key && !chatByIntl.has(key)) chatByIntl.set(key, c.id);
    }

    const createdById = req.adminAuth?.userId || null;
    let batch;
    try {
      batch = await prisma.$transaction(async (tx) => {
        const created = await tx.whatsAppSendBatch.create({
          data: {
            idempotencyKey,
            accountId,
            kind: 'staff',
            templateHtml: bodyHtml,
            templateText,
            attachments: attachments.length ? attachments : null,
            scheduledAt: baseAt,
            sendNow,
            recipientCount: sendable.length,
            skipped: skipped.length ? skipped : null,
            createdById,
          },
        });
        await tx.whatsAppScheduledMessage.createMany({
          data: sendable.map((e, i) => ({
            accountId,
            chatId: chatByIntl.get(e.phoneIntl) || null,
            destinationJid: phoneToJid(e.phone),
            destinationPhone: e.phoneIntl,
            personRefId: e.personRefId,
            batchId: created.id,
            attachments: attachments.length ? attachments : null,
            content: e.renderedText,
            // +1s per index: deterministic drain order (scheduledAt asc) that
            // matches the alphabetical recipient order, invisible next to the
            // 20s per-account pacing gap.
            scheduledAt: new Date(baseAt.getTime() + i * 1000),
            createdById,
          })),
        });
        return created;
      });
    } catch (err) {
      // Unique-key race (double submit landing together): replay the winner.
      if (err?.code === 'P2002') {
        const winner = await prisma.whatsAppSendBatch.findUnique({ where: { idempotencyKey } });
        if (winner) {
          const summary = await loadBatchSummary(winner.id);
          return res.status(200).json({ ...summary, replay: true });
        }
      }
      throw err;
    }

    if (sendNow) kickScheduledWorker();
    const summary = await loadBatchSummary(batch.id);
    res.status(201).json({ ...summary, replay: false });
  }),
);

// ── Batch visibility / message history ───────────────────────────────────────
//
// This list IS the "היסטוריית הודעות" source. No separate history model exists
// on purpose: every send already freezes what was authored — templateHtml (the
// editor HTML with variable chips intact) and templateText (its WhatsApp
// markup) — so the batch row is already a faithful record of the message. A
// parallel store would be a second copy that could disagree with what was
// actually sent, and a template library, which this deliberately is not.
//
// ?search= matches the authored TEXT (the markup form), because that is what an
// operator remembers writing — not the HTML around it.
router.get(
  '/batches',
  handle(async (req, res) => {
    const search = String(req.query.search || '').trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const batches = await prisma.whatsAppSendBatch.findMany({
      where: search ? { templateText: { contains: search, mode: 'insensitive' } } : {},
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    const rows = await prisma.whatsAppScheduledMessage.findMany({
      where: { batchId: { in: batches.map((b) => b.id) } },
      select: { batchId: true, status: true },
    });
    const countsByBatch = new Map();
    for (const r of rows) {
      const c = countsByBatch.get(r.batchId) || {};
      c[r.status] = (c[r.status] || 0) + 1;
      countsByBatch.set(r.batchId, c);
    }
    res.set('Cache-Control', 'no-store');
    res.json(batches.map((b) => ({
      id: b.id,
      accountId: b.accountId,
      scheduledAt: b.scheduledAt,
      sendNow: b.sendNow,
      recipientCount: b.recipientCount,
      skippedCount: Array.isArray(b.skipped) ? b.skipped.length : 0,
      counts: countsByBatch.get(b.id) || {},
      createdAt: b.createdAt,
      // The message itself, exactly as authored: the HTML restores the editor
      // (variable CHIPS intact — reloading must never flatten {{x}} into a
      // literal), the markup drives the preview and the search snippet.
      templateHtml: b.templateHtml,
      templateText: b.templateText,
      attachments: Array.isArray(b.attachments) ? b.attachments : [],
    })));
  }),
);

router.get(
  '/batches/:id',
  handle(async (req, res) => {
    const summary = await loadBatchSummary(req.params.id);
    if (!summary) return res.status(404).json({ error: 'not_found' });
    res.set('Cache-Control', 'no-store');
    res.json(summary);
  }),
);

export default router;
