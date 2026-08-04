// Theme-hostile colour normalization for outgoing mail.
//
// THE PROBLEM. The document wrapper declares `color-scheme: light dark` and
// sets no colours, so a well-behaved client themes text and background
// together. Content copied from Word/Google Docs breaks that: it carries an
// explicit near-black foreground (and often a near-white background) baked in
// on the assumption of a white page. In a dark client those runs stay black on
// the client's dark surface — unreadable — and forcing colours in the wrapper
// to compensate makes it worse (Gmail inverts explicit pairs into black
// rectangles with white text).
//
// THE RULE. Drop only what is theme-hostile, keep everything meaningful:
//   • near-black / near-white FOREGROUND  → dropped, so the text inherits the
//     client's theme colour. These carry no intent: they are "default text"
//     restated by a word processor.
//   • near-white BACKGROUND               → dropped, so a pasted paragraph
//     stops painting a white box on a dark surface.
//   • any other colour (red, brand blue, yellow highlight) → KEPT. It was a
//     deliberate authoring choice and we never second-guess it.
//   • a KEPT background gains an explicit readable foreground on the SAME
//     element when it has none, so the pair themes/inverts together instead of
//     becoming yellow-on-white.
//
// Applied server-side in sanitizeEmailHtml so it covers content that is
// ALREADY stored, not just future pastes.

// #rgb / #rrggbb / rgb() / rgba() → { r,g,b } | null (named colours are left
// alone: they are explicit authoring choices, not paste artefacts).
export function parseColor(value) {
  const v = String(value || '').trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) {
    const [r, g, b] = m[1].split('');
    return { r: parseInt(r + r, 16), g: parseInt(g + g, 16), b: parseInt(b + b, 16) };
  }
  m = /^#([0-9a-f]{6})$/.exec(v);
  if (m) {
    return {
      r: parseInt(m[1].slice(0, 2), 16),
      g: parseInt(m[1].slice(2, 4), 16),
      b: parseInt(m[1].slice(4, 6), 16),
    };
  }
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(v);
  if (m) return { r: +m[1], g: +m[2], b: +m[3] };
  if (v === 'black') return { r: 0, g: 0, b: 0 };
  if (v === 'white') return { r: 255, g: 255, b: 255 };
  return null;
}

// Relative luminance (sRGB, WCAG). 0 = black, 1 = white.
export function luminance({ r, g, b }) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

// "Achromatic and at an extreme" — the signature of a word-processor default,
// as opposed to a chosen colour. Saturation guards keep dark reds/navies.
function isNeutralExtreme(rgb, { dark = true, light = true } = {}) {
  const { r, g, b } = rgb;
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  if (spread > 24) return false; // chromatic → a real choice
  const l = luminance(rgb);
  if (dark && l <= 0.08) return true; // near-black
  if (light && l >= 0.85) return true; // near-white
  return false;
}

export const isThemeHostileForeground = (value) => {
  const rgb = parseColor(value);
  return !!rgb && isNeutralExtreme(rgb);
};
export const isThemeHostileBackground = (value) => {
  const rgb = parseColor(value);
  // Only near-WHITE backgrounds are hostile: a dark background with light text
  // is a deliberate design, and dropping it would break that pairing.
  return !!rgb && isNeutralExtreme(rgb, { dark: false, light: true });
};

const decls = (style) =>
  String(style || '')
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean);

/**
 * Normalize ONE inline style string. Returns the rewritten style (or '' when
 * nothing survives). Pure — no DOM, so it runs identically on both sides.
 */
export function normalizeStyleForEmail(style) {
  const kept = [];
  let keptBackground = null;
  let hasForeground = false;

  for (const d of decls(style)) {
    const at = d.indexOf(':');
    if (at < 0) continue;
    const prop = d.slice(0, at).trim().toLowerCase();
    const value = d.slice(at + 1).trim();

    // A kept declaration is pushed VERBATIM — a sanitizer must not reformat
    // what it preserves (send-now/send-later byte parity depends on it).
    if (prop === 'color') {
      if (isThemeHostileForeground(value)) continue; // inherit the theme instead
      hasForeground = true;
      kept.push(d);
      continue;
    }
    if (prop === 'background-color' || prop === 'background') {
      if (isThemeHostileBackground(value)) continue; // stop painting a white box
      keptBackground = value;
      kept.push(d);
      continue;
    }
    kept.push(d);
  }

  // A surviving background must carry its own foreground, or a themed client
  // can pair light text with a light highlight.
  if (keptBackground && !hasForeground) {
    const rgb = parseColor(keptBackground);
    if (rgb) kept.push(`color: ${luminance(rgb) > 0.5 ? '#111827' : '#ffffff'}`);
  }
  return kept.join('; ');
}

/**
 * Rewrite every inline style attribute in an HTML fragment. Attribute-level
 * only: tags, structure, classes and all non-colour styling are untouched.
 */
export function normalizeEmailColors(html) {
  if (!html) return html;
  return String(html).replace(
    /\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi,
    (_m, _q, dq, sq) => {
      const next = normalizeStyleForEmail(dq ?? sq ?? '');
      return next ? ` style="${next}"` : '';
    },
  );
}
