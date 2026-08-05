import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { normalizeTokensToChips } from '../../../shared/variableTokens.mjs';
import { loadTriggerContext, publicOrigin } from '../communication/context.js';
import { variableByKey } from '../communication/variables.js';
import { dealsForContact, classifyDealsForContact } from '../crm/dealResolution.js';
import {
  resolveTemplateBody,
  templateVariables,
  unsupportedTokens,
  canonicalizeTemplateTokens,
  TEMPLATE_VARIABLE_KEYS,
} from '../whatsapp/templateResolve.js';
import {
  setNewLeadDefault,
  clearNewLeadDefault,
  setNewLeadSendAccount,
  newLeadAccountIdOf,
  DEFAULT_NEW_LEAD_ACCOUNT_ID,
  TemplateNotStarrableError,
} from '../whatsapp/newLeadTemplate.js';
import { listSelectableAccounts } from '../whatsapp/senderAccount.js';

// CRM Settings → "נוסחים לתבניות ווטסאפ" + the Deal template modal.
//
// These are INTERNAL reusable drafts, not Meta/WhatsApp Business API approved
// templates. Nothing here sends anything: the resolve endpoint hands back plain
// WhatsApp markup, and the Deal modal feeds it to the ordinary chat composer,
// which sends through the one existing POST /api/whatsapp/chats/:id/send path.
// Same catalog shape as the other CRM settings screens (sortOrder + isActive +
// reorder).

const router = Router();

const MAX_NAME = 120;
const MAX_BODY = 20_000;

// Body HTML in, storable body HTML out:
//   1. alias moustache → canonical spelling ({{first_name}} → {{customer_first_name}}),
//      so storage only ever holds the canonical token;
//   2. recognized raw {{key}} → a canonical chip span (the project-wide token rule);
//   3. an all-whitespace body → null, so "no version in this language" has a
//      single honest representation rather than '' / '<p></p>' / null.
function cleanBody(raw) {
  if (raw == null) return null;
  const s = String(raw);
  if (!s.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()) return null;
  const canonical = canonicalizeTemplateTokens(s);
  return normalizeTokensToChips(canonical, (key) => variableByKey(key)?.labelHe || null).slice(0, MAX_BODY);
}

// A template must not store a token this feature cannot resolve — that is the
// structural guarantee behind "the raw token can never reach the customer".
function bodyTokenError(bodyHe, bodyEn) {
  const bad = [...new Set([...unsupportedTokens(bodyHe || ''), ...unsupportedTokens(bodyEn || '')])];
  return bad.length ? { error: 'unsupported_variables', keys: bad } : null;
}

function toClient(t) {
  return {
    id: t.id,
    nameHe: t.nameHe,
    bodyHeHtml: t.bodyHeHtml,
    bodyEnHtml: t.bodyEnHtml,
    hasHe: !!t.bodyHeHtml,
    hasEn: !!t.bodyEnHtml,
    isActive: t.isActive,
    // The star: this template is auto-sent to genuinely new EXTERNAL leads.
    // At most one template carries it; zero is valid and means no auto-reply.
    isNewLeadDefault: !!t.isNewLeadDefault,
    // Which business number that automatic reply goes out from. Resolved (never
    // raw null) so the dropdown always shows the account that would actually be
    // used, including for a template that has never been configured.
    newLeadSendAccountId: newLeadAccountIdOf(t),
    sortOrder: t.sortOrder,
    sourceSystem: t.sourceSystem,
    sourceRecordId: t.sourceRecordId,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

// Variable picker source for the settings editor. Deliberately narrower than
// the full communication registry — a template may only use what this feature
// resolves and has verified.
router.get(
  '/meta',
  handle(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    // The sending accounts for the new-lead dropdown come from the CANONICAL
    // account list — same rows, same order, same labels every other sending
    // surface shows. Labels are never hardcoded here: renaming a number in
    // admin must rename it in this dropdown too.
    const accounts = await listSelectableAccounts(prisma);
    res.json({
      variables: templateVariables(),
      categories: { customer: 'לקוח' },
      supportedKeys: TEMPLATE_VARIABLE_KEYS,
      sendAccounts: accounts.map((a) => ({
        id: a.id,
        label: a.label,
        connected: a.connected,
        bridgeConfigured: a.bridgeConfigured,
      })),
      defaultSendAccountId: DEFAULT_NEW_LEAD_ACCOUNT_ID,
    });
  }),
);

// GET /?activeOnly=1 — the Deal selector passes activeOnly and additionally
// filters to the language it needs; settings loads everything.
router.get(
  '/',
  handle(async (req, res) => {
    const where = req.query.activeOnly === '1' ? { isActive: true } : {};
    const rows = await prisma.whatsAppTemplate.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { nameHe: 'asc' }],
    });
    res.set('Cache-Control', 'no-store');
    res.json(rows.map(toClient));
  }),
);

// Reorder — declared before '/:id'.
router.put(
  '/reorder',
  handle(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x) => typeof x === 'string') : [];
    if (!ids.length) return res.json({ ok: true });
    await prisma.$transaction(
      ids.map((id, i) => prisma.whatsAppTemplate.update({ where: { id }, data: { sortOrder: i } })),
    );
    res.json({ ok: true });
  }),
);

router.post(
  '/',
  handle(async (req, res) => {
    const b = req.body || {};
    const nameHe = String(b.nameHe || '').trim().slice(0, MAX_NAME);
    if (!nameHe) return res.status(400).json({ error: 'name_required' });
    const bodyHeHtml = cleanBody(b.bodyHeHtml);
    const bodyEnHtml = cleanBody(b.bodyEnHtml);
    if (!bodyHeHtml && !bodyEnHtml) return res.status(400).json({ error: 'body_required' });
    const tokenErr = bodyTokenError(bodyHeHtml, bodyEnHtml);
    if (tokenErr) return res.status(400).json(tokenErr);

    const last = await prisma.whatsAppTemplate.findFirst({ orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
    const created = await prisma.whatsAppTemplate.create({
      data: {
        nameHe,
        bodyHeHtml,
        bodyEnHtml,
        isActive: b.isActive !== false,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });
    res.status(201).json(toClient(created));
  }),
);

router.put(
  '/:id',
  handle(async (req, res) => {
    const b = req.body || {};
    const existing = await prisma.whatsAppTemplate.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'not_found' });

    const data = {};
    if (b.nameHe !== undefined) {
      const nameHe = String(b.nameHe || '').trim().slice(0, MAX_NAME);
      if (!nameHe) return res.status(400).json({ error: 'name_required' });
      data.nameHe = nameHe;
    }
    if (b.bodyHeHtml !== undefined) data.bodyHeHtml = cleanBody(b.bodyHeHtml);
    if (b.bodyEnHtml !== undefined) data.bodyEnHtml = cleanBody(b.bodyEnHtml);
    if (b.isActive !== undefined) {
      data.isActive = !!b.isActive;
      // Deactivating the starred template CLEARS the star in the same write: a
      // paused template must not keep answering real customers. The rule lives
      // in whatsapp/newLeadTemplate.js; this mirrors it so a combined edit
      // (body + isActive) still goes through one update.
      if (!data.isActive) data.isNewLeadDefault = false;
    }

    const nextHe = data.bodyHeHtml !== undefined ? data.bodyHeHtml : existing.bodyHeHtml;
    const nextEn = data.bodyEnHtml !== undefined ? data.bodyEnHtml : existing.bodyEnHtml;
    if (!nextHe && !nextEn) return res.status(400).json({ error: 'body_required' });
    const tokenErr = bodyTokenError(nextHe, nextEn);
    if (tokenErr) return res.status(400).json(tokenErr);

    const updated = await prisma.whatsAppTemplate.update({ where: { id: existing.id }, data });
    res.json(toClient(updated));
  }),
);

// The star — "הודעת ברירת מחדל לליד חדש".
//
// PUT { starred: true }  → this template becomes THE automatic reply to new
//                          external leads, clearing whichever held the star.
// PUT { starred: false } → no template answers new leads (a valid state).
//
// All rules (at most one, inactive cannot be starred) live in the one owner
// module; this route only translates its errors into HTTP.
router.put(
  '/:id/new-lead-default',
  handle(async (req, res) => {
    const starred = req.body?.starred !== false;
    try {
      if (!starred) {
        // Unstar is idempotent and unconditional — clearing is always safe.
        const existing = await prisma.whatsAppTemplate.findUnique({ where: { id: req.params.id } });
        if (!existing) return res.status(404).json({ error: 'not_found' });
        // Scoped to THIS template: unstarring A must never clear B's star.
        await clearNewLeadDefault(prisma, existing.id);
        const after = await prisma.whatsAppTemplate.findUnique({ where: { id: req.params.id } });
        return res.json(toClient(after));
      }
      const updated = await setNewLeadDefault(prisma, req.params.id);
      return res.json(toClient(updated));
    } catch (err) {
      if (err instanceof TemplateNotStarrableError) {
        return res.status(err.code === 'not_found' ? 404 : 400).json({ error: err.code });
      }
      throw err;
    }
  }),
);

// Which business number the automatic new-lead reply is sent from.
//
// Only the STARRED template can hold this, because only it sends. Takes effect
// on the very next lead — nothing is cached and no deploy is involved.
router.put(
  '/:id/new-lead-account',
  handle(async (req, res) => {
    const accountId = String(req.body?.accountId || '').trim();
    // Validated against the canonical list rather than a local enum, so a
    // retired or renamed number cannot be selected.
    const valid = (await listSelectableAccounts(prisma)).map((a) => a.id);
    try {
      const updated = await setNewLeadSendAccount(prisma, req.params.id, accountId, valid);
      return res.json(toClient(updated));
    } catch (err) {
      if (err instanceof TemplateNotStarrableError) {
        return res.status(err.code === 'not_found' ? 404 : 400).json({ error: err.code });
      }
      throw err;
    }
  }),
);

router.delete(
  '/:id',
  handle(async (req, res) => {
    const existing = await prisma.whatsAppTemplate.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'not_found' });
    // Templates are a wording library — no message references them after send
    // (the Deal persists the final edited text, never a template reference), so
    // deletion destroys nothing but the reusable draft itself.
    await prisma.whatsAppTemplate.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  }),
);

// Resolve ONE template for ONE subject + language → plain WhatsApp markup,
// ready to become the composer's editable draft. Read-only: resolves nothing
// else, sends nothing, writes nothing.
//
// Two subjects, ONE resolution stack:
//   ?dealId=  — the Deal modal (unchanged): full trigger context.
//   ?chatId=  — the standalone inbox. The server re-derives the deal through
//     the SHARED confident-resolution rule (crm/dealResolution — exactly one
//     open/recent-WON candidate), so a deal-linked conversation gets the same
//     deal-aware variables as the Deal modal. No confident deal → the context
//     carries exactly what can truthfully be known (the linked contact, or
//     nothing); a missing value resolves to EMPTY and is REPORTED, never
//     shipped as a raw token (same policy as the deal path).
router.get(
  '/:id/resolved',
  handle(async (req, res) => {
    const dealId = String(req.query.dealId || '').trim();
    const chatId = String(req.query.chatId || '').trim();
    const lang = req.query.lang === 'en' ? 'en' : 'he';
    if (!dealId && !chatId) return res.status(400).json({ error: 'deal_id_required' });

    const template = await prisma.whatsAppTemplate.findUnique({ where: { id: req.params.id } });
    if (!template) return res.status(404).json({ error: 'not_found' });

    const bodyHtml = lang === 'en' ? template.bodyEnHtml : template.bodyHeHtml;
    // An empty language version is NEVER silently replaced by the other one —
    // the selector shows it as unavailable and this stays an honest error.
    if (!bodyHtml) return res.status(409).json({ error: 'language_unavailable' });

    let ctx;
    if (dealId) {
      const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { id: true } });
      if (!deal) return res.status(404).json({ error: 'deal_not_found' });
      ctx = await loadTriggerContext({ dealId });
    } else {
      const chat = await prisma.whatsAppChat.findUnique({
        where: { id: chatId },
        select: { id: true, contactId: true, contact: { include: { phones: true, emails: true } } },
      });
      if (!chat) return res.status(404).json({ error: 'chat_not_found' });
      let resolvedDealId = null;
      if (chat.contactId) {
        const outcome = classifyDealsForContact(await dealsForContact(chat.contactId));
        if (outcome.kind === 'open') resolvedDealId = outcome.dealId;
      }
      ctx = resolvedDealId
        ? await loadTriggerContext({ dealId: resolvedDealId })
        : {
            deal: null,
            contact: chat.contact || null,
            fieldContact: null,
            org: null,
            tour: null,
            payment: null,
            reservation: null,
            quoteDoc: null,
            owner: null,
            links: { origin: publicOrigin(), paymentUrl: null },
          };
    }
    const { text, missing } = resolveTemplateBody(bodyHtml, ctx, lang);

    res.set('Cache-Control', 'no-store');
    res.json({
      templateId: template.id,
      language: lang,
      text,
      // Reported so the modal can say "no first name on file" — never a blocker,
      // and never a raw token in `text`.
      missingVariables: missing,
    });
  }),
);

export default router;
