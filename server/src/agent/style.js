// The Style Profile shape — "how we sound", as structured, editable fields
// rather than one prose blob.
//
// Why structured: an operator must be able to change "we don't use emojis in
// service replies" without rewriting a paragraph, the learning loop must be able
// to propose a change to ONE field with evidence, and a future second profile
// must be a row rather than a refactor. A single free-text instruction ("be
// friendly and conversational") is exactly the thing the spec forbids.
//
// Resolution is (language, audience) → the approved default profile for that
// pair, falling back to the same language's other audience, then to any
// approved profile of that language. Never cross-language: Hebrew style rules
// translated literally into English produce robotic English.

export const STYLE_AUDIENCES = ['sales', 'service'];
export const STYLE_LANGUAGES = ['he', 'en'];

/** Field definitions — drive both the editor UI and the prompt renderer. */
export const STYLE_FIELDS = [
  { key: 'greeting', labelHe: 'פתיחה', type: 'text',
    helpHe: 'איך אנחנו פותחים הודעה. למשל: בשם פרטי, בלי "שלום רב".' },
  { key: 'messageLength', labelHe: 'אורך הודעה', type: 'text',
    helpHe: 'קצר ולעניין? פסקה? כמה שורות בדרך כלל.' },
  { key: 'questionsPerMessage', labelHe: 'שאלות בהודעה', type: 'text',
    helpHe: 'שואלים שאלה אחת בכל פעם, או כמה יחד?' },
  { key: 'punctuation', labelHe: 'פיסוק', type: 'text',
    helpHe: 'סימני קריאה, נקודות בסוף שורה, שלוש נקודות.' },
  { key: 'emoji', labelHe: 'אימוג׳ים', type: 'text',
    helpHe: 'מתי כן ומתי לא, ואילו.' },
  { key: 'directness', labelHe: 'ישירות', type: 'text',
    helpHe: 'כמה ישיר הטון — מציעים, ממליצים, או שואלים.' },
  { key: 'phrasesToUse', labelHe: 'ביטויים שאנחנו משתמשים בהם', type: 'list',
    helpHe: 'ניסוחים אופייניים לנו.' },
  { key: 'phrasesToAvoid', labelHe: 'ביטויים שאנחנו נמנעים מהם', type: 'list',
    helpHe: 'ניסוחים שלא נשמעים כמונו.' },
  { key: 'notes', labelHe: 'הערות נוספות', type: 'text', helpHe: 'כל דבר אחר שחשוב לסגנון.' },
];

const FIELD_KEYS = STYLE_FIELDS.map((f) => f.key);

/** Normalize an arbitrary payload into the canonical rules shape. */
export function normalizeStyleRules(raw) {
  const out = {};
  for (const f of STYLE_FIELDS) {
    const v = raw?.[f.key];
    if (f.type === 'list') {
      out[f.key] = Array.isArray(v) ? v.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 40) : [];
    } else {
      out[f.key] = typeof v === 'string' ? v.trim().slice(0, 2000) : '';
    }
  }
  return out;
}

export function isStyleFieldKey(key) {
  return FIELD_KEYS.includes(key);
}

/**
 * The profiles a fresh install starts with. They are deliberately EMPTY of
 * invented business voice — the spec forbids fabricating how we sound. They
 * ship as `draft` with the structure in place and one honest note, so the
 * operator fills them in (or the Learning inbox proposes fields from real
 * history) before anything uses them.
 */
export function seedStyleProfiles() {
  const blank = normalizeStyleRules({});
  return [
    { key: 'he_sales', name: 'עברית — מכירות', language: 'he', audience: 'sales', isDefault: true, rules: blank },
    { key: 'he_service', name: 'עברית — שירות', language: 'he', audience: 'service', isDefault: true, rules: blank },
    { key: 'en_sales', name: 'English — sales', language: 'en', audience: 'sales', isDefault: true, rules: blank },
    { key: 'en_service', name: 'English — service', language: 'en', audience: 'service', isDefault: true, rules: blank },
  ];
}

/**
 * Pick the profile for a conversation. Never crosses languages.
 * @param {Array} profiles approved profiles
 */
export function resolveStyleProfile(profiles, { language = 'he', audience = 'service' } = {}) {
  const sameLang = (profiles || []).filter((p) => p.language === language);
  return (
    sameLang.find((p) => p.audience === audience && p.isDefault)
    || sameLang.find((p) => p.audience === audience)
    || sameLang.find((p) => p.isDefault)
    || sameLang[0]
    || null
  );
}

/** True when a profile carries no actual guidance — the prompt then says so. */
export function isEmptyStyle(profile) {
  if (!profile?.rules) return true;
  return STYLE_FIELDS.every((f) => {
    const v = profile.rules[f.key];
    return f.type === 'list' ? !v?.length : !String(v || '').trim();
  });
}
