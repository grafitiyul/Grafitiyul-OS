// Canonical staff identity-color palette — the ONE list shared by the server
// (validation, changelog display) and the client (pickers, swatches, tints).
// ~36 curated colors with strong visual separation across families; values
// are stable KEYS (hex can be tuned later without a data migration).
//
// Curation rules: distinguishable as small squares, readable as a very light
// row tint on white, no near-identical neighbors. Never generate colors
// dynamically — extend THIS list.

export const STAFF_COLORS = [
  // oranges / corals / reds
  { key: 'orange', hex: '#F97316', nameHe: 'כתום' },
  { key: 'tangerine', hex: '#FB923C', nameHe: 'מנדרינה' },
  { key: 'coral', hex: '#FF6B6B', nameHe: 'אלמוג' },
  { key: 'salmon', hex: '#FA8072', nameHe: 'סלמון' },
  { key: 'red', hex: '#DC2626', nameHe: 'אדום' },
  { key: 'brick', hex: '#B91C1C', nameHe: 'לבנים' },
  { key: 'burgundy', hex: '#881337', nameHe: 'בורדו' },
  // pinks / purples
  { key: 'pink', hex: '#EC4899', nameHe: 'ורוד' },
  { key: 'rose', hex: '#F43F5E', nameHe: 'ורד' },
  { key: 'magenta', hex: '#C026D3', nameHe: 'מג׳נטה' },
  { key: 'purple', hex: '#9333EA', nameHe: 'סגול' },
  { key: 'plum', hex: '#7E22CE', nameHe: 'שזיף' },
  { key: 'violet', hex: '#8B5CF6', nameHe: 'סגלגל' },
  { key: 'lavender', hex: '#A78BFA', nameHe: 'לבנדר' },
  // indigos / blues
  { key: 'indigo', hex: '#4F46E5', nameHe: 'אינדיגו' },
  { key: 'navy', hex: '#1E3A8A', nameHe: 'כחול כהה' },
  { key: 'blue', hex: '#2563EB', nameHe: 'כחול' },
  { key: 'royal', hex: '#3B82F6', nameHe: 'כחול מלכותי' },
  { key: 'sky', hex: '#0EA5E9', nameHe: 'תכלת' },
  // cyans / teals
  { key: 'cyan', hex: '#06B6D4', nameHe: 'ציאן' },
  { key: 'aqua', hex: '#22D3EE', nameHe: 'אקווה' },
  { key: 'teal', hex: '#0D9488', nameHe: 'טורקיז כהה' },
  { key: 'turquoise', hex: '#14B8A6', nameHe: 'טורקיז' },
  // greens / limes / olives
  { key: 'green', hex: '#16A34A', nameHe: 'ירוק' },
  { key: 'emerald', hex: '#10B981', nameHe: 'אמרלד' },
  { key: 'forest', hex: '#166534', nameHe: 'ירוק יער' },
  { key: 'mint', hex: '#34D399', nameHe: 'מנטה' },
  { key: 'lime', hex: '#84CC16', nameHe: 'ליים' },
  { key: 'olive', hex: '#7C8A2E', nameHe: 'זית' },
  // yellows / golds / browns
  { key: 'yellow', hex: '#FACC15', nameHe: 'צהוב' },
  { key: 'gold', hex: '#D9A404', nameHe: 'זהב' },
  { key: 'amber', hex: '#F59E0B', nameHe: 'ענבר' },
  { key: 'mustard', hex: '#B8860B', nameHe: 'חרדל' },
  { key: 'brown', hex: '#92400E', nameHe: 'חום' },
  { key: 'chocolate', hex: '#6B3F1D', nameHe: 'שוקולד' },
  { key: 'tan', hex: '#C08552', nameHe: 'חול' },
  // slates
  { key: 'slate', hex: '#64748B', nameHe: 'אפרפר' },
  { key: 'steel', hex: '#475569', nameHe: 'פלדה' },
  { key: 'charcoal', hex: '#334155', nameHe: 'פחם' },
];

const BY_KEY = Object.fromEntries(STAFF_COLORS.map((c) => [c.key, c]));

export function isStaffColorKey(key) {
  return typeof key === 'string' && !!BY_KEY[key];
}

export function staffColorHex(key) {
  return BY_KEY[key]?.hex || null;
}

export function staffColorNameHe(key) {
  return BY_KEY[key]?.nameHe || null;
}

// ── Automatic foreground contrast ───────────────────────────────────────────
// THE one deterministic black-or-white decision for text painted over a
// palette color (calendar event pills, any future full-color surface). WCAG
// relative luminance → pick whichever foreground has the HIGHER contrast
// ratio. Never hardcode per-surface text colors over palette backgrounds.

const FG_DARK = '#111827'; // gray-900
const FG_LIGHT = '#FFFFFF';

function srgbChannel(v) {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

// WCAG 2.x relative luminance of a "#RRGGBB" hex (0 = black, 1 = white).
export function relativeLuminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return (
    0.2126 * srgbChannel((n >> 16) & 0xff) +
    0.7152 * srgbChannel((n >> 8) & 0xff) +
    0.0722 * srgbChannel(n & 0xff)
  );
}

export function contrastRatio(hexA, hexB) {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  if (la == null || lb == null) return null;
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// Black or white text for a given background hex. Unparseable input → dark
// (the safe default on the app's white surfaces).
export function foregroundForHex(hex) {
  const ratioLight = contrastRatio(hex, FG_LIGHT);
  const ratioDark = contrastRatio(hex, FG_DARK);
  if (ratioLight == null || ratioDark == null) return FG_DARK;
  return ratioLight >= ratioDark ? FG_LIGHT : FG_DARK;
}

// Mix a hex color toward white (ratio 0 = unchanged, 1 = white). Used for the
// "completed" calendar treatment — guide identity stays recognizable, muted.
export function mixHexWithWhite(hex, ratio) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const t = Math.min(1, Math.max(0, Number(ratio) || 0));
  const mix = (c) => Math.round(c + (255 - c) * t);
  const r = mix((n >> 16) & 0xff);
  const g = mix((n >> 8) & 0xff);
  const b = mix(n & 0xff);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0').toUpperCase()}`;
}
