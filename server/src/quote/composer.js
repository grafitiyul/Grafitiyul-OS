// Quote Module — Slice 2: Composer Engine (backend foundation).
//
// Assembles a DRAFT QuoteDocument structure (an ordered block list + per-block
// preview data) from the Deal, the priced QuoteVersion/QuoteLine, CRM content
// blocks, the resolved language, and any stored overrides. It does NOT
// produce/freeze, render HTML/PDF, or persist — `composeQuoteDraftPreview` is a
// read-only preview for verification and the future Preview UI.
//
// Design: the heavy lifting (`assembleComposition` + block builders) is PURE — it
// takes plain data and returns a model, so it is unit-tested without a database.
// `composeQuoteDraftPreview` is the thin client-injected loader on top.
//
// Pricing rule (locked): the Pricing block NEVER recalculates. It renders frozen
// QuoteLine data (label, qty, unit price, line total = qty×unit, VAT mode/rate,
// override flag, row note) and uses Deal.valueMinor as the Builder's frozen gross
// total. No pricing engine, no price-list resolution, no duplicated VAT math here.

// The default block sequence lives in its own tiny module (quoteBlocks.js) so the
// quote-template service can share it without a circular import. Re-exported here
// so existing importers (tests, callers) keep `import { DEFAULT_QUOTE_BLOCKS } from './composer.js'`.
import { DEFAULT_QUOTE_BLOCKS, reconcileKeyOrder } from './quoteBlocks.js';
import { getQuoteTemplate, SECTION_TITLE_DEFAULTS } from './quoteTemplate.js';
import { resolveVariantSharedContent } from '../shared-content/sharedContent.js';
export { DEFAULT_QUOTE_BLOCKS };

const isFilled = (v) => typeof v === 'string' && v.trim() !== '';

// Language-aware pick: returns the selected-language value, or null if it is
// missing/empty. NEVER falls back to the other language (no silent fallback, no
// auto-translate). Callers turn a null into a structured warning.
export function pickLang(he, en, lang) {
  const v = lang === 'en' ? en : he;
  return isFilled(v) ? v : null;
}

function warn(blockKey, type, field, language) {
  return { code: 'missing_content', blockKey, type, field, language };
}

// Human-facing source metadata per block type (admin "where does this come from").
const SOURCE_LABELS = {
  hero: 'Deal',
  program: 'Product Variant',
  video: 'Quote Structure · Video',
  tour_details: 'Deal · Product · Location',
  pricing: 'QuoteVersion (Builder)',
  payment_terms: 'Deal · Payment',
  signature: 'Signers',
  product_marketing: 'Product',
  city_content: 'Location',
  classification: 'OrganizationType / Subtype',
  why_us: 'QuoteSection',
  faq: 'QuoteSection',
  cancellation: 'QuoteSection',
  participant_policy: 'QuoteSection',
  terms: 'QuoteSection',
};

function productName(deal, lang) {
  return pickLang(deal?.product?.nameHe, deal?.product?.nameEn, lang);
}

// The ONE quote-level display product name: the override when set, else the
// product's name in the quote language. Used everywhere the product name shows
// (hero, tour details, and the pricing product line) — never mutates source.
export function resolveDisplayProductName(document, deal, lang) {
  return (isFilled(document?.displayProductName) ? document.displayProductName : productName(deal, lang)) || null;
}

// Primary contact's display name for the cover. Prefers the quote-language name,
// but falls back PER PART to the other language when a part is empty. A contact's
// other-language names are optional and stored as '' (see routes/contacts.js), so
// a Hebrew-only (or English-only) contact must still show a name in EITHER preview
// language — the "Prepared for" VALUE is the same person; only its LABEL localizes.
function contactDisplayName(deal, lang) {
  const cs = Array.isArray(deal?.contacts) ? deal.contacts : [];
  const c = (cs.find((x) => x.isPrimary) || cs[0])?.contact;
  if (!c) return null;
  const en = lang === 'en';
  const first = (en ? c.firstNameEn : c.firstNameHe) || (en ? c.firstNameHe : c.firstNameEn);
  const last = (en ? c.lastNameEn : c.lastNameHe) || (en ? c.lastNameHe : c.lastNameEn);
  return [first, last].filter(Boolean).join(' ') || null;
}

// Cover hero image: product-variant gallery first, then meeting-point images.
function heroImageUrl(deal) {
  const v = deal?.productVariant;
  return v?.galleryImages?.[0]?.mediaFile?.url || v?.meetingPointImage?.url || deal?.location?.meetingPointImage?.url || null;
}

// "Edit at source" target per section — the Quote orchestrates the existing GOS
// editors instead of duplicating them. Routing lives HERE (one place), so the UI
// just follows it. `dialog:true` → open as an overlay (the Builder); otherwise the
// UI opens the source editor (temporarily a side tab) and refreshes on return.
// `inline:true` → quote-owned presentation, edited in the document itself.
export function editTargetFor(type, deal) {
  switch (type) {
    case 'hero': return { kind: 'deal', label: 'ערוך פרטי לקוח' };
    case 'program': return { kind: 'product', label: 'ערוך תוכן התוכנית (וריאציה)', id: deal?.productId || null };
    case 'video': return { kind: 'quoteStructure', label: 'ערוך וידאו', tab: 'video' };
    case 'tour_details': return { kind: 'deal', label: 'ערוך פרטי הסיור' };
    case 'pricing': return { kind: 'builder', label: 'ערוך תמחור', dialog: true };
    case 'payment_terms': return { kind: 'deal', label: 'ערוך תנאי תשלום' };
    case 'product_marketing': return { kind: 'product', label: 'ערוך מוצר', id: deal?.productId || null };
    case 'classification': return { kind: 'orgType', label: 'ערוך תוכן סוג ארגון', id: deal?.organizationTypeId || deal?.organization?.organizationTypeId || null };
    case 'why_us': return { kind: 'quoteSections', label: 'ערוך תוכן שיווקי', category: 'why_us' };
    case 'faq': return { kind: 'quoteSections', label: 'ערוך שאלות נפוצות', category: 'faq' };
    case 'cancellation': return { kind: 'quoteSections', label: 'ערוך מדיניות ביטול', category: 'cancellation' };
    case 'participant_policy': return { kind: 'quoteSections', label: 'ערוך מדיניות משתתפים', category: 'participant_policy' };
    case 'city_content': return { kind: 'location', label: 'ערוך מיקום', id: deal?.locationId || null };
    case 'signature': return { kind: 'signers', label: 'חתימה' };
    default: return null;
  }
}

// ── Dynamic block builders (pure) ────────────────────────────────────────────

function buildHero({ deal, document, displayName, lang, template }) {
  const warnings = [];
  if (!displayName) warnings.push(warn('hero', 'hero', 'productName', lang));
  const hero = template?.hero || null;
  return {
    data: {
      productName: displayName,
      customerName: contactDisplayName(deal, lang),
      organizationName: deal?.organization?.name || null,
      tourDate: deal?.tourDate || null,
      // Proposal creation date (תאריך הפקה) — the hero shows this, NOT the tour date.
      createdAt: document?.createdAt || null,
      // Hero image: the Quote Structure (global template) hero is the SOURCE OF
      // TRUTH and wins; the Deal's own product/location imagery is only a fallback
      // when no hero is configured; renderer draws a gradient if both are null.
      // This rule lives HERE (shared composition) so preview and produced/frozen
      // snapshots cannot diverge. Existing frozen quotes are unaffected — they
      // read renderModelSnapshot, never this composer.
      heroImageUrl: hero?.image?.url || heroImageUrl(deal) || null,
      // Global-template hero copy/style. null title/subtitle → renderer falls
      // back to its built-in "הצעת מחיר" + product name.
      heroTitle: pickLang(hero?.titleHe, hero?.titleEn, lang),
      heroSubtitle: pickLang(hero?.subtitleHe, hero?.subtitleEn, lang),
      // Premium cover presentation config (Quote Structure). The renderer applies
      // sensible fallbacks so an unconfigured system still looks polished. heroOverlay
      // preset kept for back-compat; heroOverlay* is the explicit color+opacity.
      heroLogoUrl: hero?.logo?.url || null, // null → renderer's bundled default logo
      heroOverlay: hero?.overlay || 'dark',
      heroOverlayEnabled: hero?.overlayEnabled !== false,
      heroOverlayColor: hero?.overlayColor || '#0b1220',
      heroOverlayOpacity: typeof hero?.overlayOpacity === 'number' ? hero.overlayOpacity : 40,
      heroLogoPosition: hero?.logoPosition || 'start',
      heroLogoSize: hero?.logoSize || 'md',
      heroLogoSizePx: typeof hero?.logoSizePx === 'number' ? hero.logoSizePx : 56,
      heroLogoMargin: typeof hero?.logoMargin === 'number' ? hero.logoMargin : 24,
      heroContentV: hero?.contentV || 'center',
      heroCardPosition: hero?.cardPosition || 'top-end',
      heroCardEnabled: hero?.cardEnabled !== false,
      heroCardOpacity: typeof hero?.cardOpacity === 'number' ? hero.cardOpacity : 70,
      heroCardBlur: hero?.cardBlur || 'md',
      heroCardColor: hero?.cardColor || '#081220',
      heroCardFields: hero?.cardFields || null,
      heroTitleAlign: hero?.titleAlign || 'start',
      by: 'Grafitiyul',
      quoteDocumentId: document.id,
      language: lang,
    },
    warnings,
  };
}

// Localized title for a configurable section — the Quote Template is the ONE source
// of truth (with a built-in default when no template is passed, e.g. pure tests).
function sectionTitle(template, key, lang) {
  const t = template?.sectionTitles?.[key];
  const picked = pickLang(t?.titleHe, t?.titleEn, lang);
  if (picked) return picked;
  const def = SECTION_TITLE_DEFAULTS[key];
  return def ? (lang === 'en' ? def.titleEn : def.titleHe) : null;
}

// "אז מה בתוכנית?" — TITLE from the Quote Template (one source of truth; localized
// + admin-editable), CONTENT from the selected Product Variant (variant-specific
// marketing copy, NOT Shared Content / Location Defaults). Optional: an empty
// variant paragraph yields null html → the renderer skips the block (no warning
// when there is no variant at all; a warning only when a variant exists but has no
// copy in the quote language, matching the other content builders).
function buildProgram({ deal, lang, template }) {
  const v = deal?.productVariant;
  const html = pickLang(v?.programHe, v?.programEn, lang);
  const warnings = [];
  if (v && !html) warnings.push(warn('program', 'program', 'program', lang));
  return { data: { title: sectionTitle(template, 'program', lang), html }, warnings };
}

// Video (YouTube) — the Video Library holds many videos, each assigned to specific
// Product Variants (a variant belongs to at most one video). Renders the video
// whose variantIds includes the deal's variant AND has a URL; otherwise data.url
// is null and the renderer skips the block. Output shape is unchanged from the
// single-video model. Independent of Shared Content. The renderer parses the URL
// into a safe embed at render time (reusing the shared embed parser).
function buildVideo({ deal, lang, template }) {
  const variantId = deal?.productVariantId || deal?.productVariant?.id || null;
  const videos = Array.isArray(template?.videos) ? template.videos : [];
  const match = variantId
    ? videos.find((v) => v?.url && Array.isArray(v.variantIds) && v.variantIds.includes(variantId))
    : null;
  if (!match) return { data: { url: null }, warnings: [] };
  const title = pickLang(match.titleHe, match.titleEn, lang) || (lang === 'en' ? 'Video' : 'סרטון');
  return { data: { title, url: match.url }, warnings: [] };
}

function buildTourDetails({ deal, displayName, lang, template, sharedContent }) {
  const warnings = [];
  if (!displayName) warnings.push(warn('tour_details', 'tour_details', 'productName', lang));
  const variant = deal?.productVariant;
  const location = deal?.location;
  // Dual-read (Shared Content Slice 2): a resolved Shared Content block
  // (variant link → location default, resolved in the loader) is the source of
  // truth for the meeting point. ONLY when no Shared Content exists at all do we
  // fall back to the legacy variant/location columns — identical to pre-Slice-2
  // behaviour, so a deploy before the backfill runs is safe. Produced quotes are
  // unaffected (they read renderModelSnapshot, never this composer).
  const scMeeting = sharedContent?.meetingPoint || null;
  const meetingPoint = scMeeting
    ? pickLang(scMeeting.bodyHe, scMeeting.bodyEn, lang)
    : pickLang(variant?.meetingPointHe, variant?.meetingPointEn, lang) ||
      pickLang(location?.meetingPointHe, location?.meetingPointEn, lang) ||
      null;
  // City is a proper-noun label, not translated rich content: use the selected
  // language, falling back to the Hebrew name (never a warning).
  const city = pickLang(location?.nameHe, location?.nameEn, lang) || location?.nameHe || null;
  return {
    data: {
      productName: displayName,
      city,
      tourDate: deal?.tourDate || null,
      tourTime: deal?.tourTime || null,
      participants: deal?.participants ?? null,
      durationHours: variant?.durationHours ?? null,
      tourLanguage: deal?.tourLanguage || null,
      // Retained in the model but no longer rendered inside Technical Details;
      // becomes its own optional section in Phase 2.
      meetingPoint,
      // Global-template control over which facts show and in what order. Array of
      // stable field keys (city|date|time|participants|duration|language), already
      // filtered to visible+ordered. null → renderer uses its built-in default set.
      fieldOrder: techFieldOrder(template),
    },
    warnings,
  };
}

// Visible technical-detail field keys in configured order, or null when there is
// no template (renderer then falls back to its built-in default set = today).
function techFieldOrder(template) {
  const fields = template?.technical?.fields;
  if (!Array.isArray(fields)) return null;
  return fields.filter((f) => f && f.visible).map((f) => f.key);
}

function buildPricing({ deal, lines, displayName, lang, template }) {
  // Inactive lines are excluded from the customer-facing offer (matching the
  // Builder, which excludes them from totals). They are counted, not silent.
  const active = (lines || []).filter((l) => l.active !== false);
  const excludedInactive = (lines || []).length - active.length;
  const outLines = active.map((l) => {
    const isProduct = l.kind === 'product';
    const unit = Number(l.unitPriceMinor ?? 0);
    const qty = l.quantity ?? 1;
    return {
      // The product line's DISPLAYED name follows the quote-level override
      // (display-only); all other line labels render verbatim from the Builder.
      label: isProduct && displayName ? displayName : l.label || null,
      kind: l.kind,
      quantity: qty,
      unitPriceMinor: unit,
      lineTotalMinor: unit * qty, // qty × frozen unit price — not a price calculation
      vatMode: l.vatMode || 'inherit',
      vatRate: l.vatRate ?? null,
      overridden: !!l.overridden,
      note: isFilled(l.note) ? l.note : null, // yellow row note — frozen commercial content
      ticketTypeId: l.ticketTypeId || null,
      sourceKind: l.sourceKind || null,
    };
  });
  return {
    data: {
      title: sectionTitle(template, 'pricing', lang),
      currency: deal?.currency || 'ILS',
      lines: outLines,
      excludedInactive,
      // Frozen Builder headline gross. The quote does NOT recompute totals/VAT.
      totals: { grossMinor: Number(deal?.valueMinor ?? 0) },
    },
    warnings: [],
  };
}

function buildPaymentTerms({ deal, lang }) {
  return {
    data: {
      term: deal?.paymentTerm ? pickLang(deal.paymentTerm.nameHe, deal.paymentTerm.nameEn, lang) : null,
      method: deal?.paymentMethodRef ? pickLang(deal.paymentMethodRef.nameHe, deal.paymentMethodRef.nameEn, lang) : null,
    },
    warnings: [],
  };
}

function buildSignature() {
  // No signer infrastructure wired in this slice — placeholder slot shape only.
  return { data: { signerSlots: [] }, warnings: [] };
}

// ── Content block builders (pure, language-aware) ────────────────────────────

// Product Details — CONTENT from the selected Product Variant (variant → product,
// same language; not a language fallback). TITLE from the Quote Template.
function buildProductMarketing({ deal, lang, template }) {
  const v = deal?.productVariant;
  const p = deal?.product;
  const html = pickLang(v?.marketingDescHe, v?.marketingDescEn, lang) || pickLang(p?.marketingDescHe, p?.marketingDescEn, lang);
  const warnings = [];
  if ((v || p) && !html) warnings.push(warn('product_marketing', 'product_marketing', 'marketingDesc', lang));
  return { data: { title: sectionTitle(template, 'product_marketing', lang), html }, warnings };
}

function buildCityContent({ deal, lang }) {
  const loc = deal?.location;
  const html = pickLang(loc?.marketingDescHe, loc?.marketingDescEn, lang);
  const warnings = [];
  if (loc && !html) warnings.push(warn('city_content', 'city_content', 'marketingDesc', lang));
  return { data: { html }, warnings };
}

function buildClassification({ deal, lang }) {
  const sub = deal?.organizationSubtype;
  const type = deal?.organizationType || deal?.organization?.organizationType;
  const html = pickLang(sub?.quoteContentHe, sub?.quoteContentEn, lang) || pickLang(type?.quoteContentHe, type?.quoteContentEn, lang);
  const warnings = [];
  if ((sub || type) && !html) warnings.push(warn('classification', 'classification', 'quoteContent', lang));
  return { data: { html }, warnings };
}

// Reusable QuoteSection content, selected by category. Deterministic order:
// sortOrder, then id as a stable tiebreak. Each item warns if its rich text is
// missing in the quote language (title is a label → Hebrew fallback, no warning).
function buildSectionContent({ quoteSections, category, blockKey, lang }) {
  const rows = (quoteSections || [])
    .filter((s) => s.active !== false && s.category === category)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.id).localeCompare(String(b.id)));
  const warnings = [];
  const items = rows.map((s) => {
    const html = pickLang(s.richTextHe, s.richTextEn, lang);
    if (!html) warnings.push(warn(blockKey, category, `richText:${s.id}`, lang));
    return { id: s.id, title: pickLang(s.titleHe, s.titleEn, lang) || s.titleHe || null, html };
  });
  return { data: { items }, warnings };
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

function assembleBlock(type, ctx) {
  switch (type) {
    case 'hero': return buildHero(ctx);
    case 'program': return buildProgram(ctx);
    case 'video': return buildVideo(ctx);
    case 'tour_details': return buildTourDetails(ctx);
    case 'pricing': return buildPricing(ctx);
    case 'payment_terms': return buildPaymentTerms(ctx);
    case 'signature': return buildSignature(ctx);
    case 'product_marketing': return buildProductMarketing(ctx);
    case 'city_content': return buildCityContent(ctx);
    case 'classification': return buildClassification(ctx);
    case 'why_us': return buildSectionContent({ ...ctx, category: 'why_us', blockKey: 'why_grafitiyul' });
    case 'faq': return buildSectionContent({ ...ctx, category: 'faq', blockKey: 'faq' });
    case 'cancellation': return buildSectionContent({ ...ctx, category: 'cancellation', blockKey: 'cancellation' });
    case 'participant_policy': return buildSectionContent({ ...ctx, category: 'participant_policy', blockKey: 'participant_policy' });
    case 'terms': return buildSectionContent({ ...ctx, category: 'terms', blockKey: 'terms' });
    default: return { data: null, warnings: [] };
  }
}

// Block order/hidden precedence (SSOT for a quote's composition):
//   1. per-quote compositionDraft  — this admin reordered/hid THIS quote
//   2. global template sections    — the CRM default (default SEED only)
//   3. DEFAULT_QUOTE_BLOCKS        — the code fallback (unchanged behaviour)
// Both stored shapes are [{ key, hidden }]; code default metadata is merged by key.
function getOrderedBlocks(compositionDraft, templateSections) {
  const stored = Array.isArray(compositionDraft?.blocks) && compositionDraft.blocks.length ? compositionDraft.blocks : null;
  const template = Array.isArray(templateSections) && templateSections.length ? templateSections : null;
  const source = stored || template;
  if (!source) return DEFAULT_QUOTE_BLOCKS.map((b) => ({ ...b, hidden: false }));
  // Preserve the stored hidden flags + order, but RECONCILE against the canonical
  // block set: any canonical block missing from an older saved composition (e.g.
  // program, video) is inserted at its canonical position and shown by default,
  // and stale keys are dropped. Without this, a per-quote draft (or template)
  // saved before a block existed would never show that block.
  const canonicalKeys = DEFAULT_QUOTE_BLOCKS.map((b) => b.key);
  const flags = new Map();
  const savedKeys = [];
  for (const s of source) {
    if (!s || flags.has(s.key)) continue;
    savedKeys.push(s.key);
    flags.set(s.key, !!s.hidden);
  }
  const byKey = Object.fromEntries(DEFAULT_QUOTE_BLOCKS.map((b) => [b.key, b]));
  const blocks = reconcileKeyOrder(savedKeys, canonicalKeys).map((key) => ({
    ...byKey[key],
    hidden: flags.has(key) ? flags.get(key) : false,
  }));
  // Hero is the document HEADER, not a content block: it is always present, never
  // hidden, and always first — regardless of any stored order. Enforced here (the
  // one place order is resolved) so no template or per-quote draft can move it.
  return heroFirst(blocks);
}

// Guarantee exactly one hero block, un-hidden, at index 0.
function heroFirst(blocks) {
  const hero = blocks.find((b) => b.key === 'hero') || { ...DEFAULT_QUOTE_BLOCKS[0], hidden: false };
  const rest = blocks.filter((b) => b.key !== 'hero');
  return [{ ...hero, hidden: false }, ...rest];
}

// PURE: assemble the full preview model from plain data. No DB, no I/O. The
// optional `template` is the global default layout (hero copy/image, section
// order, technical fields); omitting it reproduces the pre-template behaviour.
export function assembleComposition({ document, deal, version, lines, quoteSections, lang, template, sharedContent }) {
  const language = lang;
  const displayName = resolveDisplayProductName(document, deal, language);
  const ctx = { document, deal, version, lines, quoteSections, lang: language, displayName, template, sharedContent };

  const overrides = document?.overrideState?.blocks || {};
  const warnings = [];
  const blocks = getOrderedBlocks(document?.compositionDraft, template?.sections).map((b, i) => {
    const assembled = b.hidden ? { data: null, warnings: [] } : assembleBlock(b.type, ctx);
    const ov = overrides[b.key] || null;
    let data = assembled.data;
    let overridden = false;

    if (!b.hidden && data) {
      // Title override (content blocks) and whole-body HTML override. A section
      // block (items[]) gets a `customHtml` that the renderer shows instead of the
      // items; a single-HTML content block gets its `html` replaced.
      if (isFilled(ov?.title)) { data = { ...data, title: ov.title }; overridden = true; }
      if (isFilled(ov?.html)) {
        data = data.items !== undefined ? { ...data, customHtml: ov.html } : { ...data, html: ov.html };
        overridden = true;
      }
    }
    // Column-backed overrides count as "edited" for their blocks.
    if ((b.type === 'hero' || b.type === 'tour_details') && isFilled(document?.displayProductName)) overridden = true;

    // Hidden blocks never warn; an HTML override supplies content, so it clears
    // that block's missing-content warnings.
    const blockWarnings = b.hidden || isFilled(ov?.html) ? [] : assembled.warnings;
    for (const wn of blockWarnings) warnings.push({ ...wn, blockKey: b.key });

    return {
      key: b.key,
      type: b.type,
      kind: b.kind,
      optional: !!b.optional,
      removable: b.removable !== false,
      sortOrder: i,
      hidden: !!b.hidden,
      source: SOURCE_LABELS[b.type] || null,
      editTarget: editTargetFor(b.type, deal),
      overridden,
      data,
    };
  });

  return {
    quoteDocumentId: document.id,
    language,
    displayProductName: displayName,
    displayProductNameOverridden: isFilled(document?.displayProductName),
    quoteVersionId: version?.id ?? document.quoteVersionId ?? null,
    blocks,
    warnings,
  };
}

// What the composer needs from the Deal. Kept here so the loader and any test
// fixtures agree on shape.
const DEAL_INCLUDE = {
  product: true,
  productVariant: {
    include: {
      meetingPointImage: true,
      galleryImages: { include: { mediaFile: true }, orderBy: { sortOrder: 'asc' } },
    },
  },
  location: { include: { meetingPointImage: true } },
  organization: { include: { organizationType: true } },
  organizationType: true,
  organizationSubtype: true,
  paymentTerm: true,
  paymentMethodRef: true,
  contacts: { include: { contact: true } },
};

// Client-injected loader: read everything and assemble. Read-only — no produce,
// no persist. Returns { model } or { error }.
export async function composeQuoteDraftPreview(client, id) {
  const document = await client.quoteDocument.findUnique({ where: { id } });
  if (!document) return { error: 'not_found' };

  const deal = await client.deal.findUnique({ where: { id: document.dealId }, include: DEAL_INCLUDE });
  if (!deal) return { error: 'deal_not_found' };

  const version = await client.quoteVersion.findUnique({ where: { id: document.quoteVersionId } });
  const lines = await client.quoteLine.findMany({
    where: { quoteVersionId: document.quoteVersionId },
    orderBy: { sortOrder: 'asc' },
  });
  const quoteSections = await client.quoteSection.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } });
  // Global default layout (hero, section order, technical fields). Normalised;
  // absent row → DEFAULT_LAYOUT, which reproduces pre-template output.
  const template = await getQuoteTemplate(client);

  // Dual-read (Slice 2): resolve the variant's meeting-point Shared Content
  // (variant link → location default). null when the variant has none, in which
  // case buildTourDetails falls back to the legacy columns.
  const meetingPoint = deal.productVariantId
    ? (await resolveVariantSharedContent(client, deal.productVariantId, 'meeting_point')).block
    : null;
  const sharedContent = { meetingPoint };

  const model = assembleComposition({ document, deal, version, lines, quoteSections, lang: document.language, template, sharedContent });
  return { model };
}
