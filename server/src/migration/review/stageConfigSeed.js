// The FROZEN, owner-approved migration configuration, as decision-ledger rows.
//
// These were approved on 2026-07-14 (spec freeze) and are seeded as ALREADY
// APPROVED. The Review Center renders them read-only — the owner is never asked
// to re-approve them. Source of truth for the wording:
//   docs/architecture/GOS-migration-mapping-package.md (§3a stage table)
//   docs/architecture/GOS-migration-decision-workshop.md (D1–D8 resolved)
//
// Every row is a label→value proposal; the UI never renders raw JSON.

export const SPEC_FREEZE_DATE = '2026-07-14T00:00:00.000Z';
export const SPEC_DECIDER_NAME = 'החלטת בעלים — מפרט מוקפא';

// GOS target stages of the single merged sales pipeline.
const GOS_STAGE_LABEL = {
  lead: 'ליד חדש',
  contacted: 'שיחה מרכזית',
  quote: 'הצעת מחיר',
  negotiation: 'פולואפ / מו"מ',
  stage_a88c9186: 'הסכמה לסגירה',
  closing: 'סגירה',
};

// [pipeline, stage, total, open, won, lost, targetStage, rule]
const STAGE_ROWS = [
  ['מכירות', 'ליד נכנס', 8212, 37, 1195, 6980, 'lead', null],
  ['לקוחות עסקיים', 'התקבלה פנייה', 241, 12, 4, 225, 'lead', null],
  ['מכירות', 'התקיימה שיחה משמעותית', 1140, 0, 149, 991, 'contacted', null],
  ['מכירות', 'נשלח מידע נוסף', 509, 0, 124, 385, 'quote', null],
  ['לקוחות עסקיים', 'נשלחה הצעה', 227, 3, 1, 223, 'quote', null],
  ['מכירות', 'פולואפ 1', 2503, null, null, null, 'negotiation', null],
  ['מכירות', 'פולואפ 2', 5469, null, null, null, 'negotiation', null],
  ['לקוחות עסקיים', 'נשלח פולואפ 1', 124, null, null, null, 'negotiation', null],
  ['לקוחות עסקיים', 'נשלח פולואפ 2', 808, null, null, null, 'negotiation', null],
  ['מכירות', 'בהמתנה', 851, null, null, null, 'negotiation', null],
  ['לקוחות עסקיים', 'לא לשלוח פולואפים', 438, null, null, null, 'negotiation', null],
  ['לקוחות עסקיים', 'שינוי תאריך - לאישור לקוח', 4, 0, 4, 0, 'negotiation', null],
  ['לקוחות עסקיים', 'ממתין לאישור שלנו', 36, 1, 0, 35, 'stage_a88c9186', null],
  ['לקוחות עסקיים', 'הזמנה מאושרת', 857, 0, 91, 766, 'closing', null],
  // Collection pipeline — per the owner's rule this is NOT a sales pipeline.
  ['לקוחות עסקיים - גבייה', 'יצאה קבלה', 2521, 2, 2513, 6, 'closing',
    'שולם במלואו — לא נותר חוב. 2 פתוחות ו-6 אבודות חריגות עוברות לתור הרשומות החריגות.'],
  ['לקוחות עסקיים - גבייה', 'ממתין לתשלום', 24, 0, 24, 0, 'closing',
    'מסומן כלא שולם במודול הגבייה של GOS (סמן יתרה פתוחה מיובאת — בלי להמציא מסמכי iCount).'],
  // Dedicated pipelines.
  ['שוברי מתנה', 'כל השלבים', 49, 5, 14, 30, 'closing',
    'הקשר השובר נשמר (תווית + ארכיון). 5 השוברים הפתוחים = נרכשו וטרם מומשו — נשארים עסקאות פתוחות בתצוגה הפעילה.'],
  ['פולואפ רחוק', 'כל השלבים', 341, 0, 0, 341, 'negotiation',
    'היסטוריה בלבד — 100% אבודות ומאורכבות. סטטוס אבוד, שלב פולואפ/מו"מ. השלב המקורי תמיד נשמר ברשומת המקור.'],
];

// [subjectKey, title, value, detail]
const RULE_ROWS = [
  ['rule:active_scope', 'הגדרת "פעיל" ביום המעבר (Goal A)',
    'Tier 2 — 699 עסקאות',
    'תצוגת ברירת המחדל ביום המעבר: פתוחות ∪ זכייה עם סיור עתידי ∪ כל סיור עתידי ∪ פעילות עתידית ∪ פעילות פתוחה. זו תצוגה בלבד — לא היקף ההגירה.'],
  ['rule:archived_deals_included', 'עסקאות מאורכבות',
    'כל 24,356 העסקאות מהגרות',
    'כולל 19,448 עסקאות מאורכבות. הארכיון אינו מחיקה — הוא נשלף במלואו ללא שחזור.'],
  ['rule:all_contacts_migrate', 'אנשי קשר',
    'כל אנשי הקשר מהגרים',
    'כולל היסטוריה מלאה. רשומות "New Contact" אוטומטיות (3,193) לא נוצרות כאנשי קשר.'],
  ['rule:all_tours_migrate', 'סיורים',
    'כל הסיורים ההיסטוריים מהגרים',
    'סיורים היסטוריים אמיתיים, לא רק עתידיים.'],
  ['rule:deal_order_numbers', 'מספרי הזמנה של עסקאות',
    'מזהה Pipedrive נשמר כמספר ההזמנה',
    'מזהי Pipedrive (8–26,306) נמוכים מרצף GOS שמתחיל ב-27,000 — אפס התנגשויות.'],
  ['rule:legacy_ids_contacts_orgs', 'מזהי מערכת קודמת — אנשי קשר וארגונים',
    'מזהי Pipedrive נשמרים כהפניה גלויה',
    'ניתנים לחיפוש, לצורך איתור מהיר מול המערכת הישנה.'],
  ['rule:collection_pipeline', 'צינור הגבייה',
    'אינו צינור מכירות',
    'מתחת ל"יצאה קבלה" = לא שולם, ומנוהל במודול הגבייה של GOS — לא כשלב מכירה.'],
  ['rule:gift_vouchers', 'שוברי מתנה',
    '49 עסקאות → סגירה',
    '5 שוברים פתוחים נשארים פעילים (עקיפת רלוונטיות עתידית).'],
  ['rule:long_term_followup', 'פולואפ רחוק',
    'אינו תהליך עבודה פעיל',
    '341 עסקאות, 100% אבודות ומאורכבות — היסטוריה בלבד.'],
  ['rule:task_history', 'משימות פתוחות היסטוריות',
    'עסקאות אבודות/מאורכבות → היסטוריה',
    'משימות פתוחות על עסקאות אבודות (127) ומאורכבות עוברות לציר הזמן כהיסטוריה. עסקאות פעילות שומרות משימות אמיתיות.'],
  ['rule:drive_photos_links_only', 'קישורי Drive ו-Google Photos',
    'קישורים בלבד — התוכן לא מועתק',
    'אלבומי Google Photos הם מחלקה נפרדת מתיקיות Drive. ערכים שאינם קישור עוברים בדיקה ולא נשמרים כקישור.'],
  ['rule:templates_archive_only', 'תבניות וניסוחים (בסיס מדור קודם)',
    'ארכיון בלבד',
    'קטלוג/תמחור/תבניות חופפים למערכות ש-GOS כבר מנהל — נשמרים לעיון, לא מהגרים כנתונים תפעוליים.'],
  ['rule:timeline_migration', 'ציר זמן',
    'ציר זמן טבעי של GOS',
    'הערות, פעילויות, היסטוריית שינויי שלב, קבצים ומסמכים נכנסים כרשומות ציר זמן רגילות עם התאריכים המקוריים.'],
  ['rule:files_copy_gated', 'העתקת קבצים מ-Pipedrive',
    'חסום — ממתין לדוח סיווג',
    'מטא-דאטה של 170,421 קבצים נשמרה בצילום. גופי הקבצים (~21 GiB) לא יועתקו לפני דוח סיווג ותוכנית העתקה שיאושרו. אין החרגות קבועות מראש.'],
];

export function stageConfigDecisions() {
  const decidedAt = new Date(SPEC_FREEZE_DATE);
  const rows = [];

  for (const [pipeline, stage, total, open, won, lost, target, rule] of STAGE_ROWS) {
    rows.push({
      queue: 'stage_config',
      subjectKey: `stage:${pipeline}:${stage}`,
      proposal: {
        kind: 'stage_mapping',
        pipeline,
        stage,
        deals: total,
        breakdown: open == null ? null : { open, won, lost },
        targetStage: target,
        targetStageLabel: GOS_STAGE_LABEL[target] || target,
        rule,
      },
      status: 'approved',
      decision: { approved: true, targetStage: target, source: 'spec-freeze 2026-07-14' },
      decidedByName: SPEC_DECIDER_NAME,
      decidedAt,
    });
  }

  for (const [subjectKey, title, value, detail] of RULE_ROWS) {
    rows.push({
      queue: 'stage_config',
      subjectKey,
      proposal: { kind: 'rule', title, value, detail },
      status: 'approved',
      decision: { approved: true, source: 'spec-freeze 2026-07-14' },
      decidedByName: SPEC_DECIDER_NAME,
      decidedAt,
    });
  }

  return rows;
}

export const STAGE_CONFIG_COUNT = STAGE_ROWS.length + RULE_ROWS.length;
