import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { normalizeTokensToChips } from '../../../shared/variableTokens.mjs';
import { loadTriggerContext } from '../communication/context.js';
import { variableByKey } from '../communication/variables.js';
import {
  resolveTemplateBody,
  templateVariables,
  unsupportedTokens,
  canonicalizeTemplateTokens,
  TEMPLATE_VARIABLE_KEYS,
} from '../whatsapp/templateResolve.js';

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
    res.json({
      variables: templateVariables(),
      categories: { customer: 'לקוח' },
      supportedKeys: TEMPLATE_VARIABLE_KEYS,
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
    if (b.isActive !== undefined) data.isActive = !!b.isActive;

    const nextHe = data.bodyHeHtml !== undefined ? data.bodyHeHtml : existing.bodyHeHtml;
    const nextEn = data.bodyEnHtml !== undefined ? data.bodyEnHtml : existing.bodyEnHtml;
    if (!nextHe && !nextEn) return res.status(400).json({ error: 'body_required' });
    const tokenErr = bodyTokenError(nextHe, nextEn);
    if (tokenErr) return res.status(400).json(tokenErr);

    const updated = await prisma.whatsAppTemplate.update({ where: { id: existing.id }, data });
    res.json(toClient(updated));
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

// Resolve ONE template for ONE deal + language → plain WhatsApp markup, ready to
// become the composer's editable draft. Read-only: resolves nothing else, sends
// nothing, writes nothing.
router.get(
  '/:id/resolved',
  handle(async (req, res) => {
    const dealId = String(req.query.dealId || '').trim();
    const lang = req.query.lang === 'en' ? 'en' : 'he';
    if (!dealId) return res.status(400).json({ error: 'deal_id_required' });

    const template = await prisma.whatsAppTemplate.findUnique({ where: { id: req.params.id } });
    if (!template) return res.status(404).json({ error: 'not_found' });

    const bodyHtml = lang === 'en' ? template.bodyEnHtml : template.bodyHeHtml;
    // An empty language version is NEVER silently replaced by the other one —
    // the selector shows it as unavailable and this stays an honest error.
    if (!bodyHtml) return res.status(409).json({ error: 'language_unavailable' });

    const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { id: true } });
    if (!deal) return res.status(404).json({ error: 'deal_not_found' });

    const ctx = await loadTriggerContext({ dealId });
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
