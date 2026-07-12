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
import { effectiveOrgType, effectiveOrgTypeId } from '../deals/classification.js';
export { DEFAULT_QUOTE_BLOCKS };

const isFilled = (v) => typeof v === 'string' && v.trim() !== '';

// Language-aware pick: returns the selected-language value, or null if it is
// missing/empty. NEVER falls back to the other language (no silent fallback, no
// auto-translate). Callers turn a null into a structured warning.
export function pickLang(he, en, lang) {
  const v = lang === 'en' ? en : he;
  return isFilled(v) ? v : null;
}

function warn(blockKey, type, field, language, extra) {
  return { code: 'missing_content', blockKey, type, field, language, ...(extra || {}) };
}

// The OTHER quote language ('he' ↔ 'en') — used to report whether a
// missing-in-this-language source actually has content in the other language
// (admin diagnostics only; pickLang itself stays strictly no-fallback).
const otherLang = (lang) => (lang === 'en' ? 'he' : 'en');

function hasOtherLang(he, en, lang) {
  return !!pickLang(he, en, otherLang(lang));
}

// Human-facing source metadata per block type (admin "where does this come from").
const SOURCE_LABELS = {
  hero: 'Deal',
  program: 'Product Variant',
  video: 'Quote Structure · Video',
  image_slot_1: 'Product Variant · Image Library',
  image_slot_2: 'Product Variant · Image Library',
  tour_details: 'Deal · Product · Location',
  pricing: 'QuoteVersion (Builder)',
  signature: 'Signers',
  product_marketing: 'Product',
  city_content: 'Location',
  why_us: 'OrganizationType / Subtype',
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
// LEGACY fallback only — per-variant hero selection now lives in the Quote
// Image Library references (see variantQuoteImages below).
function heroImageUrl(deal) {
  const v = deal?.productVariant;
  return v?.galleryImages?.[0]?.mediaFile?.url || v?.meetingPointImage?.url || deal?.location?.meetingPointImage?.url || null;
}

// The variant's Quote Image Library references for one position (hero | slot1 |
// slot2), in display order, keeping only renderable entries (image uploaded).
// The library entry is the source of truth; the variant only points at it.
function variantQuoteImages(deal, position) {
  const links = deal?.productVariant?.quoteImageLinks;
  if (!Array.isArray(links)) return [];
  return links.filter((l) => l?.position === position && l?.quoteImage?.mediaFile?.url);
}

// "Edit at source" target per section — the Quote orchestrates the existing GOS
// editors instead of duplicating them. Routing lives HERE (one place), so the UI
// just follows it. `dialog:true` → open as an overlay (the Builder); otherwise the
// UI opens the source editor (temporarily a side tab) and refreshes on return.
// `inline:true` → quote-owned presentation, edited in the document itself.
export function editTargetFor(type, deal, lang) {
  switch (type) {
    case 'hero': return { kind: 'deal', label: 'ערוך פרטי לקוח' };
    case 'program': return { kind: 'product', label: 'ערוך תוכן התוכנית (וריאציה)', id: deal?.productId || null };
    case 'video': return { kind: 'quoteStructure', label: 'ערוך וידאו', tab: 'video' };
    // Image slots are configured on the Product Variant (library references);
    // the library itself is managed in Quote Structure → Images.
    case 'image_slot_1':
    case 'image_slot_2': return { kind: 'product', label: 'ערוך תמונות ההצעה (וריאציה)', id: deal?.productId || null };
    case 'tour_details': return { kind: 'deal', label: 'ערוך פרטי הסיור' };
    case 'pricing': return { kind: 'builder', label: 'ערוך תמחור', dialog: true };
    case 'product_marketing': return { kind: 'product', label: 'ערוך מוצר', id: deal?.productId || null };
    // "למה גרפיטיול" — edit the ACTIVE source: the Organization Subtype when it
    // currently provides the content (in the quote language), otherwise the
    // Organization Type. Mirrors the content resolution in buildWhyGrafitiyul, so
    // the admin always lands on the source actually feeding the quote.
    case 'why_us': {
      const sub = deal?.organizationSubtype;
      const subActive = !!(sub && isFilled(pickLang(sub.quoteContentHe, sub.quoteContentEn, lang)));
      return subActive
        ? { kind: 'orgSubtype', label: 'ערוך תוכן “למה גרפיטיול” (תת-סוג הארגון)', id: deal?.organizationSubtypeId || sub?.id || null }
        : { kind: 'orgType', label: 'ערוך תוכן “למה גרפיטיול” (סוג הארגון)', id: effectiveOrgTypeId(deal) };
    }
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
      // Hero image precedence: the variant's own hero pick from the Quote Image
      // Library wins; the Quote Structure (global template) hero is the default
      // when the variant chose nothing; the Deal's legacy product/location
      // imagery is the last fallback; renderer draws a gradient if all are null.
      // This rule lives HERE (shared composition) so preview and produced/frozen
      // snapshots cannot diverge. Existing frozen quotes are unaffected — they
      // read renderModelSnapshot, never this composer.
      heroImageUrl:
        variantQuoteImages(deal, 'hero')[0]?.quoteImage?.mediaFile?.url ||
        hero?.image?.url ||
        heroImageUrl(deal) ||
        null,
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
  if (v && !html) {
    warnings.push(warn('program', 'program', 'program', lang, {
      otherLanguageHasContent: hasOtherLang(v?.programHe, v?.programEn, lang),
    }));
  }
  return { data: { title: sectionTitle(template, 'program', lang), html }, warnings };
}

// Video (YouTube) — the Video Library holds many videos, each assigned to specific
// Product Variants (a variant belongs to at most one video). Videos are
// LANGUAGE-DEPENDENT media (MEDIA_LANGUAGE_POLICY): each entry carries parallel
// He/En URLs and the quote uses STRICTLY the URL of its own language — never the
// other language's video. A video is "configured" for the variant when it has a
// URL in ANY language; if the quote's language is the missing one, data.url is
// null (renderer skips the section) and a missing_content warning surfaces in
// the admin UI. Output shape is unchanged ({ title, url }) so frozen snapshots
// and the renderer are unaffected. The renderer parses the URL into a safe
// embed at render time (reusing the shared embed parser).
function buildVideo({ deal, lang, template }) {
  const variantId = deal?.productVariantId || deal?.productVariant?.id || null;
  const videos = Array.isArray(template?.videos) ? template.videos : [];
  const match = variantId
    ? videos.find((v) => v && (v.urlHe || v.urlEn) && Array.isArray(v.variantIds) && v.variantIds.includes(variantId))
    : null;
  if (!match) return { data: { url: null }, warnings: [] };
  const url = pickLang(match.urlHe, match.urlEn, lang);
  if (!url) return { data: { url: null }, warnings: [warn('video', 'video', 'url', lang)] };
  const title = pickLang(match.titleHe, match.titleEn, lang) || (lang === 'en' ? 'Video' : 'סרטון');
  return { data: { title, url }, warnings: [] };
}

// Quote Image Library — one position (slot1|slot2). Renders the variant's
// ORDERED library references for the position: zero images → the renderer
// skips the slot; several → they show together in that section. Captions are
// the library titles, language-picked. The section title (Quote Structure) is
// carried for the sections list; the renderer shows the images, not a heading.
// `imageUrl`/`caption` mirror images[0] for back-compat: produced documents
// frozen BEFORE the library refactor carry only the single-image shape, and
// the renderer accepts both.
function buildImageSlot({ deal, lang, template, slot, blockKey }) {
  const title = sectionTitle(template, blockKey, lang);
  const images = variantQuoteImages(deal, slot).map((l) => ({
    url: l.quoteImage.mediaFile.url,
    caption: pickLang(l.quoteImage.titleHe, l.quoteImage.titleEn, lang),
  }));
  if (!images.length) return { data: { title, imageUrl: null, images: [] }, warnings: [] };
  return { data: { title, imageUrl: images[0].url, caption: images[0].caption, images }, warnings: [] };
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
  // language, falling back to the Hebrew name (never a warning). Source is the
  // Deal's location; when the Deal has no explicit location it falls back to the
  // chosen Product Variant's location, so the "city" tile still shows (a deal that
  // picks a variant always has a resolvable city). This is ONLY for the city label
  // — the meeting point keeps reading the Deal's own location above.
  const cityLocation = location || variant?.location || null;
  const city = pickLang(cityLocation?.nameHe, cityLocation?.nameEn, lang) || cityLocation?.nameHe || null;
  return {
    data: {
      title: sectionTitle(template, 'tour_details', lang),
      productName: displayName,
      city,
      tourDate: deal?.tourDate || null,
      tourTime: deal?.tourTime || null,
      participants: deal?.participants ?? null,
      // Tour duration: the Deal has none of its own today, so it comes from the
      // selected Product Variant. Structured as a deal→variant fallback so the tile
      // shows whenever EITHER has a value (deal override is future-proofing).
      durationHours: (typeof deal?.durationHours === 'number' ? deal.durationHours : variant?.durationHours) ?? null,
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
      // Payment terms/method shown INSIDE the pricing section (presentation only;
      // no engine/calculation change).
      paymentTerm: deal?.paymentTerm ? pickLang(deal.paymentTerm.nameHe, deal.paymentTerm.nameEn, lang) : null,
      paymentMethod: deal?.paymentMethodRef ? pickLang(deal.paymentMethodRef.nameHe, deal.paymentMethodRef.nameEn, lang) : null,
    },
    warnings: [],
  };
}


function buildSignature({ template, lang }) {
  // No signer infrastructure wired in this slice — placeholder slot shape only.
  // Heading comes from the Quote Template like every other configurable section.
  return { data: { title: sectionTitle(template, 'signature', lang), signerSlots: [] }, warnings: [] };
}

// ── Content block builders (pure, language-aware) ────────────────────────────

// Product Details — CONTENT from the selected Product Variant (variant → product,
// same language; not a language fallback). TITLE from the Quote Template.
function buildProductMarketing({ deal, lang, template }) {
  const v = deal?.productVariant;
  const p = deal?.product;
  const html = pickLang(v?.marketingDescHe, v?.marketingDescEn, lang) || pickLang(p?.marketingDescHe, p?.marketingDescEn, lang);
  const warnings = [];
  if ((v || p) && !html) {
    warnings.push(warn('product_marketing', 'product_marketing', 'marketingDesc', lang, {
      otherLanguageHasContent:
        hasOtherLang(v?.marketingDescHe, v?.marketingDescEn, lang) || hasOtherLang(p?.marketingDescHe, p?.marketingDescEn, lang),
    }));
  }
  return { data: { title: sectionTitle(template, 'product_marketing', lang), html }, warnings };
}

function buildCityContent({ deal, lang }) {
  const loc = deal?.location;
  const html = pickLang(loc?.marketingDescHe, loc?.marketingDescEn, lang);
  const warnings = [];
  if (loc && !html) {
    warnings.push(warn('city_content', 'city_content', 'marketingDesc', lang, {
      otherLanguageHasContent: hasOtherLang(loc?.marketingDescHe, loc?.marketingDescEn, lang),
    }));
  }
  return { data: { html }, warnings };
}

// "למה גרפיטיול?" — TITLE from the Quote Template; CONTENT from the Organization
// Subtype (override) → the EFFECTIVE Organization Type (the linked org's type
// when an org is attached, else the deal's own — see deals/classification.js).
// This is the single source of truth for this section's copy — it is NOT
// duplicated on deals or variants. Empty → skipped.
function buildWhyGrafitiyul({ deal, lang, template }) {
  const sub = deal?.organizationSubtype;
  const type = effectiveOrgType(deal);
  const html = pickLang(sub?.quoteContentHe, sub?.quoteContentEn, lang) || pickLang(type?.quoteContentHe, type?.quoteContentEn, lang);
  const warnings = [];
  if ((sub || type) && !html) {
    warnings.push(warn('why_grafitiyul', 'why_us', 'quoteContent', lang, {
      otherLanguageHasContent:
        hasOtherLang(sub?.quoteContentHe, sub?.quoteContentEn, lang) || hasOtherLang(type?.quoteContentHe, type?.quoteContentEn, lang),
    }));
  }
  return { data: { title: sectionTitle(template, 'why_grafitiyul', lang), html }, warnings };
}

// Reusable QuoteSection content, selected by category. Deterministic order:
// sortOrder, then id as a stable tiebreak. Each item warns if its rich text is
// missing in the quote language. The SECTION heading comes from the Quote Template
// (blockKey); the per-item titles stay from the QuoteSection rows.
function buildSectionContent({ quoteSections, category, blockKey, lang, template }) {
  const rows = (quoteSections || [])
    .filter((s) => s.active !== false && s.category === category)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.id).localeCompare(String(b.id)));
  const warnings = [];
  const items = rows.map((s) => {
    const html = pickLang(s.richTextHe, s.richTextEn, lang);
    if (!html) warnings.push(warn(blockKey, category, `richText:${s.id}`, lang));
    return { id: s.id, title: pickLang(s.titleHe, s.titleEn, lang) || s.titleHe || null, html };
  });
  return { data: { title: sectionTitle(template, blockKey, lang), items }, warnings };
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

function assembleBlock(type, ctx) {
  switch (type) {
    case 'hero': return buildHero(ctx);
    case 'program': return buildProgram(ctx);
    case 'video': return buildVideo(ctx);
    case 'image_slot_1': return buildImageSlot({ ...ctx, slot: 'slot1', blockKey: 'image_slot_1' });
    case 'image_slot_2': return buildImageSlot({ ...ctx, slot: 'slot2', blockKey: 'image_slot_2' });
    case 'tour_details': return buildTourDetails(ctx);
    case 'pricing': return buildPricing(ctx);
    case 'signature': return buildSignature(ctx);
    case 'product_marketing': return buildProductMarketing(ctx);
    case 'city_content': return buildCityContent(ctx);
    case 'why_us': return buildWhyGrafitiyul(ctx);
    case 'faq': return buildSectionContent({ ...ctx, category: 'faq', blockKey: 'faq' });
    case 'cancellation': return buildSectionContent({ ...ctx, category: 'cancellation', blockKey: 'cancellation' });
    case 'participant_policy': return buildSectionContent({ ...ctx, category: 'participant_policy', blockKey: 'participant_policy' });
    case 'terms': return buildSectionContent({ ...ctx, category: 'terms', blockKey: 'terms' });
    default: return { data: null, warnings: [] };
  }
}

// Block order + visibility — SINGLE SOURCE OF TRUTH: the global Quote Structure
// template (`template.sections`). There is NO per-quote order override any more;
// every quote follows Quote Structure, so the settings list and the produced quote
// can never diverge. `template.sections` is already normalised (canonical for
// legacy layouts, drag-order preserved for versioned ones); here we just reconcile
// against the canonical set as a safety net (insert any missing canonical block at
// its position, drop stale keys, preserve hidden-by-key) and pin Hero first.
function getOrderedBlocks(templateSections) {
  const source = Array.isArray(templateSections) && templateSections.length ? templateSections : null;
  if (!source) return DEFAULT_QUOTE_BLOCKS.map((b) => ({ ...b, hidden: false }));
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
  // Hero is the document HEADER, not a content block: always present, never hidden,
  // always first — the one explicit exception to the block order.
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
  const blocks = getOrderedBlocks(template?.sections).map((b, i) => {
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
      editTarget: editTargetFor(b.type, deal, language),
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
      // The variant's own location — a fallback source for the "city" tile when the
      // Deal has no explicit location set.
      location: true,
      meetingPointImage: true,
      galleryImages: { include: { mediaFile: true }, orderBy: { sortOrder: 'asc' } },
      // Quote Image Library references (hero | slot1 | slot2), in display order.
      quoteImageLinks: {
        orderBy: [{ position: 'asc' }, { sortOrder: 'asc' }],
        include: { quoteImage: { include: { mediaFile: { select: { id: true, url: true } } } } },
      },
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

// Offer-owned commercial context (contextMode='own'): the effective composition
// context is the DEAL overlaid with the offer's product/variant/location/
// participants/date/time/valueMinor — a parallel offer composes from ITS OWN
// context and is immune to Deal edits. The primary offer is always
// contextMode='deal' (the Deal IS the primary), so it passes through untouched.
// Customer/org/payment/contact identity always stays Deal-level.
export async function resolveEffectiveDeal(client, deal, offerId) {
  if (!offerId) return deal;
  const offer = await client.quoteOffer.findUnique({ where: { id: offerId } });
  if (!offer || offer.contextMode !== 'own') return deal;

  const [product, productVariant, location] = await Promise.all([
    offer.productId ? client.product.findUnique({ where: { id: offer.productId } }) : null,
    offer.productVariantId
      ? client.productVariant.findUnique({ where: { id: offer.productVariantId }, include: DEAL_INCLUDE.productVariant.include })
      : null,
    offer.locationId
      ? client.location.findUnique({ where: { id: offer.locationId }, include: DEAL_INCLUDE.location.include })
      : null,
  ]);

  return {
    ...deal,
    productId: offer.productId,
    product,
    productVariantId: offer.productVariantId,
    productVariant,
    locationId: offer.locationId,
    location,
    participants: offer.participants,
    tourDate: offer.tourDate,
    tourTime: offer.tourTime,
    valueMinor: offer.valueMinor,
  };
}

// PURE: merge a TEMPORARY override overlay on top of the persisted override
// state. Field-level, overlay wins. Persisted overrides are the Deal's lasting
// customization (carried into every future version); the overlay is one-shot —
// used for a single preview/produce and never written to the draft.
export function mergeOverrideState(base, overlay) {
  if (!overlay || typeof overlay !== 'object' || !overlay.blocks) return base ?? null;
  const baseBlocks = base?.blocks || {};
  const overlayBlocks = overlay.blocks || {};
  const blocks = {};
  for (const key of new Set([...Object.keys(baseBlocks), ...Object.keys(overlayBlocks)])) {
    blocks[key] = { ...(baseBlocks[key] || {}), ...(overlayBlocks[key] || {}) };
  }
  return { blocks };
}

// Client-injected loader: read everything and assemble. Read-only — no produce,
// no persist. Returns { model } or { error }. opts.overrideOverlay applies a
// one-shot override layer (see mergeOverrideState) without touching the draft.
export async function composeQuoteDraftPreview(client, id, opts = {}) {
  const stored = await client.quoteDocument.findUnique({ where: { id } });
  if (!stored) return { error: 'not_found' };
  const document = opts.overrideOverlay
    ? { ...stored, overrideState: mergeOverrideState(stored.overrideState, opts.overrideOverlay) }
    : stored;

  const dealRow = await client.deal.findUnique({ where: { id: document.dealId }, include: DEAL_INCLUDE });
  if (!dealRow) return { error: 'deal_not_found' };
  // Non-primary offers compose from THEIR OWN commercial context (immune to
  // Deal edits); the primary offer passes through as-is (Deal ≡ primary).
  const deal = await resolveEffectiveDeal(client, dealRow, document.offerId);

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

// A finalised document is LOCKED: it cannot be signed (again). 'produced' is
// NOT locked — it is the signable state: every generated document is already
// frozen (renderModelSnapshot written at produce time), and signing locks it.
const LOCKED_STATUSES = ['accepted', 'rejected', 'expired'];
export function isLockedStatus(status) {
  return LOCKED_STATUSES.includes(status);
}

// The newest produced/accepted version of the SAME offer that is newer than
// `document`, or null. Offers never supersede each other — only versions within
// one offer chain do. Shared by the public page (replacement screen) and the
// sign guard (a superseded version must not be signable).
export async function findNewerVersion(client, document) {
  if (!document?.offerId || document?.versionNo == null) return null;
  return client.quoteDocument.findFirst({
    where: {
      offerId: document.offerId,
      status: { in: ['produced', 'accepted'] },
      versionNo: { gt: document.versionNo },
    },
    orderBy: { versionNo: 'desc' },
    select: { id: true, publicToken: true, versionNo: true },
  });
}

// Strip per-block admin fields (editTarget / source / warnings / overridden); keep
// only what the renderer consumes. This is also the exact shape frozen into
// renderModelSnapshot at sign time, so "what was signed" is what re-renders.
export function toPublicModel(model) {
  const blocks = (model?.blocks || []).map((b) => ({
    key: b.key,
    type: b.type,
    kind: b.kind,
    sortOrder: b.sortOrder,
    hidden: b.hidden,
    data: b.data,
  }));
  return { language: model?.language || 'he', blocks };
}

// Customer-safe view of the audit record (never leaks createdBy internals).
export function toPublicSignature(sig) {
  if (!sig) return null;
  return {
    method: sig.method, // typed | uploaded | drawn
    signerName: sig.signerName,
    signatureImage: sig.signatureImage || null,
    signedAt: sig.signedAt,
    ipAddress: sig.ipAddress || null,
    userAgent: sig.userAgent || null,
    language: sig.language,
    timezone: sig.timezone || null,
  };
}

function headerFromModel(model) {
  const hero = (model?.blocks || []).find((b) => b.type === 'hero')?.data || {};
  return {
    customerName: hero.customerName || null,
    organizationName: hero.organizationName || null,
    productName: hero.productName || null,
  };
}

// Public customer-facing compose: look up the QuoteDocument by its capability
// token and return ONLY what the customer page needs. Rules (product-locked):
//   * Drafts are NEVER public — customers only ever receive produced URLs.
//   * A produced document renders its FROZEN snapshot (written at produce time);
//     what the customer sees can never silently change under them.
//   * A SIGNED document renders forever at its URL (it is the audit record of
//     what was signed) — no supersede/expiry screen can replace it.
//   * An unsigned version superseded by a newer version of the SAME offer does
//     not render its content: the customer gets state='superseded' + the latest
//     version's token ("ההצעה הזו כבר לא רלוונטית…"). Parallel offers are
//     independent paths and never supersede each other.
export async function composeQuoteByPublicToken(client, token) {
  if (!token || typeof token !== 'string') return { error: 'not_found' };
  const document = await client.quoteDocument.findUnique({
    where: { publicToken: token },
    include: { signature: true },
  });
  if (!document || document.status === 'draft') return { error: 'not_found' };

  const signed = !!document.signature;

  if (!signed) {
    if (document.expiresAt && document.expiresAt.getTime() < Date.now()) {
      return { result: { state: 'expired', doc: { language: document.language } } };
    }
    const newer = await findNewerVersion(client, document);
    if (newer) {
      return {
        result: {
          state: 'superseded',
          latestToken: newer.publicToken,
          doc: { language: document.language },
        },
      };
    }
  }

  const locked = isLockedStatus(document.status) || signed;
  const template = await getQuoteTemplate(client);

  let model;
  if (document.renderModelSnapshot) {
    model = document.renderModelSnapshot; // already a sanitised public model
  } else {
    // Legacy safety net only (pre-offer documents produced before freeze-at-
    // generation existed). Every new produce writes the snapshot.
    const composed = await composeQuoteDraftPreview(client, document.id);
    if (composed.error) return composed;
    model = toPublicModel(composed.model);
  }

  return {
    result: {
      state: 'ok',
      model,
      doc: {
        status: document.status, // produced | accepted | rejected | expired
        language: document.language,
        publicToken: document.publicToken,
        versionNo: document.versionNo ?? null,
        locked,
      },
      contact: template.contact || { whatsapp: '', email: '' },
      header: headerFromModel(model),
      signature: toPublicSignature(document.signature),
    },
  };
}
