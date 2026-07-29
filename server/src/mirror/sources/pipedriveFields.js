// Pipedrive field keys and the frozen stage map.
//
// Every key here was READ from the snapshot's own field definitions
// (`pipedrive/reference`), not guessed. The stage map is the owner-APPROVED
// table from GOS-migration-mapping-package.md §3a, which is marked SPEC FROZEN
// — the mirror must translate stages exactly as the migration did, or a
// mirrored deal would land in a different column than its imported twin.

export const DEAL_FIELDS = Object.freeze({
  tourDate: 'a860fcf9681c2bb1f71200514cffdb5c8cadedb7',        // תאריך הסיור   (date)
  tourTime: 'c6fcaf2da776d8062b90092fc8d7c9fb74ea7b15',        // שעת הסיור     (time)
  participants: 'a124d37118d74bd32be8c92abbea93ecdc7af3c8',    // כמות משתתפים  (double)
  leadSourceList: 'b5fbb89a2499268c9bdc95b4bb34dda000a8f172',  // מקור-רשימה סגורה (enum)
  leadSourceText: '35a2565c8f374bbb994cd97accedaff2db273aba',  // מקור          (varchar)
  campaign: '412d86415428dc30693364760314252259faa86a',        // קמפיין        (varchar)
});

export const PERSON_FIELDS = Object.freeze({
  taxId: 'c201cc23e6fe6568301fd3e244dfc2ab4566c83e',           // תעודת זהות
});

export const ORG_FIELDS = Object.freeze({
  orgType: 'fc6fe551dd6ea1ccab9f86d2ad63bf2229202311',         // סוג העסק (enum)
  taxId: '49f67a1342a56c48ed9ef2cb8a07264d4f3b58ac',           // ח.פ/עוסק מורשה
});

/**
 * Pipedrive stage id → GOS stage KEY. Frozen mapping (§3a).
 *
 * Stages deliberately absent map to null, and the adapter then omits the field
 * entirely rather than nulling it — an unmapped stage must never silently move
 * a deal to the first column.
 *
 * The collection pipeline (13–16, 23, 31) all resolves to `closing`: those
 * stages describe PAYMENT state, which GOS models in the Collection module, not
 * as a sales stage.
 */
export const STAGE_MAP = Object.freeze({
  1: 'lead',                 // ליד נכנס (מכירות)
  6: 'lead',                 // התקבלה פנייה (עסקיים)
  3: 'contacted',            // התקיימה שיחה משמעותית
  35: 'quote',               // נשלח מידע נוסף
  7: 'quote',                // נשלחה הצעה
  20: 'negotiation',         // פולואפ 1
  21: 'negotiation',         // פולואפ 2
  8: 'negotiation',          // נשלח פולואפ 1
  9: 'negotiation',          // נשלח פולואפ 2
  2: 'negotiation',          // בהמתנה - לא לשלוח פולואפים
  22: 'negotiation',         // לא לשלוח פולואפים - בהמתנה
  11: 'negotiation',         // שינוי תאריך - לאישור לקוח
  10: 'stage_a88c9186',      // ממתין לאישור שלנו — הסכמה לסגירה
  12: 'closing',             // הזמנה מאושרת
  // Collection pipeline — payment state, not sales stage.
  13: 'closing',             // ממתין לתשלום
  14: 'closing',             // לשליחת תזכורת תשלום 1
  15: 'closing',             // לשליחת תזכורת תשלום 2
  31: 'closing',             // יצאה חשבונית מס
  16: 'closing',             // שולם
  23: 'closing',             // יצאה קבלה
});

export function stageKeyForPipedriveStage(stageId) {
  if (stageId === null || stageId === undefined) return null;
  return STAGE_MAP[Number(stageId)] ?? null;
}

/**
 * Organization type: Pipedrive enum option id → the GOS OrganizationType LABEL.
 * Resolved to an id at write time against the live catalogue, so a rename in
 * CRM settings cannot break the mirror.
 */
export const ORG_TYPE_LABELS = Object.freeze({
  22: 'חברות הפקה ואירועים',
  23: 'תאגידים וחברות גדולות, גופים ממשלתיים',
  25: 'עסקים וחברות קטנות',
  38: 'סוכנויות נסיעות ותיירות',
  177: 'לא עסק-לקוח פרטי',
  271: 'בית ספר - מורות',
  272: 'עמותות',
  273: 'אוניברטיסאות / מכללות',
  24: 'בית ספר/ עמותה/ מוסד חינוך',
  274: 'בית ספר - תלמידים',
});

/**
 * Activity type key → GOS TaskType key. Only the types that correspond to a
 * real GOS task type are mapped; anything else is left for the importer's
 * existing taskTypeMapping and is not invented here.
 */
export const ACTIVITY_TYPE_MAP = Object.freeze({
  call: 'call',
  _1: 'call',
  _2: 'call',
  _4: 'followup',
  whatsapp: 'whatsapp',
  whatsapp1: 'whatsapp',
  email: 'email',
  task: 'general',
  meeting: 'meeting',
  code216867935: 'collection',
});
