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

import { DEFAULT_QUOTE_BLOCKS } from './quoteBlocks.js';

const SINGLETON = 'global';

// Canonical section keys, in the approved default order. Derived from the code
// default so the two never drift.
const SECTION_KEYS = DEFAULT_QUOTE_BLOCKS.map((b) => b.key);

// Technical-detail fields the card can show today. Keys are stable ids; the
// icon/label live in the renderer (client) which mirrors this key list. Adding
// a new field later = add its key here + a data source in composer + a
// icon/label in the renderer. All visible by default → identical to today.
export const TECH_FIELD_KEYS = ['city', 'date', 'time', 'participants', 'duration', 'language'];

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

// Merge a saved ordered list against a canonical key set: keep the saved order
// for known keys, drop unknowns, append any canonical key the save is missing
// (in canonical order) so new blocks/fields never silently disappear.
function mergeOrdered(saved, canonicalKeys, flagName, defaultFlag) {
  const list = Array.isArray(saved) ? saved : [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const key = item && typeof item === 'object' ? item.key : null;
    if (!canonicalKeys.includes(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, [flagName]: !!item[flagName] });
  }
  for (const key of canonicalKeys) {
    if (!seen.has(key)) out.push({ key, [flagName]: defaultFlag });
  }
  return out;
}

// Normalise ANY input (saved row, API body, or null) into a complete, safe
// layout. Always returns every section and tech field exactly once.
export function normalizeLayout(raw) {
  const l = raw && typeof raw === 'object' ? raw : {};
  return {
    hero: normalizeHero(l.hero),
    // Hero is the document header: always first and never hidden, so the stored
    // template stays consistent with the UI (which shows it pinned, not in the
    // reorderable list). The composer enforces the same invariant at render.
    sections: pinHeroFirst(mergeOrdered(l.sections, SECTION_KEYS, 'hidden', false)),
    technical: {
      fields: mergeOrdered(l.technical?.fields, TECH_FIELD_KEYS, 'visible', true),
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
