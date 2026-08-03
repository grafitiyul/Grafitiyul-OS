// Confirmation Email — section layout vocabulary + normalization. Pure, no DB
// (the quoteBlocks.js shape: one dependency-free module shared by the routes,
// the composer and the settings UI meta endpoint).
//
// A template's layout (ConfirmationEmailTemplate.sections) is an ordered list:
//   { kind:'auto',  key,             hidden }  — a code-built section
//   { kind:'block', sharedContentId, hidden }  — a Shared Content block
// Auto sections are the closed registry below; blocks are open-ended library
// references (reference-integrity via ConfirmationTemplateBlock rows).

export const AUTO_SECTIONS = [
  { key: 'greeting', labelHe: 'פתיח' },
  { key: 'tour_details', labelHe: 'פרטי הפעילות' },
  { key: 'meeting_point', labelHe: 'נקודת מפגש' },
  { key: 'meeting_point_image', labelHe: 'תמונת נקודת המפגש' },
  { key: 'location_logistics', labelHe: 'לוגיסטיקה במיקום' },
  // Synthesized from new_guide / other_note fillers; renders nothing when the
  // deal has no special-term fillers, whatever the template says.
  { key: 'special_terms', labelHe: 'תנאים מיוחדים שסוכמו' },
  { key: 'closing', labelHe: 'סגיר' },
];

export const AUTO_SECTION_KEYS = AUTO_SECTIONS.map((s) => s.key);

const AUTO_BY_KEY = Object.fromEntries(AUTO_SECTIONS.map((s) => [s.key, s]));

export function getAutoSection(key) {
  return AUTO_BY_KEY[key] || null;
}

/** The default layout of a fresh template — every auto section, visible. */
export function defaultSections() {
  return AUTO_SECTIONS.map((s) => ({ kind: 'auto', key: s.key, hidden: false }));
}

/**
 * Normalize a stored/incoming layout:
 *   • keeps the saved order of known entries;
 *   • drops unknown auto keys, malformed entries, duplicate autos/blocks;
 *   • drops block entries whose sharedContentId is not in `validBlockIds`
 *     (deleted/foreign content never survives a save);
 *   • re-inserts a MISSING auto key right after its nearest present canonical
 *     predecessor (the quoteBlocks reconcileKeyOrder rule), so a newly added
 *     auto section lands in a sensible spot instead of at the end.
 * Never throws; always returns a full, valid layout.
 */
export function normalizeSections(raw, validBlockIds = []) {
  const valid = new Set(validBlockIds);
  const seenAuto = new Set();
  const seenBlock = new Set();
  const kept = [];
  for (const s of Array.isArray(raw) ? raw : []) {
    if (!s || typeof s !== 'object') continue;
    if (s.kind === 'auto' && AUTO_BY_KEY[s.key] && !seenAuto.has(s.key)) {
      seenAuto.add(s.key);
      kept.push({ kind: 'auto', key: s.key, hidden: !!s.hidden });
    } else if (
      s.kind === 'block' &&
      typeof s.sharedContentId === 'string' &&
      valid.has(s.sharedContentId) &&
      !seenBlock.has(s.sharedContentId)
    ) {
      seenBlock.add(s.sharedContentId);
      kept.push({ kind: 'block', sharedContentId: s.sharedContentId, hidden: !!s.hidden });
    }
  }
  // Re-insert missing auto keys after their nearest present canonical predecessor.
  for (let i = 0; i < AUTO_SECTION_KEYS.length; i += 1) {
    const key = AUTO_SECTION_KEYS[i];
    if (seenAuto.has(key)) continue;
    let insertAt = 0;
    for (let p = i - 1; p >= 0; p -= 1) {
      const at = kept.findIndex((s) => s.kind === 'auto' && s.key === AUTO_SECTION_KEYS[p]);
      if (at !== -1) {
        insertAt = at + 1;
        break;
      }
    }
    kept.splice(insertAt, 0, { kind: 'auto', key, hidden: false });
    seenAuto.add(key);
  }
  return kept;
}

/** The shared-content ids a layout references — drives block-link row sync. */
export function blockIdsInSections(sections) {
  return (Array.isArray(sections) ? sections : [])
    .filter((s) => s?.kind === 'block' && typeof s.sharedContentId === 'string')
    .map((s) => s.sharedContentId);
}
