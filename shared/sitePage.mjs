// THE content contract for the "דפי אתר" module — shared by the server (storage,
// publish, public render) and the client (editor, preview).
//
// One shape, one normalizer, one section-type registry. The editor cannot invent
// a section the renderer does not know, and the renderer cannot receive a shape
// the editor could not produce, because both import THIS file.
//
// A page document is deliberately plain JSON rather than columns: sections are
// heterogeneous and ordered, and the set of section types grows. What must never
// drift — the type list, the per-type fields, the ordering/visibility semantics —
// is pinned here and asserted by sitePage.test.js.

/** Business kinds of page. Presentation only; every type renders the same way. */
export const PAGE_TYPES = [
  { key: 'info', label: 'עמוד מידע' },
  { key: 'logistics', label: 'עמוד לוגיסטי' },
  { key: 'recommendations', label: 'עמוד המלצות' },
  { key: 'landing', label: 'עמוד נחיתה' },
  { key: 'faq', label: 'שאלות ותשובות' },
  { key: 'campaign', label: 'עמוד קמפיין' },
  { key: 'seo', label: 'עמוד תוכן / SEO' },
  { key: 'price_list', label: 'מחירון' },
];
export const PAGE_TYPE_KEYS = PAGE_TYPES.map((t) => t.key);

// ── Section types ───────────────────────────────────────────────────────────
// `fields` documents what an editor renders and what the normalizer keeps.
// Anything not listed is dropped on normalize — that is the whitelist that stops
// a stored document from carrying junk into the public renderer.
export const SECTION_TYPES = [
  { key: 'hero', label: 'כותרת ראשית', glyph: '🏷️', fields: ['titleHe', 'titleEn', 'subtitleHe', 'subtitleEn', 'image'] },
  { key: 'richText', label: 'טקסט עשיר', glyph: '📝', fields: ['headingHe', 'headingEn', 'htmlHe', 'htmlEn'] },
  { key: 'image', label: 'תמונה', glyph: '🖼️', fields: ['image', 'altHe', 'altEn', 'captionHe', 'captionEn'] },
  { key: 'imageText', label: 'תמונה + טקסט', glyph: '📰', fields: ['image', 'altHe', 'altEn', 'headingHe', 'headingEn', 'htmlHe', 'htmlEn', 'imageSide'] },
  { key: 'cards', label: 'כרטיסי המלצה', glyph: '⭐', fields: ['headingHe', 'headingEn', 'noteHe', 'noteEn', 'cards'] },
  { key: 'faq', label: 'שאלות נפוצות', glyph: '❓', fields: ['headingHe', 'headingEn', 'items'] },
  { key: 'cta', label: 'קריאה לפעולה', glyph: '🔔', fields: ['headingHe', 'headingEn', 'bodyHe', 'bodyEn', 'buttonLabelHe', 'buttonLabelEn', 'buttonUrl'] },
  { key: 'pricing', label: 'מחירון', glyph: '💰', fields: ['headingHe', 'headingEn', 'noteHe', 'noteEn', 'rows'] },
  { key: 'divider', label: 'קו מפריד', glyph: '➖', fields: [] },
];
export const SECTION_TYPE_KEYS = SECTION_TYPES.map((t) => t.key);
export const sectionType = (key) => SECTION_TYPES.find((t) => t.key === key) || null;

/** Fields of ONE recommendation card. Kept flat: every one is operator-editable. */
export const CARD_FIELDS = [
  'name', 'descriptionHe', 'descriptionEn', 'category',
  'address', 'phone', 'hours', 'kosher', 'notes', 'website', 'mapUrl', 'image',
];

/**
 * Fields of ONE pricing row (a sellable item on a price-list page) and its
 * price lines. Amounts are integer minor units (agorot) — numbers, never
 * strings, so the renderer/comparators never parse display text.
 *
 * `variantId` / `cardGroupId` are INTERNAL references to the canonical
 * ProductVariant / Pricing Card used only for drift detection in the editor;
 * the public renderer never emits them. Published amounts are the frozen
 * `lines` values — a Pricing Card edit after publish changes nothing until an
 * operator deliberately republishes (the editor shows the drift).
 */
export const PRICING_LINE_KINDS = ['fixed', 'tier', 'extra', 'custom'];

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const bool = (v) => v === true;
const intOrNull = (v) => {
  if (v == null || v === '') return null; // Number(null) is 0 — never invent a price
  const n = Number(v);
  return Number.isFinite(n) && Number.isInteger(n) && n >= 0 ? n : null;
};

let seq = 0;
/** Stable-enough id for a new section/card created in the editor. */
export function newId(prefix = 'sec') {
  seq += 1;
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${seq.toString(36)}`;
}

export function makeSection(type) {
  const t = sectionType(type);
  if (!t) throw new Error(`unknown section type: ${type}`);
  const s = { id: newId('sec'), type, hidden: false };
  for (const f of t.fields) {
    if (f === 'cards' || f === 'items') s[f] = [];
    else if (f === 'imageSide') s[f] = 'start';
    else s[f] = '';
  }
  return s;
}

export function makeCard() {
  const c = { id: newId('card'), hidden: false };
  for (const f of CARD_FIELDS) c[f] = '';
  return c;
}

export function makePricingLine(kind = 'tier') {
  return {
    id: newId('pl'),
    kind: PRICING_LINE_KINDS.includes(kind) ? kind : 'custom',
    upto: null,
    amountMinor: null,
    labelHe: '',
    labelEn: '',
  };
}

export function makePricingRow() {
  return {
    id: newId('pr'),
    hidden: false,
    titleHe: '',
    titleEn: '',
    metaHe: '',
    metaEn: '',
    notesHe: '',
    notesEn: '',
    lines: [],
    variantId: '',
    cardGroupId: '',
  };
}

export function emptyDocument() {
  return {
    titleHe: '',
    titleEn: '',
    sections: [],
    seo: {
      titleHe: '', titleEn: '',
      descriptionHe: '', descriptionEn: '',
      canonicalUrl: '',
      noindex: false,
      ogTitleHe: '', ogTitleEn: '',
      ogDescriptionHe: '', ogDescriptionEn: '',
      ogImage: '',
    },
  };
}

function normalizeCard(raw) {
  const c = { id: str(raw?.id) || newId('card'), hidden: bool(raw?.hidden) };
  for (const f of CARD_FIELDS) c[f] = str(raw?.[f]).trim();
  return c;
}

function normalizeFaqItem(raw) {
  return {
    id: str(raw?.id) || newId('faq'),
    hidden: bool(raw?.hidden),
    questionHe: str(raw?.questionHe).trim(),
    questionEn: str(raw?.questionEn).trim(),
    answerHe: str(raw?.answerHe).trim(),
    answerEn: str(raw?.answerEn).trim(),
  };
}

function normalizePricingLine(raw) {
  return {
    id: str(raw?.id) || newId('pl'),
    kind: PRICING_LINE_KINDS.includes(raw?.kind) ? raw.kind : 'custom',
    upto: intOrNull(raw?.upto),
    amountMinor: intOrNull(raw?.amountMinor),
    labelHe: str(raw?.labelHe).trim(),
    labelEn: str(raw?.labelEn).trim(),
  };
}

function normalizePricingRow(raw) {
  return {
    id: str(raw?.id) || newId('pr'),
    hidden: bool(raw?.hidden),
    titleHe: str(raw?.titleHe).trim(),
    titleEn: str(raw?.titleEn).trim(),
    metaHe: str(raw?.metaHe).trim(),
    metaEn: str(raw?.metaEn).trim(),
    notesHe: str(raw?.notesHe).trim(),
    notesEn: str(raw?.notesEn).trim(),
    lines: Array.isArray(raw?.lines) ? raw.lines.map(normalizePricingLine) : [],
    variantId: str(raw?.variantId).trim(),
    cardGroupId: str(raw?.cardGroupId).trim(),
  };
}

function normalizeSection(raw) {
  const type = str(raw?.type);
  const t = sectionType(type);
  if (!t) return null; // unknown type => dropped, never rendered
  const s = { id: str(raw?.id) || newId('sec'), type, hidden: bool(raw?.hidden) };
  for (const f of t.fields) {
    if (f === 'cards') s.cards = Array.isArray(raw?.cards) ? raw.cards.map(normalizeCard) : [];
    else if (f === 'items') s.items = Array.isArray(raw?.items) ? raw.items.map(normalizeFaqItem) : [];
    else if (f === 'rows') s.rows = Array.isArray(raw?.rows) ? raw.rows.map(normalizePricingRow) : [];
    else if (f === 'imageSide') s.imageSide = raw?.imageSide === 'end' ? 'end' : 'start';
    else s[f] = str(raw?.[f]);
  }
  return s;
}

/**
 * THE normalizer. Every write and every read passes through it, so a document is
 * always exactly this shape — no missing keys for the editor, no surprise keys
 * for the renderer, unknown section types dropped.
 */
export function normalizeDocument(raw) {
  const seo = raw?.seo || {};
  return {
    titleHe: str(raw?.titleHe),
    titleEn: str(raw?.titleEn),
    sections: (Array.isArray(raw?.sections) ? raw.sections : []).map(normalizeSection).filter(Boolean),
    seo: {
      titleHe: str(seo.titleHe), titleEn: str(seo.titleEn),
      descriptionHe: str(seo.descriptionHe), descriptionEn: str(seo.descriptionEn),
      canonicalUrl: str(seo.canonicalUrl),
      noindex: bool(seo.noindex),
      ogTitleHe: str(seo.ogTitleHe), ogTitleEn: str(seo.ogTitleEn),
      ogDescriptionHe: str(seo.ogDescriptionHe), ogDescriptionEn: str(seo.ogDescriptionEn),
      ogImage: str(seo.ogImage),
    },
  };
}

/** Only what the public should ever see: hidden sections/cards are removed here. */
export function visibleDocument(doc) {
  const d = normalizeDocument(doc);
  return {
    ...d,
    sections: d.sections
      .filter((s) => !s.hidden)
      .map((s) => ({
        ...s,
        ...(s.cards ? { cards: s.cards.filter((c) => !c.hidden) } : {}),
        ...(s.items ? { items: s.items.filter((i) => !i.hidden) } : {}),
        ...(s.rows ? { rows: s.rows.filter((r) => !r.hidden) } : {}),
      })),
  };
}

/**
 * How many locale-bearing text fields a VISIBLE document actually fills for a
 * locale. Rendering is strict per language (no cross-language fallback), so
 * this is the honesty check behind the public "version coming soon" page:
 * count 0 means the locale has nothing publishable, not a half-translated mix.
 */
export function localeContentCount(doc, locale) {
  const d = visibleDocument(doc);
  const suffix = locale === 'en' ? 'En' : 'He';
  let n = 0;
  const countObj = (obj) => {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && k.endsWith(suffix) && v.trim()) n += 1;
    }
  };
  countObj(d);
  for (const s of d.sections) {
    countObj(s);
    for (const c of s.cards || []) countObj(c);
    for (const i of s.items || []) countObj(i);
    for (const r of s.rows || []) {
      countObj(r);
      for (const l of r.lines || []) countObj(l);
    }
  }
  return n;
}

/** A slug an operator typed, reduced to what may appear in a URL path segment. */
export function normalizeSlug(input) {
  return str(input)
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9֐-׿-]/g, '')
    .replace(/-{2,}/g, '-');
}

/** Short, operator-facing summary of a document — used by the list screen. */
export function documentSummary(doc) {
  const d = normalizeDocument(doc);
  const cards = d.sections.reduce((n, s) => n + (s.cards ? s.cards.length : 0), 0);
  return { sections: d.sections.length, cards };
}
