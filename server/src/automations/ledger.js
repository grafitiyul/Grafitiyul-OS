// THE permanent id ledger. APPEND ONLY — never edit or remove an entry.
//
// An AUT id is the durable handle the business uses to talk about a rule
// ("שנה את AUT-014"). It must therefore survive everything that can change
// around it: question wording, answer wording, a full reimplementation, a
// rename, being disabled, even being deleted.
//
// The ledger lives in CODE, not in a DB sequence, for three reasons:
//   * the runtime and the registry must read the SAME artifact (no drift);
//   * `grep AUT-014` has to land on the definition file;
//   * an id must survive a database reset.
// This is the same contract Admin Reports' stable `number` already keeps
// (server/src/adminReports/registry.js), which has held up in production.
//
// ── Allocating an id ("Create AUT-037") ──────────────────────────────────────
//   1. take the next free number — SEQUENTIAL. No reserved ranges: ranges rot,
//      and `category` on the definition is what groups automations.
//   2. append it to ALLOCATED below;
//   3. create definitions/AUT-037.<slug>.js;
//   4. add one import line to definitions/index.js.
//
// ── Retiring an id ("Remove AUT-014") ────────────────────────────────────────
//   1. delete the definition file and its import line;
//   2. move the id into RETIRED with a date and a Hebrew reason.
// The id STAYS in ALLOCATED. The registry keeps showing the automation as
// "הוסרה" with its full run history, and the number is never reused.

/** Every id ever allocated, in allocation order. APPEND ONLY. */
export const ALLOCATED = [
  'AUT-001', // התקבל תשלום בסיכום סיור
  'AUT-002', // כרטיסי בקרה לסיכום סיור
  'AUT-003', // דו"ח לוגיסטי בסיכום סיור
  'AUT-004', // ליד חדש — עדכון מנהלים בווטסאפ
];

/** Ids whose definition has been removed. They remain visible as "הוסרה". */
export const RETIRED = {
  'AUT-001': {
    retiredOn: '2026-08-01',
    reasonHe:
      'הוחלפה בדיווח מנהלים #19 ("הושאר תשלום אחרי הסיור"). זהו אירוע פנימי לצוות '
      + 'ולא תקשורת עם לקוח, ולכן הוא שייך לדיווחי המנהלים המוגדרים בקוד ולא למרכז '
      + 'התקשורת. אותו אירוע עסקי — מימוש אחד, שולח אחד.',
  },
  'AUT-002': {
    retiredOn: '2026-08-02',
    reasonHe:
      'יצירת כרטיסי הבקרה עברה לקריאה ישירה מנתיב הגשת השאלון '
      + '(questionnaires/service.js). ריצת אוטומציה בין "הוגש סיכום" ל"נוצר כרטיס" '
      + 'הוסיפה שכבת אידמפוטנטיות שנייה ומתג הפעלה מעל פעולות שכבר אידמפוטנטיות '
      + 'בפני עצמן, והפכה את השרשרת לקריאה רק דרך הגדרה, התאמת טריגר ומבצע פעולה. '
      + 'הכרטיסים עצמם, ההתראות (#17, #19, #20) וההיסטוריה לא השתנו.',
  },
  'AUT-003': {
    retiredOn: '2026-08-01',
    reasonHe:
      'הוחלפה בדיווח מנהלים #20 (דו״ח לוגיסטי מסיכום סיור). התראה תפעולית פנימית '
      + 'לאחראית הלוגיסטיקה אינה תקשורת עם לקוח, ולכן היא מוגדרת בקוד. הכרטיס '
      + 'הלוגיסטי עצמו ממשיך להיווצר מנתיב ההגשה, ללא אוטומציה.',
  },
  'AUT-004': {
    retiredOn: '2026-08-02',
    reasonHe:
      'הוחלפה בדיווח מנהלים #25 (ליד חדש — עדכון מנהלים). התראה למנהלים אינה תקשורת '
      + 'עם לקוח, ולכן היא מוגדרת בקוד. זיהוי המקור החיצוני לא השתנה: אותן נקודות '
      + 'קליטה קנוניות (פלטפורמת האינגרס וגשר הלידים) קוראות עכשיו ישירות לדיווח. '
      + 'היעד, הניסוח והאידמפוטנטיות נשמרו במלואם.',
  },
};

export const AUT_ID_PATTERN = /^AUT-\d{3,}$/;

export function isAllocated(id) {
  return ALLOCATED.includes(id);
}

export function isRetired(id) {
  return Object.prototype.hasOwnProperty.call(RETIRED, id);
}

export function retiredEntry(id) {
  return RETIRED[id] || null;
}

/** The next free id, formatted — used when allocating a new automation. */
export function nextAvailableId() {
  const highest = ALLOCATED.reduce((max, id) => {
    const n = Number(id.slice(4));
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return `AUT-${String(highest + 1).padStart(3, '0')}`;
}
