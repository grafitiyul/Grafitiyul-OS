// Module-aware browser-tab favicon — the ONE resolver from "which GOS module
// is open" to "what the tab icon shows".
//
// Scope guard (do not widen): this touches ONLY <link rel="icon"> tags in a
// normal browser tab. It must never touch the PWA surface — the manifest link,
// apple-touch-icon, /icons/icon-*.png, or server/src/pwa/manifest.js. The
// installed app keeps the regular GOS logo exactly as today.
//
// Icon source is the SAME registry the navigation renders from:
//   - most modules: the emoji `glyph` from moduleRoutes.js, drawn into an SVG
//     <text> favicon at runtime (no asset files, no second mapping);
//   - whatsapp/email: the brand marks — serialized from the exact path data
//     exported by WhatsAppLogo.jsx / GmailIcon.jsx (same components the
//     NavRail renders), so there is one source for the brand geometry.
//
// Managed links carry data-gos-favicon="1" (same convention as Seo.jsx's
// data-seo marker). The three static links from index.html are detached while
// a module favicon is active and restored verbatim on reset, so leaving
// /admin/* (or logout) returns the brand favicon untouched.

import {
  WHATSAPP_LOGO_VIEWBOX,
  WHATSAPP_LOGO_PATHS,
} from '../admin/common/WhatsAppLogo.jsx';
import {
  GMAIL_ICON_VIEWBOX,
  GMAIL_ICON_PATHS,
} from '../admin/common/icons/GmailIcon.jsx';

const MARKER = 'data-gos-favicon';

function svgDataUri(svg) {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// Emoji glyph → SVG favicon. y=0.9em centers color emoji glyphs reliably
// across Chrome/Firefox/Edge/Safari without font metrics guesswork.
function emojiFavicon(glyph) {
  return svgDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="0.9em" font-size="90">${glyph}</text></svg>`
  );
}

function pathsFavicon(viewBox, paths) {
  const body = paths.map((p) => `<path fill="${p.fill}" d="${p.d}"/>`).join('');
  return svgDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`
  );
}

// Brand favicons — keyed identically to MODULE_ICONS in modules.js (the two
// modules whose nav entry renders a real brand mark instead of the glyph).
const BRAND_FAVICONS = {
  whatsapp: () => pathsFavicon(WHATSAPP_LOGO_VIEWBOX, WHATSAPP_LOGO_PATHS),
  email: () => pathsFavicon(GMAIL_ICON_VIEWBOX, GMAIL_ICON_PATHS),
};

const hrefCache = new Map();

// module (from moduleForPath) → favicon href, or null when there is no module
// (caller then resets to the brand favicon).
export function faviconHrefForModule(mod) {
  if (!mod?.key) return null;
  if (!hrefCache.has(mod.key)) {
    const brand = BRAND_FAVICONS[mod.key];
    hrefCache.set(mod.key, brand ? brand() : mod.glyph ? emojiFavicon(mod.glyph) : null);
  }
  return hrefCache.get(mod.key);
}

// The static brand-icon links (index.html) we detach while a module favicon is
// active. Held in DOM order so reset re-appends them exactly as shipped.
let detachedBrandLinks = null;

function managedLink() {
  return document.head.querySelector(`link[${MARKER}]`);
}

export function applyModuleFavicon(mod) {
  const href = faviconHrefForModule(mod);
  if (!href) {
    resetModuleFavicon();
    return;
  }
  if (!detachedBrandLinks) {
    // Only rel="icon" — never apple-touch-icon and never the manifest link.
    detachedBrandLinks = Array.from(
      document.head.querySelectorAll(`link[rel="icon"]:not([${MARKER}])`)
    );
    detachedBrandLinks.forEach((l) => l.remove());
  }
  let link = managedLink();
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/svg+xml';
    link.setAttribute(MARKER, '1');
    document.head.appendChild(link);
  }
  if (link.href !== href) link.href = href;
}

export function resetModuleFavicon() {
  managedLink()?.remove();
  if (detachedBrandLinks) {
    detachedBrandLinks.forEach((l) => document.head.appendChild(l));
    detachedBrandLinks = null;
  }
}
