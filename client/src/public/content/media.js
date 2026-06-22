// ============================================================================
// Media / asset seam.
//
// Per the architecture decision (audit §9.4) public images are served by URL
// from object storage + CDN — NEVER stored as Postgres bytes. Until that
// store exists, `asset()` returns placeholder URLs. Swapping to the real CDN
// base later is a ONE-LINE change here; components keep calling `asset(...)`.
// ============================================================================

// Base URL for hosted media. Empty = use the path as-is (local /public or an
// already-absolute URL). Set to the CDN origin (e.g. https://cdn.grafitiyul…)
// when object storage lands.
const MEDIA_BASE = '';

export function asset(pathOrUrl) {
  if (!pathOrUrl) return '';
  // Already absolute (http, data, blob) → return untouched.
  if (/^(https?:|data:|blob:)/i.test(pathOrUrl)) return pathOrUrl;
  return `${MEDIA_BASE}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}

// Deterministic neutral placeholder for image slots while real media is
// pending (keeps layouts visible without shipping fake content as if real).
export function placeholder(label = 'Grafitiyul', { w = 800, h = 600 } = {}) {
  const text = encodeURIComponent(label);
  // Inline SVG data-URI — no network, no dependency.
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>
    <rect width='100%' height='100%' fill='#EEF7FF'/>
    <text x='50%' y='50%' fill='#3089FF' font-family='Fredoka,Arial' font-size='28'
      text-anchor='middle' dominant-baseline='middle'>${text}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
