// Localized-string maps for the Questionnaire Engine — single source of truth
// for the storage shape and the fallback chain, shared by server and client.
//
// Every human-facing questionnaire string is stored as a JSON map keyed by
// language code: { he: 'שם', en: 'Name' }. NOT a column per language — a new
// language must never require a schema change (blueprint §11).
//
// Fallback chain: requested → template defaultLanguage → first non-empty key.

export const KNOWN_LANGUAGES = ['he', 'en', 'es', 'fr', 'ru'];
export const RTL_LANGUAGES = ['he'];

export function isRtl(lang) {
  return RTL_LANGUAGES.includes(lang);
}

// map + language → resolved string ('' when nothing usable exists).
export function resolveLocalized(map, lang, defaultLanguage = 'he') {
  if (map === null || map === undefined) return '';
  if (typeof map === 'string') return map; // tolerance for plain strings
  if (typeof map !== 'object' || Array.isArray(map)) return '';
  const pick = (l) => {
    const v = map[l];
    return typeof v === 'string' && v.trim() !== '' ? v : null;
  };
  const hit = pick(lang) ?? pick(defaultLanguage);
  if (hit !== null) return hit;
  for (const k of Object.keys(map)) {
    const v = pick(k);
    if (v !== null) return v;
  }
  return '';
}

// Normalize arbitrary input into a clean localized map (or null if empty).
// Accepts a plain string (assigned to `lang`) or a partial map; strips
// non-string / blank entries and unknown junk keys that aren't language-like.
export function normalizeLocalizedInput(input, lang = 'he') {
  if (input === null || input === undefined) return null;
  if (typeof input === 'string') {
    const t = input.trim();
    return t === '' ? null : { [lang]: t };
  }
  if (typeof input !== 'object' || Array.isArray(input)) return null;
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v !== 'string') continue;
    if (!/^[a-z]{2}(-[A-Za-z]{2})?$/.test(k)) continue;
    const t = v.trim();
    if (t !== '') out[k] = t;
  }
  return Object.keys(out).length ? out : null;
}

// True when the map has a usable value for `lang` (publish-time completeness).
export function hasLanguage(map, lang) {
  return resolveLocalized(map, lang, lang) !== '' &&
    !!(map && typeof map === 'object' && typeof map[lang] === 'string' && map[lang].trim() !== '');
}
