// THE capability registry — what the agent is allowed to have an opinion about,
// and how much authority each of those situations may ever be given.
//
// Same architecture as control/registry.js and reviewItems/registry.js:
// CODE OWNS IDENTITY, the database owns only the operator's chosen mode
// (AgentCapabilityState). Consequences that make this future-proof:
//   • adding a capability is a one-line change here,
//   • a stored mode can never point at a capability that no longer exists,
//   • `maxMode` is a CODE-LEVEL CEILING: no UI, API payload or database row can
//     raise a capability above it. "Never automatic" is an invariant, not a
//     setting someone can flip at 2am.
//
// Every capability MUST document itself. A category whose meaning is unclear is
// a product failure, not a UI one — the operator is being asked to grant it
// authority, and they cannot judge what they cannot read.

// The canonical authority vocabulary, weakest → strongest.
export const MODES = ['disabled', 'shadow', 'approval', 'auto'];
export const MODE_RANK = Object.freeze(
  MODES.reduce((acc, m, i) => ({ ...acc, [m]: i }), {}),
);

export const MODE_LABELS = Object.freeze({
  disabled: 'כבוי',
  shadow: 'צל — רק צופה',
  approval: 'דורש אישור',
  auto: 'אוטומטי',
});

export const MODE_HELP = Object.freeze({
  disabled: 'הסוכן לא מנתח בכלל מצבים מהסוג הזה.',
  shadow: 'הסוכן מנתח ורושם מה היה עונה — שום דבר לא מוצע למפעיל ושום דבר לא נשלח.',
  approval: 'הסוכן מכין תשובה, והיא מוצגת למפעיל לאישור/עריכה/דחייה. בלי אישור — לא נשלח.',
  auto: 'הסוכן עונה לבד במצבים מהסוג הזה.',
});

const REGISTRY = new Map();

/**
 * @param {string} key  stable machine key — stored on runs/proposals, never renamed
 * @param {object} def
 *   labelHe     what the operator calls this situation
 *   purposeHe   which customer message lands here, in one plain sentence
 *   riskHe      why it carries the risk it does — what could go wrong
 *   risk        'low' | 'medium' | 'high'
 *   defaultMode the mode a fresh install ships with
 *   maxMode     the CEILING. Cannot be exceeded by configuration, ever.
 *   needsCanonicalData  fields that MUST be present in the context pack for the
 *                       agent to answer at all; missing → forced escalation.
 */
function register(key, def) {
  if (REGISTRY.has(key)) throw new Error(`agent capability already registered: ${key}`);
  if (!def.labelHe || !def.purposeHe) throw new Error(`agent capability ${key} is undocumented`);
  if (!MODES.includes(def.defaultMode)) throw new Error(`agent capability ${key}: bad defaultMode`);
  if (!MODES.includes(def.maxMode)) throw new Error(`agent capability ${key}: bad maxMode`);
  if (MODE_RANK[def.defaultMode] > MODE_RANK[def.maxMode]) {
    throw new Error(`agent capability ${key}: defaultMode exceeds maxMode`);
  }
  REGISTRY.set(key, { key, needsCanonicalData: [], ...def });
}

// ── Logistics & service: factual, answerable from approved knowledge ─────────

register('meeting_point', {
  labelHe: 'נקודת מפגש',
  purposeHe: 'הלקוח שואל איפה נפגשים, איך מגיעים או מה הכתובת.',
  riskHe: 'תשובה שגויה שולחת לקוח למקום הלא נכון ביום הסיור.',
  risk: 'low',
  defaultMode: 'shadow',
  maxMode: 'auto',
});

register('duration_question', {
  labelHe: 'משך הפעילות',
  purposeHe: 'הלקוח שואל כמה זמן הסיור/הסדנה נמשכים.',
  riskHe: 'נמוך — עובדה יציבה שמופיעה בידע המאושר או בנתוני המוצר.',
  risk: 'low',
  defaultMode: 'shadow',
  maxMode: 'auto',
});

register('what_is_included', {
  labelHe: 'מה כולל',
  purposeHe: 'הלקוח שואל מה כלולה בפעילות — ציוד, חומרים, מדריך, כיבוד.',
  riskHe: 'הבטחה למשהו שלא כלול הופכת לציפייה שהמפעיל יצטרך לכבד.',
  risk: 'medium',
  defaultMode: 'shadow',
  maxMode: 'approval',
});

register('accessibility_children', {
  labelHe: 'נגישות וילדים',
  purposeHe: 'שאלות על גיל מתאים, ילדים, נגישות והתאמות.',
  riskHe: 'תשובה גורפת על נגישות עלולה להיות לא נכונה לאתר מסוים.',
  risk: 'medium',
  defaultMode: 'shadow',
  maxMode: 'approval',
});

register('parking_transport', {
  labelHe: 'חניה והגעה',
  purposeHe: 'שאלות על חניה, תחבורה ציבורית והגעה לנקודת המפגש.',
  riskHe: 'נמוך — מידע לוגיסטי יציב.',
  risk: 'low',
  defaultMode: 'shadow',
  maxMode: 'auto',
});

register('weather_policy', {
  labelHe: 'מזג אוויר',
  purposeHe: 'מה קורה אם יורד גשם או שמזג האוויר לא מתאים.',
  riskHe: 'זו למעשה מדיניות ביטול — תשובה רופפת יוצרת התחייבות כספית.',
  risk: 'medium',
  defaultMode: 'shadow',
  maxMode: 'approval',
});

// ── Commercial: never fully automatic ────────────────────────────────────────

register('pricing_discussion', {
  labelHe: 'שיחת מחיר',
  purposeHe: 'הלקוח שואל כמה זה עולה, או מגיב למחיר שנמסר.',
  riskHe: 'מחיר הוא התחייבות עסקית. מחיר שהומצא או שלא מתאים להרכב הקבוצה הוא נזק ישיר.',
  risk: 'high',
  defaultMode: 'shadow',
  maxMode: 'approval',
  needsCanonicalData: ['pricing'],
});

register('availability_question', {
  labelHe: 'זמינות תאריך',
  purposeHe: 'הלקוח שואל אם תאריך/שעה פנויים.',
  riskHe: 'זמינות היא נתון חי. אישור זמינות שגוי מייצר הזמנה כפולה.',
  risk: 'high',
  defaultMode: 'shadow',
  maxMode: 'approval',
  needsCanonicalData: ['availability'],
});

register('discount_request', {
  labelHe: 'בקשת הנחה',
  purposeHe: 'הלקוח מבקש הנחה או מתמקח על המחיר.',
  riskHe: 'החלטה מסחרית. גם ניסוח "נראה מה אפשר לעשות" הוא כבר מיקוח.',
  risk: 'high',
  defaultMode: 'shadow',
  maxMode: 'approval',
});

register('payment_question', {
  labelHe: 'תשלום וחשבונית',
  purposeHe: 'שאלות על אופן התשלום, קישור לתשלום, חשבונית או מה שולם עד כה.',
  riskHe: 'קביעה שתשלום התקבל חייבת להישען על מצב הגבייה הקנוני בלבד.',
  risk: 'high',
  defaultMode: 'shadow',
  maxMode: 'approval',
  needsCanonicalData: ['payment'],
});

register('booking_change', {
  labelHe: 'שינוי הזמנה',
  purposeHe: 'הלקוח מבקש לשנות תאריך, שעה, מספר משתתפים או פרטי הזמנה.',
  riskHe: 'משנה נתונים תפעוליים אמיתיים ומשפיע על שיבוץ מדריכים.',
  risk: 'high',
  defaultMode: 'shadow',
  maxMode: 'approval',
});

// ── Human-only families. maxMode is the point of these entries. ──────────────

register('cancellation_request', {
  labelHe: 'בקשת ביטול',
  purposeHe: 'הלקוח מודיע שהוא רוצה לבטל.',
  riskHe: 'רגע רגיש מסחרית ואנושית. תשובה אוטומטית כאן שורפת עסקה שאפשר להציל.',
  risk: 'high',
  defaultMode: 'disabled',
  maxMode: 'approval',
});

register('refund_request', {
  labelHe: 'בקשת החזר כספי',
  purposeHe: 'הלקוח מבקש כסף בחזרה.',
  riskHe: 'החלטה כספית בלתי הפיכה. לעולם לא סוכן — גם לא בהצעה לאישור.',
  risk: 'high',
  defaultMode: 'disabled',
  maxMode: 'shadow',
});

register('complaint', {
  labelHe: 'תלונה',
  purposeHe: 'הלקוח לא מרוצה, כועס או מתלונן על חוויה.',
  riskHe: 'דורש שיקול דעת אנושי ואמפתיה אמיתית.',
  risk: 'high',
  defaultMode: 'disabled',
  maxMode: 'approval',
});

// ── Fallbacks ────────────────────────────────────────────────────────────────

register('greeting', {
  labelHe: 'פתיחה וברכה',
  purposeHe: 'הודעת פתיחה כללית ללא שאלה קונקרטית ("היי", "שלום").',
  riskHe: 'נמוך — אין בה תוכן עסקי.',
  risk: 'low',
  defaultMode: 'shadow',
  maxMode: 'auto',
});

register('other', {
  labelHe: 'אחר / לא מזוהה',
  purposeHe: 'שיחה שלא נכנסת לאף קטגוריה מוכרת. תמיד מועברת לאדם.',
  riskHe: 'ההגדרה עצמה היא "לא הבנתי" — אין מצב שבו נכון לענות לבד.',
  risk: 'high',
  defaultMode: 'shadow',
  maxMode: 'approval',
});

// ── Read API ─────────────────────────────────────────────────────────────────

export function capabilityDef(key) {
  return REGISTRY.get(key) || null;
}

export function listCapabilities() {
  return [...REGISTRY.values()];
}

export function isKnownCapability(key) {
  return REGISTRY.has(key);
}

/** The keys the classifier is allowed to return — the prompt's closed enum. */
export function capabilityKeys() {
  return [...REGISTRY.keys()];
}

/** Clamp a requested mode to the capability's code-level ceiling. */
export function clampMode(key, requested) {
  const def = REGISTRY.get(key);
  if (!def) return null;
  if (!MODES.includes(requested)) return null;
  return MODE_RANK[requested] > MODE_RANK[def.maxMode] ? def.maxMode : requested;
}
