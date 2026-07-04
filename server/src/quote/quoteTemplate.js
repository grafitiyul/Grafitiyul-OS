// Quote Layout Template — the GLOBAL default quote composition ("control center").
//
// One singleton row (QuoteTemplate). The layout is a single flexible JSON blob
// so the settings screen can grow (hero, sections, technical fields today;
// colors/fonts/PDF later) without a migration per option.
//
// SSOT rule: this is the DEFAULT SEED only. Precedence at compose time is
//   per-quote compositionDraft  →  this template  →  DEFAULT_QUOTE_BLOCKS (code)
// so the code constant stays the final fallback and nothing changes until an
// admin saves here. See composer.js `getOrderedBlocks`.
//
// The layout is always normalised through `normalizeLayout` on both read and
// write: unknown keys are dropped, missing keys are filled from DEFAULT_LAYOUT,
// and every known section/field is present exactly once (missing ones appended
// in canonical order). That keeps a future new block/field from vanishing just
// because an older saved layout predates it.

import { DEFAULT_QUOTE_BLOCKS, reconcileKeyOrder } from './quoteBlocks.js';

const SINGLETON = 'global';

// Stored-layout version. Bump when a normalization changes the MEANING of a stored
// value (here: the section order). A legacy layout (version < this) is migrated
// ONCE — its section order is re-canonicalised — because older code appended
// newly-added blocks (program, video) at the END instead of at their canonical
// position, leaving the Sections list out of sync with the actual quote. After the
// migration the version is stamped, so any deliberate drag-reorder made afterwards
// is preserved verbatim.
const LAYOUT_VERSION = 2;

// Canonical section keys, in the approved default order. Derived from the code
// default so the two never drift.
const SECTION_KEYS = DEFAULT_QUOTE_BLOCKS.map((b) => b.key);

// Technical-detail fields the card can show today. Keys are stable ids; the
// icon/label live in the renderer (client) which mirrors this key list. Adding
// a new field later = add its key here + a data source in composer + a
// icon/label in the renderer. All visible by default → identical to today.
export const TECH_FIELD_KEYS = ['city', 'date', 'time', 'participants', 'duration', 'language'];

// Configurable section titles — the ONE source of truth for these sections' localized
// headings. Order/visibility live in `sections`; the CONTENT lives with its owner
// (Product Variant for program/product details, the Pricing Builder for pricing).
// Everything that shows a title (the quote renderer + the Product Variant editor
// group) reads it from here, so a rename applies everywhere. Defaults match the
// renderer's previous built-in titles, so existing output is unchanged.
export const CONFIGURABLE_TITLE_KEYS = [
  'program', 'tour_details', 'product_marketing', 'why_grafitiyul', 'image_slot_1', 'pricing',
  'faq', 'cancellation', 'participant_policy', 'image_slot_2', 'signature',
];
export const SECTION_TITLE_DEFAULTS = {
  program: { titleHe: 'אז מה בתוכנית?', titleEn: "What's in the program?" },
  tour_details: { titleHe: 'פרטים טכניים', titleEn: 'Technical Details' },
  product_marketing: { titleHe: 'מה כולל הסיור?', titleEn: "What's Included?" },
  why_grafitiyul: { titleHe: 'למה גרפיטיול?', titleEn: 'Why Grafitiyul?' },
  image_slot_1: { titleHe: 'תמונה — מיקום 1', titleEn: 'Image — Slot 1' },
  pricing: { titleHe: 'כמה עולה?', titleEn: 'Pricing' },
  faq: { titleHe: 'שאלות נפוצות', titleEn: 'FAQ' },
  cancellation: { titleHe: 'מדיניות ביטול / דחייה', titleEn: 'Cancellation / Postponement' },
  participant_policy: { titleHe: 'מדיניות שינוי כמות המשתתפים', titleEn: 'Participant Quantity Change Policy' },
  image_slot_2: { titleHe: 'תמונה — מיקום 2', titleEn: 'Image — Slot 2' },
  signature: { titleHe: 'חתימה', titleEn: 'Signature' },
};

// Quote Image Library slots. Keys mirror the block keys so title/order/visibility
// use the same section mechanism as every other section.
export const IMAGE_SLOTS = ['slot1', 'slot2'];

// Legacy overlay presets (kept for backward compatibility with older saved
// layouts; the premium hero now uses an explicit color + opacity instead).
const OVERLAY_PRESETS = ['light', 'medium', 'dark'];

// Presentation enums for the premium hero cover.
const LOGO_POSITIONS = ['start', 'end']; // reading-start / reading-end corner (RTL-aware)
const LOGO_SIZES = ['sm', 'md', 'lg']; // legacy, kept for back-compat; logoSizePx is the source of truth
const CARD_POSITIONS = ['top-start', 'top-end', 'bottom-start', 'bottom-end'];
const TITLE_ALIGNS = ['start', 'center'];
const CONTENT_V = ['top', 'center', 'bottom']; // vertical anchor of the hero content column
const CARD_BLURS = ['none', 'sm', 'md', 'lg']; // glass blur strength
const CARD_FIELD_KEYS = ['preparedFor', 'org', 'generatedOn', 'preparedBy'];

const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const cleanText = (v) => (isStr(v) ? String(v).trim().slice(0, 300) : null);
const oneOf = (v, allowed, def) => (allowed.includes(v) ? v : def);
const hexOr = (v, def) => (isStr(v) && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim().toLowerCase() : def);
const pct = (v, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : def;
};
const intOr = (v, def, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
};
// Per-field visibility for the info card. Object of booleans; missing → visible.
function normalizeCardFields(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const k of CARD_FIELD_KEYS) out[k] = r[k] !== false;
  return out;
}

// The default layout REPRODUCES a calm, premium cover: dark overlay ~40%, logo
// top reading-start, dark-glass info card top reading-end. Older saved layouts
// missing the new keys simply pick up these defaults (no migration).
export const DEFAULT_LAYOUT = {
  v: LAYOUT_VERSION,
  hero: {
    titleHe: null,
    titleEn: null,
    subtitleHe: null,
    subtitleEn: null,
    image: null, // { id, url } | null — global default proposal hero image
    logo: null, // { id, url } | null — white brand logo (Quote Structure); null → bundled default
    overlay: 'dark', // legacy preset, retained for back-compat
    overlayEnabled: true,
    overlayColor: '#081220',
    overlayOpacity: 42, // 0–100
    logoPosition: 'start', // reading-start corner (top-right in RTL) — the reference default
    logoSize: 'md', // legacy enum, retained for back-compat
    logoSizePx: 56, // explicit logo height in px (source of truth); ~176px wide at the 660×210 lockup ratio
    logoMargin: 24, // logo inset from the hero corner, px
    contentV: 'center', // vertical anchor of the title + card column
    cardPosition: 'top-end', // legacy, retained for back-compat
    cardEnabled: true,
    cardOpacity: 70, // 0–100 (darkness of the glass info card)
    cardBlur: 'md',
    cardColor: '#081220',
    cardFields: { preparedFor: true, org: true, generatedOn: true, preparedBy: true },
    titleAlign: 'start',
  },
  sections: SECTION_KEYS.map((key) => ({ key, hidden: false })),
  technical: { fields: TECH_FIELD_KEYS.map((key) => ({ key, visible: true })) },
  // Localized titles for the configurable sections (source of truth). Content
  // itself is owned by each section's business entity, not here.
  sectionTitles: Object.fromEntries(CONFIGURABLE_TITLE_KEYS.map((k) => [k, { ...SECTION_TITLE_DEFAULTS[k] }])),
  // Video Library — zero or more videos, each shown only in quotes whose Product
  // Variant is assigned to it. A variant belongs to AT MOST ONE video (enforced on
  // normalize). Independent of Shared Content. Empty by default.
  videos: [],
  // Quote Image Library — zero or more images, each with a slot (slot1|slot2),
  // captions, and assigned variants. A variant belongs to AT MOST ONE image PER
  // SLOT (enforced on normalize), but may be assigned in both slots. Empty by default.
  images: [],
};

function normalizeImageRef(ref) {
  if (ref && typeof ref === 'object' && isStr(ref.url)) {
    return { id: isStr(ref.id) ? String(ref.id) : null, url: String(ref.url) };
  }
  return null;
}

function normalizeHero(raw) {
  const h = raw && typeof raw === 'object' ? raw : {};
  const D = DEFAULT_LAYOUT.hero;
  return {
    titleHe: cleanText(h.titleHe),
    titleEn: cleanText(h.titleEn),
    subtitleHe: cleanText(h.subtitleHe),
    subtitleEn: cleanText(h.subtitleEn),
    image: normalizeImageRef(h.image),
    logo: normalizeImageRef(h.logo),
    overlay: OVERLAY_PRESETS.includes(h.overlay) ? h.overlay : 'dark',
    overlayEnabled: typeof h.overlayEnabled === 'boolean' ? h.overlayEnabled : D.overlayEnabled,
    overlayColor: hexOr(h.overlayColor, D.overlayColor),
    overlayOpacity: pct(h.overlayOpacity, D.overlayOpacity),
    logoPosition: oneOf(h.logoPosition, LOGO_POSITIONS, D.logoPosition),
    logoSize: oneOf(h.logoSize, LOGO_SIZES, D.logoSize),
    logoSizePx: intOr(h.logoSizePx, D.logoSizePx, 28, 220),
    logoMargin: intOr(h.logoMargin, D.logoMargin, 0, 96),
    contentV: oneOf(h.contentV, CONTENT_V, D.contentV),
    cardPosition: oneOf(h.cardPosition, CARD_POSITIONS, D.cardPosition),
    cardEnabled: typeof h.cardEnabled === 'boolean' ? h.cardEnabled : D.cardEnabled,
    cardOpacity: pct(h.cardOpacity, D.cardOpacity),
    cardBlur: oneOf(h.cardBlur, CARD_BLURS, D.cardBlur),
    cardColor: hexOr(h.cardColor, D.cardColor),
    cardFields: normalizeCardFields(h.cardFields),
    titleAlign: oneOf(h.titleAlign, TITLE_ALIGNS, D.titleAlign),
  };
}

// Merge a saved ordered list against a canonical key set: drop unknown/stale keys,
// keep every canonical key exactly once, and preserve each key's flag by KEY (never
// by position). `mode` decides the ORDER:
//   • 'canonical' — ignore the saved order entirely; emit canonical order. Used to
//     MIGRATE a legacy sections list whose order is untrusted (older code appended
//     new blocks at the end).
//   • 'preserve'  — keep the saved order for known keys and INSERT any missing
//     canonical key at its canonical position (reconcileKeyOrder). Used for a
//     versioned sections list, so a deliberate drag-reorder survives.
//   • 'append'    — keep the saved order and append missing keys at the END. Used
//     for technical fields, so a custom field arrangement is never re-interleaved.
function mergeOrdered(saved, canonicalKeys, flagName, defaultFlag, mode = 'append') {
  const list = Array.isArray(saved) ? saved : [];
  const flags = new Map();
  const savedKeys = [];
  for (const item of list) {
    const key = item && typeof item === 'object' ? item.key : null;
    if (!canonicalKeys.includes(key) || flags.has(key)) continue;
    flags.set(key, !!item[flagName]);
    savedKeys.push(key);
  }
  let order;
  if (mode === 'canonical') order = [...canonicalKeys];
  else if (mode === 'preserve') order = reconcileKeyOrder(savedKeys, canonicalKeys);
  else order = [...savedKeys, ...canonicalKeys.filter((k) => !flags.has(k))];
  return order.map((key) => ({ key, [flagName]: flags.has(key) ? flags.get(key) : defaultFlag }));
}

// Configurable section titles. Each entry always resolves to a non-empty localized
// title (empty input → the built-in default), so a header never renders blank.
// Back-compat: an older layout stored the program title under `l.program`; it is
// read as the seed for sectionTitles.program when the new shape is absent.
function normalizeSectionTitles(raw, legacyProgram) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const key of CONFIGURABLE_TITLE_KEYS) {
    let src = r[key];
    if (key === 'program' && !(src && typeof src === 'object') && legacyProgram && typeof legacyProgram === 'object') {
      src = legacyProgram;
    }
    const s = src && typeof src === 'object' ? src : {};
    const def = SECTION_TITLE_DEFAULTS[key];
    out[key] = {
      titleHe: cleanText(s.titleHe) || def.titleHe,
      titleEn: cleanText(s.titleEn) || def.titleEn,
    };
  }
  return out;
}

// Video Library. Each item is its own entity { id, url, titleHe, titleEn,
// variantIds }; url/titles optional (empty → null). Two invariants are enforced
// HERE (the single source of truth), regardless of what the client sends:
//   • every video has a stable id;
//   • a Product Variant belongs to AT MOST ONE video — a variant claimed by an
//     earlier video is dropped from any later one (first occurrence wins).
// Back-compat: an older layout stored a single `video` object; it is migrated
// into a one-item library. No content copied from anywhere (no Shared Content).
let __videoIdSeq = 0;
function normalizeVideos(raw, legacyVideo) {
  let list = Array.isArray(raw) ? raw : [];
  if (!Array.isArray(raw) && legacyVideo && typeof legacyVideo === 'object' && isStr(legacyVideo.url)) {
    list = [legacyVideo];
  }
  const claimed = new Set();
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const ids = Array.isArray(item.variantIds) ? item.variantIds.filter(isStr).map((s) => String(s)) : [];
    const variantIds = [];
    for (const vid of ids) {
      if (!claimed.has(vid)) { claimed.add(vid); variantIds.push(vid); }
    }
    out.push({
      id: isStr(item.id) ? String(item.id) : `vid_${Date.now().toString(36)}_${__videoIdSeq++}`,
      url: cleanText(item.url),
      titleHe: cleanText(item.titleHe),
      titleEn: cleanText(item.titleEn),
      variantIds,
    });
  }
  return out;
}

// Quote Image Library. Each item is { id, image:{id,url}, slot, captionHe, captionEn,
// variantIds }. Same architecture as the video library, but the one-variant-one-item
// rule is enforced PER SLOT: a variant claimed by an earlier image IN THE SAME SLOT
// is dropped from later images of that slot — yet the same variant may be assigned in
// both slots (they are different places in the quote). image/captions optional; every
// item gets a stable id and a valid slot. Nothing is copied from anywhere else.
let __imageIdSeq = 0;
function normalizeImages(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const claimedBySlot = { slot1: new Set(), slot2: new Set() };
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const slot = IMAGE_SLOTS.includes(item.slot) ? item.slot : 'slot1';
    const claimed = claimedBySlot[slot];
    const ids = Array.isArray(item.variantIds) ? item.variantIds.filter(isStr).map((s) => String(s)) : [];
    const variantIds = [];
    for (const vid of ids) {
      if (!claimed.has(vid)) { claimed.add(vid); variantIds.push(vid); }
    }
    out.push({
      id: isStr(item.id) ? String(item.id) : `img_${Date.now().toString(36)}_${__imageIdSeq++}`,
      image: normalizeImageRef(item.image),
      slot,
      captionHe: cleanText(item.captionHe),
      captionEn: cleanText(item.captionEn),
      variantIds,
    });
  }
  return out;
}

// Normalise ANY input (saved row, API body, or null) into a complete, safe
// layout. Always returns every section and tech field exactly once.
export function normalizeLayout(raw) {
  const l = raw && typeof raw === 'object' ? raw : {};
  // A legacy layout (no/old version) has an untrusted section order — older code
  // appended new blocks at the end. Migrate it ONCE to canonical order; a versioned
  // layout keeps its deliberate order (drag-reorder) and only slots in new blocks.
  const migrated = Number(l.v) >= LAYOUT_VERSION;
  return {
    v: LAYOUT_VERSION,
    hero: normalizeHero(l.hero),
    sectionTitles: normalizeSectionTitles(l.sectionTitles, l.program),
    videos: normalizeVideos(l.videos, l.video),
    images: normalizeImages(l.images),
    // Hero is the document header: always first and never hidden, so the stored
    // template stays consistent with the UI (which shows it pinned, not in the
    // reorderable list). The composer enforces the same invariant at render.
    sections: pinHeroFirst(mergeOrdered(l.sections, SECTION_KEYS, 'hidden', false, migrated ? 'preserve' : 'canonical')),
    technical: {
      fields: mergeOrdered(l.technical?.fields, TECH_FIELD_KEYS, 'visible', true, 'append'),
    },
  };
}

function pinHeroFirst(sections) {
  const rest = sections.filter((s) => s.key !== 'hero');
  return [{ key: 'hero', hidden: false }, ...rest];
}

// Read the singleton layout, normalised. Returns DEFAULT_LAYOUT when no row
// exists (behaviour identical to today).
export async function getQuoteTemplate(client) {
  const row = await client.quoteTemplate.findUnique({ where: { singleton: SINGLETON } });
  return normalizeLayout(row?.layout);
}

// Upsert the singleton layout. Body is normalised before storing, so the table
// never holds unknown keys or a partial layout.
export async function updateQuoteTemplate(client, body) {
  const layout = normalizeLayout(body);
  const row = await client.quoteTemplate.upsert({
    where: { singleton: SINGLETON },
    create: { singleton: SINGLETON, layout },
    update: { layout },
  });
  return normalizeLayout(row.layout);
}
