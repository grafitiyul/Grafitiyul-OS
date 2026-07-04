import crypto from 'node:crypto';

// Quote Module — Slice 1 service (foundation only).
//
// A QuoteDocument is the DRAFT/PRODUCED composed proposal for a Deal, referencing
// the priced QuoteVersion it renders (Architecture B; see
// docs/architecture/GOS-quote-module-architecture.md §7B). This slice builds ONLY
// the draft foundation — no renderer, public page, signature, PDF, delivery, or
// produce/freeze. No prices live here: the Builder (QuoteVersion/QuoteLine) is the
// single source of commercial data.
//
// All DB-touching functions take an explicit `client` (prisma or a transaction)
// so the logic is unit-testable against a fake client without a database — the
// same injection style as `ensureWorkingVersion`. The pure helpers
// (resolveQuoteLanguage, newPublicToken) carry the actual decisions and are tested
// directly.

const VALID_LANGS = ['he', 'en'];
// Role priority for resolving the quote language from the relevant Contact.
// Mirrors GOS-quote-module-architecture.md §10. `receiveQuotes` gating is a
// delivery-layer concern and is intentionally NOT applied yet.
const LANG_ROLE_PRIORITY = ['payer', 'decisionMaker', 'coordinator'];

const isLang = (v) => VALID_LANGS.includes(v);

// High-entropy, URL-safe capability token for the (future) public quote page.
// Same generator as the guide portal token (24 bytes base64url). No public route
// consumes it yet — the field simply exists from the foundation.
export function newPublicToken() {
  return crypto.randomBytes(24).toString('base64url');
}

// Pure: pick the quote language from the relevant Contact's communicationLanguage,
// by role priority (payer → decisionMaker → coordinator → isPrimary → any), then
// fall back to the Deal's working language, then Hebrew. Never auto-translates;
// language only selects which side of the bilingual content renders later.
//
// `deal` shape: { communicationLanguage, contacts: [{ roles:[], isPrimary, contact:{ communicationLanguage } }] }
export function resolveQuoteLanguage(deal) {
  const contacts = Array.isArray(deal?.contacts) ? deal.contacts : [];
  const langOf = (dc) => dc?.contact?.communicationLanguage;

  for (const role of LANG_ROLE_PRIORITY) {
    const hit = contacts.find((dc) => Array.isArray(dc?.roles) && dc.roles.includes(role) && isLang(langOf(dc)));
    if (hit) return langOf(hit);
  }
  const primary = contacts.find((dc) => dc?.isPrimary && isLang(langOf(dc)));
  if (primary) return langOf(primary);
  const any = contacts.find((dc) => isLang(langOf(dc)));
  if (any) return langOf(any);

  // No usable contact language → the Deal's working language, then Hebrew default.
  return isLang(deal?.communicationLanguage) ? deal.communicationLanguage : 'he';
}

// Pure: the `data` for a brand-new draft QuoteDocument. The renderer is not built,
// so the three JSON shapes start empty/null; displayProductName starts null.
export function buildInitialDraftData({ dealId, quoteVersionId, language }) {
  return {
    dealId,
    quoteVersionId,
    status: 'draft',
    language: isLang(language) ? language : 'he',
    publicToken: newPublicToken(),
    displayProductName: null,
    compositionDraft: null,
    overrideState: null,
    renderModelSnapshot: null,
  };
}

// Exactly one working QuoteVersion per deal (the version the Builder edits).
// Centralised here so the Quote module and the Price Builder share one definition.
export async function ensureWorkingVersion(client, dealId) {
  const existing = await client.quoteVersion.findFirst({ where: { dealId, isWorking: true } });
  if (existing) return existing;
  return client.quoteVersion.create({ data: { dealId, isWorking: true, status: 'draft' } });
}

const DEAL_SELECT_FOR_QUOTE = {
  id: true,
  communicationLanguage: true,
  contacts: {
    select: {
      roles: true,
      isPrimary: true,
      contact: { select: { communicationLanguage: true } },
    },
  },
};

// Ensure a single DRAFT QuoteDocument exists for a deal's working QuoteVersion.
// Idempotent: returns the existing draft if one is already there (never creates a
// duplicate). Returns { error } when the deal is missing.
export async function ensureDraftQuoteDocument(client, dealId) {
  const deal = await client.deal.findUnique({ where: { id: dealId }, select: DEAL_SELECT_FOR_QUOTE });
  if (!deal) return { error: 'not_found' };

  const version = await ensureWorkingVersion(client, dealId);

  const existing = await client.quoteDocument.findFirst({
    where: { dealId, quoteVersionId: version.id, status: 'draft' },
    orderBy: { createdAt: 'asc' },
  });
  if (existing) return { doc: existing, created: false };

  const doc = await client.quoteDocument.create({
    data: buildInitialDraftData({
      dealId,
      quoteVersionId: version.id,
      language: resolveQuoteLanguage(deal),
    }),
  });
  return { doc, created: true };
}

// Read one QuoteDocument by id. Returns { error:'not_found' } if absent.
export async function getQuoteDocument(client, id) {
  const doc = await client.quoteDocument.findUnique({ where: { id } });
  return doc ? { doc } : { error: 'not_found' };
}

// Update editable draft metadata. Only DRAFT documents are editable (produced /
// accepted / rejected / expired are frozen). Touches only keys present in `body`.
// Returns { error } codes on missing / not-editable / invalid input.
export async function updateQuoteDocumentMeta(client, id, body = {}) {
  const doc = await client.quoteDocument.findUnique({ where: { id } });
  if (!doc) return { error: 'not_found' };
  if (doc.status !== 'draft') return { error: 'not_editable' };

  const data = {};
  if (body.displayProductName !== undefined) {
    data.displayProductName = body.displayProductName ? String(body.displayProductName) : null;
  }
  if (body.language !== undefined) {
    if (!isLang(body.language)) return { error: 'invalid_language' };
    data.language = body.language;
  }
  // Draft structure + presentation overrides (Slice 3). Plain JSON objects or
  // null. compositionDraft = { blocks:[{key,hidden}] } (order + hidden);
  // overrideState = { blocks:{ [key]:{ html?, title? } } } (content overrides).
  if (body.compositionDraft !== undefined) {
    if (body.compositionDraft !== null && typeof body.compositionDraft !== 'object') return { error: 'invalid_composition_draft' };
    data.compositionDraft = body.compositionDraft ?? null;
  }
  if (body.overrideState !== undefined) {
    if (body.overrideState !== null && typeof body.overrideState !== 'object') return { error: 'invalid_override_state' };
    data.overrideState = body.overrideState ?? null;
  }
  if (Object.keys(data).length === 0) return { doc };

  const updated = await client.quoteDocument.update({ where: { id }, data });
  return { doc: updated };
}

// "Reset all to source": clear every override + structural edit and let the
// composer recompose from source on the next preview. Draft only.
export async function resetQuoteDocumentToSource(client, id) {
  const doc = await client.quoteDocument.findUnique({ where: { id } });
  if (!doc) return { error: 'not_found' };
  if (doc.status !== 'draft') return { error: 'not_editable' };
  const updated = await client.quoteDocument.update({
    where: { id },
    data: { compositionDraft: null, overrideState: null, displayProductName: null },
  });
  return { doc: updated };
}

// Stable client-facing shape for a QuoteDocument (explicit allow-list, no BigInt).
export function toClientQuoteDocument(doc) {
  return {
    id: doc.id,
    dealId: doc.dealId,
    quoteVersionId: doc.quoteVersionId,
    status: doc.status,
    language: doc.language,
    publicToken: doc.publicToken,
    expiresAt: doc.expiresAt ?? null,
    producedAt: doc.producedAt ?? null,
    displayProductName: doc.displayProductName ?? null,
    compositionDraft: doc.compositionDraft ?? null,
    overrideState: doc.overrideState ?? null,
    renderModelSnapshot: doc.renderModelSnapshot ?? null,
    createdAt: doc.createdAt ?? null,
    updatedAt: doc.updatedAt ?? null,
  };
}
