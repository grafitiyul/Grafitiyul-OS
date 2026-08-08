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

// Operator-facing grouping. Sixteen flat rows is a wall; three groups with a
// stated meaning is a decision the operator can actually make. The group also
// carries the sentence that explains WHY its members are capped where they are.
export const CAPABILITY_GROUPS = [
  {
    key: 'logistics',
    labelHe: 'שאלות תפעוליות',
    summaryHe: 'שאלות עובדתיות שיש להן תשובה אחת נכונה — איפה, מתי, כמה זמן.',
    promotionHe: 'הקבוצה הזו היא המקום הטבעי להתחיל בו: התשובות יציבות, וטעות מתגלה מיד.',
  },
  {
    key: 'commercial',
    labelHe: 'שיחות מסחריות',
    summaryHe: 'כל מה שנוגע לכסף, לזמינות ולשינוי הזמנה.',
    promotionHe: 'אף קטגוריה כאן לא יכולה להפוך לאוטומטית — מחיר וזמינות הם התחייבות עסקית, ולכן תמיד יעברו דרך אדם.',
  },
  {
    key: 'sensitive',
    labelHe: 'רגעים רגישים',
    summaryHe: 'ביטול, החזר כספי ותלונה — רגעים שבהם לקוח מחליט אם להישאר.',
    promotionHe: 'כאן נדרש שיקול דעת אנושי. חלק מהקטגוריות לא יכולות לעבור אפילו למצב הצעה לאישור.',
  },
  {
    key: 'general',
    labelHe: 'כללי',
    summaryHe: 'פתיחות שיחה ומצבים שהסוכן לא הצליח לזהות.',
    promotionHe: '"לא מזוהה" תמיד עובר לאדם — זו בדיוק ההגדרה שלו.',
  },
];

const REGISTRY = new Map();

/**
 * @param {string} key  stable machine key — stored on runs/proposals, never renamed
 * @param {object} def
 *   labelHe     what the operator calls this situation
 *   purposeHe   which customer message lands here, in one plain sentence
 *   riskHe      why it carries the risk it does — what could go wrong
 *   exampleHe   a real customer sentence that lands here (makes the abstract
 *               category concrete in one glance)
 *   group       one of CAPABILITY_GROUPS
 *   risk        'low' | 'medium' | 'high'
 *   defaultMode the mode a fresh install ships with
 *   maxMode     the CEILING. Cannot be exceeded by configuration, ever.
 *   ceilingHe   WHY the ceiling is where it is, in business language. Shown
 *               whenever the operator meets a mode they cannot pick, so a
 *               disabled control reads as deliberate rather than broken.
 *   needsCanonicalData  fields that MUST be present in the context pack for the
 *                       agent to answer at all; missing → forced escalation.
 */
function register(key, def) {
  if (REGISTRY.has(key)) throw new Error(`agent capability already registered: ${key}`);
  if (!def.labelHe || !def.purposeHe) throw new Error(`agent capability ${key} is undocumented`);
  if (!def.exampleHe) throw new Error(`agent capability ${key} has no example`);
  if (!CAPABILITY_GROUPS.some((g) => g.key === def.group)) {
    throw new Error(`agent capability ${key}: unknown group ${def.group}`);
  }
  if (!MODES.includes(def.defaultMode)) throw new Error(`agent capability ${key}: bad defaultMode`);
  if (!MODES.includes(def.maxMode)) throw new Error(`agent capability ${key}: bad maxMode`);
  if (MODE_RANK[def.defaultMode] > MODE_RANK[def.maxMode]) {
    throw new Error(`agent capability ${key}: defaultMode exceeds maxMode`);
  }
  if (def.maxMode !== 'auto' && !def.ceilingHe) {
    throw new Error(`agent capability ${key}: a capped capability must explain its ceiling`);
  }
  REGISTRY.set(key, { key, needsCanonicalData: [], ...def });
}

/**
 * What ACTUALLY changes when a capability moves to `mode` — the sentence the
 * confirmation shows. Derived, never hardcoded per capability, so it can never
 * drift from what the authority resolver really does.
 */
export function modeImpactHe(key, mode) {
  const def = REGISTRY.get(key);
  if (!def) return null;
  const label = def.labelHe;
  if (mode === 'disabled') return `הסוכן יפסיק לגמרי לנתח מצבים של "${label}". לא יירשמו הצעות ולא יצטבר מידע על הקטגוריה הזו.`;
  if (mode === 'shadow') return `הסוכן ינתח מצבים של "${label}" וירשום מה היה עונה. שום דבר לא יוצע לך לשליחה ושום דבר לא יישלח.`;
  if (mode === 'approval') return `כשלקוח יכתוב משהו מסוג "${label}", תופיע לך הצעת תשובה בתוך השיחה. אתה תחליט אם לשלוח, לערוך או לדחות. בלי לחיצה שלך — לא נשלח כלום.`;
  if (mode === 'auto') return `הסוכן יהיה רשאי לענות ללקוח בעצמו במצבים של "${label}", בלי שתראה את ההודעה מראש.`;
  return null;
}

// ── Logistics & service: factual, answerable from approved knowledge ─────────

register('meeting_point', {
  labelHe: 'נקודת מפגש',
  purposeHe: 'הלקוח שואל איפה נפגשים, איך מגיעים או מה הכתובת.',
  group: 'logistics',
  exampleHe: "\"איפה בדיוק נפגשים?\"",
  riskHe: 'תשובה שגויה שולחת לקוח למקום הלא נכון ביום הסיור.',
  risk: 'low',
  defaultMode: 'shadow',
  maxMode: 'auto',
});

register('duration_question', {
  labelHe: 'משך הפעילות',
  purposeHe: 'הלקוח שואל כמה זמן הסיור/הסדנה נמשכים.',
  group: 'logistics',
  exampleHe: "\"כמה זמן זה לוקח?\"",
  riskHe: 'נמוך — עובדה יציבה שמופיעה בידע המאושר או בנתוני המוצר.',
  risk: 'low',
  defaultMode: 'shadow',
  maxMode: 'auto',
});

register('what_is_included', {
  labelHe: 'מה כולל',
  purposeHe: 'הלקוח שואל מה כלולה בפעילות — ציוד, חומרים, מדריך, כיבוד.',
  group: 'logistics',
  exampleHe: "\"הצבעים כלולים במחיר?\"",
  riskHe: 'הבטחה למשהו שלא כלול הופכת לציפייה שהמפעיל יצטרך לכבד.',
  risk: 'medium',
  defaultMode: 'shadow',
  maxMode: 'approval',
  ceilingHe: "תשובה כאן היא הבטחה — מה שהסוכן יאמר שכלול, תצטרכו לספק. לכן היא תמיד עוברת דרך אדם.",
});

register('accessibility_children', {
  labelHe: 'נגישות וילדים',
  purposeHe: 'שאלות על גיל מתאים, ילדים, נגישות והתאמות.',
  group: 'logistics',
  exampleHe: "\"אפשר להביא ילד בן 6? יש נגישות לכיסא גלגלים?\"",
  riskHe: 'תשובה גורפת על נגישות עלולה להיות לא נכונה לאתר מסוים.',
  risk: 'medium',
  defaultMode: 'shadow',
  maxMode: 'approval',
  ceilingHe: "נגישות והתאמות משתנות בין אתר לאתר. תשובה גורפת עלולה להיות לא נכונה בדיוק במקרה שבו זה קריטי.",
});

register('parking_transport', {
  labelHe: 'חניה והגעה',
  purposeHe: 'שאלות על חניה, תחבורה ציבורית והגעה לנקודת המפגש.',
  group: 'logistics',
  exampleHe: "\"יש חניה באזור?\"",
  riskHe: 'נמוך — מידע לוגיסטי יציב.',
  risk: 'low',
  defaultMode: 'shadow',
  maxMode: 'auto',
});

register('weather_policy', {
  labelHe: 'מזג אוויר',
  purposeHe: 'מה קורה אם יורד גשם או שמזג האוויר לא מתאים.',
  group: 'logistics',
  exampleHe: "\"מה קורה אם יורד גשם?\"",
  riskHe: 'זו למעשה מדיניות ביטול — תשובה רופפת יוצרת התחייבות כספית.',
  risk: 'medium',
  defaultMode: 'shadow',
  maxMode: 'approval',
  ceilingHe: "זו למעשה מדיניות ביטול. ניסוח רופף יוצר התחייבות כספית.",
});

// ── Commercial: never fully automatic ────────────────────────────────────────

register('pricing_discussion', {
  labelHe: 'שיחת מחיר',
  purposeHe: 'הלקוח שואל כמה זה עולה, או מגיב למחיר שנמסר.',
  group: 'commercial',
  exampleHe: "\"כמה זה עולה ל-15 אנשים?\"",
  riskHe: 'מחיר הוא התחייבות עסקית. מחיר שהומצא או שלא מתאים להרכב הקבוצה הוא נזק ישיר.',
  risk: 'high',
  defaultMode: 'shadow',
  maxMode: 'approval',
  ceilingHe: "מחיר הוא התחייבות עסקית. הסוכן לא ייתן מחיר בלי אדם שאישר אותו.",
  needsCanonicalData: ['pricing'],
});

register('availability_question', {
  labelHe: 'זמינות תאריך',
  purposeHe: 'הלקוח שואל אם תאריך/שעה פנויים.',
  group: 'commercial',
  exampleHe: "\"התאריך ה-20 פנוי?\"",
  riskHe: 'זמינות היא נתון חי. אישור זמינות שגוי מייצר הזמנה כפולה.',
  risk: 'high',
  defaultMode: 'shadow',
  maxMode: 'approval',
  ceilingHe: "זמינות היא נתון חי. אישור אוטומטי מייצר הזמנה כפולה.",
  needsCanonicalData: ['availability'],
});

register('discount_request', {
  labelHe: 'בקשת הנחה',
  purposeHe: 'הלקוח מבקש הנחה או מתמקח על המחיר.',
  group: 'commercial',
  exampleHe: "\"אפשר קצת הנחה?\"",
  riskHe: 'החלטה מסחרית. גם ניסוח "נראה מה אפשר לעשות" הוא כבר מיקוח.',
  risk: 'high',
  defaultMode: 'shadow',
  maxMode: 'approval',
  ceilingHe: "החלטה מסחרית. גם \"נראה מה אפשר לעשות\" הוא כבר מיקוח.",
});

register('payment_question', {
  labelHe: 'תשלום וחשבונית',
  purposeHe: 'שאלות על אופן התשלום, קישור לתשלום, חשבונית או מה שולם עד כה.',
  group: 'commercial',
  exampleHe: "\"קיבלתם את התשלום?\"",
  riskHe: 'קביעה שתשלום התקבל חייבת להישען על מצב הגבייה הקנוני בלבד.',
  risk: 'high',
  defaultMode: 'shadow',
  maxMode: 'approval',
  ceilingHe: "קביעה על תשלום חייבת להישען על מצב הגבייה במערכת, ואדם צריך לוודא שהיא נכונה.",
  needsCanonicalData: ['payment'],
});

register('booking_change', {
  labelHe: 'שינוי הזמנה',
  purposeHe: 'הלקוח מבקש לשנות תאריך, שעה, מספר משתתפים או פרטי הזמנה.',
  group: 'commercial',
  exampleHe: "\"אפשר להזיז לשבוע הבא? נהיה 20 במקום 15.\"",
  riskHe: 'משנה נתונים תפעוליים אמיתיים ומשפיע על שיבוץ מדריכים.',
  risk: 'high',
  defaultMode: 'shadow',
  maxMode: 'approval',
  ceilingHe: "שינוי הזמנה משנה נתונים תפעוליים אמיתיים ומשפיע על שיבוץ מדריכים.",
});

// ── Human-only families. maxMode is the point of these entries. ──────────────

register('cancellation_request', {
  labelHe: 'בקשת ביטול',
  purposeHe: 'הלקוח מודיע שהוא רוצה לבטל.',
  group: 'sensitive',
  exampleHe: "\"אנחנו רוצים לבטל.\"",
  riskHe: 'רגע רגיש מסחרית ואנושית. תשובה אוטומטית כאן שורפת עסקה שאפשר להציל.',
  risk: 'high',
  defaultMode: 'disabled',
  maxMode: 'approval',
  ceilingHe: "רגע שבו אפשר עוד להציל עסקה. תשובה אוטומטית כאן שורפת אותה.",
});

register('refund_request', {
  labelHe: 'בקשת החזר כספי',
  purposeHe: 'הלקוח מבקש כסף בחזרה.',
  group: 'sensitive',
  exampleHe: "\"אני רוצה את הכסף בחזרה.\"",
  riskHe: 'החלטה כספית בלתי הפיכה. לעולם לא סוכן — גם לא בהצעה לאישור.',
  risk: 'high',
  defaultMode: 'disabled',
  maxMode: 'shadow',
  ceilingHe: "החלטה כספית בלתי הפיכה. הסוכן לא יציע כאן תשובה לשליחה — גם לא לאישור.",
});

register('complaint', {
  labelHe: 'תלונה',
  purposeHe: 'הלקוח לא מרוצה, כועס או מתלונן על חוויה.',
  group: 'sensitive',
  exampleHe: "\"המדריך איחר וזה הרס לנו את היום.\"",
  riskHe: 'דורש שיקול דעת אנושי ואמפתיה אמיתית.',
  risk: 'high',
  defaultMode: 'disabled',
  maxMode: 'approval',
  ceilingHe: "דורש אמפתיה ושיקול דעת אנושי אמיתי.",
});

// ── Fallbacks ────────────────────────────────────────────────────────────────

register('greeting', {
  labelHe: 'פתיחה וברכה',
  purposeHe: 'הודעת פתיחה כללית ללא שאלה קונקרטית ("היי", "שלום").',
  group: 'general',
  exampleHe: "\"היי\" / \"שלום, מה שלומכם?\"",
  riskHe: 'נמוך — אין בה תוכן עסקי.',
  risk: 'low',
  defaultMode: 'shadow',
  maxMode: 'auto',
});

register('other', {
  labelHe: 'אחר / לא מזוהה',
  purposeHe: 'שיחה שלא נכנסת לאף קטגוריה מוכרת. תמיד מועברת לאדם.',
  group: 'general',
  exampleHe: "כל מה שהסוכן לא הצליח לשייך לקטגוריה מוכרת.",
  riskHe: 'ההגדרה עצמה היא "לא הבנתי" — אין מצב שבו נכון לענות לבד.',
  risk: 'high',
  defaultMode: 'shadow',
  maxMode: 'approval',
  ceilingHe: "ההגדרה של הקטגוריה היא \"לא הבנתי\" — אין מצב שבו נכון לענות לבד.",
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
