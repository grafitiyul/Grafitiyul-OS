// Identity Import readiness — DERIVED FROM DATA, never a toggled flag.
//
// Identity Import creates Contacts and Organizations. Nothing else. So this gate
// asks exactly one question per requirement: "does the live ledger prove this is
// safe?" A requirement that cannot be proved is NOT ready, and says why.
//
// An owner-approved rule the gate must honour: historical cleanup must NOT block the
// import. Only live operations do. A queue with 359 undecided historical clusters is
// READY, because an undecided cluster imports as two separate contacts — a tidiness
// debt on closed business, not a risk.

import { isResolved } from './queues.js';

const req = (key, label, ready, detail, blocking = true) => ({ key, label, ready, detail, blocking });

// `facts` is assembled by the service from the live ledger — this stays pure.
export function buildReadiness(facts) {
  const {
    orgs, contactSections, nameStats, exceptionStats, stageConfigCount,
    implicitMergeCount, identityEditsApplied, participantGapResolved, shellExclusionCount,
  } = facts;

  const orgUnresolved = orgs.total - orgs.resolved;
  const requirements = [
    req(
      'organizations',
      'תור הארגונים הושלם',
      orgs.total > 0 && orgUnresolved === 0,
      orgs.total === 0 ? 'התור טרם נבנה' : `${orgUnresolved} מתוך ${orgs.total} עדיין ללא החלטה`,
    ),
    req(
      'contacts_critical',
      'הכפילויות הקריטיות באנשי קשר הוכרעו',
      contactSections.critical.unresolved === 0,
      `${contactSections.critical.unresolved} קבוצות עם עסקה פתוחה או סיור עתידי ממתינות`,
    ),
    req(
      'stage_config',
      'שלבים והגדרות הושלמו',
      stageConfigCount > 0,
      stageConfigCount > 0 ? `${stageConfigCount} החלטות מאושרות` : 'טרם נזרע',
    ),
    req(
      'name_cleanup_critical',
      'ניקוי השמות הקריטי הוכרע',
      nameStats.criticalUnresolved === 0 && nameStats.blockingUnresolved === 0,
      `${nameStats.criticalUnresolved} קריטיים · ${nameStats.blockingUnresolved} רשומות שהייבוא שלהן ייכשל (אין שם פרטי)`,
    ),
    req(
      'exceptions_blocking',
      'הרשומות החריגות שחוסמות זהות הוכרעו',
      exceptionStats.blockingUnresolved === 0,
      `${exceptionStats.blockingUnresolved} חריגים חוסמי-זהות ממתינים · ${exceptionStats.nonBlockingUnresolved} חריגים שאינם חוסמים (לא מעכבים)`,
    ),
    req(
      'no_implicit_merge',
      'אין אף מסלול איחוד סמוי',
      implicitMergeCount === 0,
      implicitMergeCount === 0
        ? 'כל קבוצה שלא הוכרעה מייבאת שני אנשי קשר נפרדים'
        : `${implicitMergeCount} קבוצות שלא הוכרעו נושאות הצעת איחוד`,
    ),
    req(
      'corrections_applied',
      'תיקוני נתוני המקור מוחלים ע"י ה-resolver הקנוני',
      identityEditsApplied,
      identityEditsApplied ? 'ההחלטות מיוצבות דרך contactDecision/contactIdentity' : 'ה-resolver אינו מחיל את התיקונים',
    ),
    req(
      'participant_gap',
      'החרגת הרשומות הריקות בטוחה מול משתתפים משניים',
      participantGapResolved,
      participantGapResolved
        ? 'קישורי המשתתפים חולצו — אף משתתף משני לא מוחרג כרשומה ריקה'
        : `לא ידוע: ${shellExclusionCount} רשומות ריקות מיועדות לאי-ייבוא, ו-478 עסקאות עם יותר ממשתתף אחד לא חולצו מעולם`,
    ),
  ];

  // Reported, never blocking — the owner-approved rule made explicit in the data.
  const informational = [
    {
      key: 'contacts_historical',
      label: 'הכרעות היסטוריות באנשי קשר',
      ready: true,
      blocking: false,
      detail: `${contactSections.historicalUnresolved} קבוצות היסטוריות ללא החלטה — ייובאו כאנשי קשר נפרדים. לא חוסם.`,
    },
    {
      key: 'name_cleanup_historical',
      label: 'ניקוי שמות היסטורי',
      ready: true,
      blocking: false,
      detail: `${nameStats.historicalUnresolved} רשומות היסטוריות ללא החלטה — ייובאו במיפוי ברירת המחדל. לא חוסם.`,
    },
  ];

  const blockers = requirements.filter((r) => !r.ready);
  return {
    requirements,
    informational,
    ready: blockers.length === 0,
    blockers: blockers.map((b) => ({ key: b.key, label: b.label, detail: b.detail })),
    // The gate NEVER offers an action — it only reports. The import itself is Slice 6.
    generatedAt: new Date().toISOString(),
  };
}

export const foldStatus = (rows) => ({
  total: rows.length,
  resolved: rows.filter((r) => isResolved(r.status)).length,
});
