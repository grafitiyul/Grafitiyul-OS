// Pure presentation logic for the "מידע ממערכת קודמת" card (LegacyInfoCard).
// Kept dependency-free so it is unit-testable with plain node:test.

// A value long enough to clamp behind an expand toggle.
export const LONG_TEXT_THRESHOLD = 200;

// Values that "look like URLs" render as links (spec: start with http).
export function isUrlValue(value) {
  return typeof value === 'string' && /^https?:\/\/\S+$/i.test(value.trim());
}

// Shortened display text for a URL: protocol stripped, tail ellipsed. The
// full URL stays in href (and the title tooltip) — only the label shrinks.
export function shortenUrl(value, max = 60) {
  const url = String(value || '').trim().replace(/^https?:\/\//i, '');
  return url.length > max ? `${url.slice(0, max - 1)}…` : url;
}

export function isLongText(value) {
  return typeof value === 'string' && !isUrlValue(value) && value.length > LONG_TEXT_THRESHOLD;
}

// Normalise stored cardData into renderable [{ label, value }] rows.
// The frozen import mapping writes an array of { label, value } pairs; be
// tolerant of a plain object map (label → value) and drop anything unusable
// (empty labels/values, non-string-able entries) — the card must never crash
// on odd legacy data.
export function normalizeCardData(cardData) {
  let entries = [];
  if (Array.isArray(cardData)) {
    entries = cardData.map((e) => [e?.label, e?.value]);
  } else if (cardData && typeof cardData === 'object') {
    entries = Object.entries(cardData);
  }
  const rows = [];
  for (const [label, value] of entries) {
    const l = label == null ? '' : String(label).trim();
    const v =
      value == null || typeof value === 'object' ? '' : String(value).trim();
    if (!l || !v) continue;
    rows.push({ label: l, value: v });
  }
  return rows;
}
