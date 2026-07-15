// Contacts review — business-impact sections.
//
// WHY THIS EXISTS: the engine knows things the owner cannot see in a flat list.
// Measured (2026-07-15) over 789 REVIEW clusters:
//   * 406 can never produce a duplicate at all (0 or 1 importable member), because
//     empty-shell contacts are never created in GOS. There is nothing to decide.
//   * of the 383 that CAN, only 8 touch an open deal or a future tour.
// A flat list hides that 8 inside 789. These sections are how the owner sees it.
//
// A cluster only needs a human when >= 2 of its members are actually importable.
// An "importable" contact has at least one deal, activity, note or file; contacts
// with none are kept in Snapshot #1 + the Legacy Archive and never become GOS
// Contacts, so they cannot duplicate anything.

// Owner-facing order IS the priority order. `decisionRequired: false` sections
// never enter the review queue — they exist only in the statistics.
export const CONTACT_SECTIONS = [
  {
    key: 'critical',
    emoji: '🔥',
    label: 'דורש הכרעה לפני ייבוא הזהויות',
    blurb: 'עסקה פתוחה או סיור עתידי — הכפילות היחידה שיכולה לפגוע בתפעול חי.',
    decisionRequired: true,
    beforeImport: true,
  },
  {
    key: 'recent',
    emoji: '🟠',
    label: 'עסקים אחרונים',
    blurb: 'עסקה שנסגרה בהצלחה בחצי השנה האחרונה. לא חוסם ייבוא.',
    decisionRequired: true,
  },
  {
    key: 'historical',
    emoji: '🟡',
    label: 'היסטוריה עסקית',
    blurb: 'עסקאות סגורות בלבד. אם לא תוכרע — שתי הרשומות פשוט ייובאו בנפרד.',
    decisionRequired: true,
  },
  {
    key: 'low',
    emoji: '⚪',
    label: 'עדיפות נמוכה',
    blurb: 'ללא עסקאות כלל — רק פעילויות, הערות או קבצים.',
    decisionRequired: true,
  },
  {
    key: 'none',
    emoji: '⚫',
    label: 'לא נדרשת הכרעה',
    blurb: 'פחות משני אנשי קשר מהקבוצה ייובאו בכלל — כפילות לא יכולה להיווצר. מוצג בסטטיסטיקה בלבד.',
    decisionRequired: false,
  },
];

// `safe` is not a review section: those clusters are batch-approved, not queued.
export const SAFE_SECTION = 'safe';
export const SECTION_KEYS = CONTACT_SECTIONS.map((s) => s.key);
export const sectionByKey = (k) => CONTACT_SECTIONS.find((s) => s.key === k) || null;
export const REVIEW_SECTIONS = CONTACT_SECTIONS.filter((s) => s.decisionRequired);
export const DEFAULT_SECTION = 'critical';
// Rank for sorting: safe last (it is never browsed), then business impact.
const RANK = { critical: 0, recent: 1, historical: 2, low: 3, none: 4, safe: 5 };
export const sectionRank = (k) => RANK[k] ?? 9;

// A contact GOS will actually create. Empty shells are archived, never imported.
export const isImportable = (m) =>
  (m.dealCount || 0) + (m.activityCount || 0) + (m.noteCount || 0) + (m.fileCount || 0) > 0;

// Business impact of a set of records, once we already know they need a decision.
function impactOf(records) {
  const sum = (f) => records.reduce((n, m) => n + (m[f] || 0), 0);
  if (sum('openDealCount') > 0 || sum('futureTourDeals') > 0) return 'critical';
  if (sum('wonRecentDealCount') > 0) return 'recent';
  if (sum('dealCount') > 0) return 'historical';
  return 'low';
}

// The section a CLUSTER belongs to. `safe` short-circuits: a batch-approvable
// cluster is auto-merged, so its business impact never costs the owner attention.
// A cluster needs >=2 importable members before a duplicate can even exist.
export function sectionFor({ members, batchApprovable }) {
  if (batchApprovable) return SAFE_SECTION;
  if (members.filter(isImportable).length < 2) return 'none';
  return impactOf(members);
}

// The section a SINGLE record belongs to (Name Cleanup). The cluster rule does not
// apply here: one importable record is a real decision, not a non-duplicate. Only an
// empty shell — which is never created in GOS — costs the owner nothing.
export function sectionForSingle(record) {
  if (!isImportable(record)) return 'none';
  return impactOf([record]);
}

// The owner's dashboard. Counts CLUSTERS, and separately how many still await a
// human, so "finished the critical section" is unambiguous.
export function summarizeSections(proposals, isUnresolved = () => true) {
  const buckets = {};
  for (const key of [SAFE_SECTION, ...SECTION_KEYS]) buckets[key] = { total: 0, unresolved: 0, contacts: 0 };
  for (const p of proposals) {
    const b = buckets[p.section] || buckets.none;
    b.total++;
    if (isUnresolved(p)) b.unresolved++;
    b.contacts += p.members?.length || 0;
  }
  const reviewable = REVIEW_SECTIONS.map((s) => buckets[s.key]);
  return {
    safe: buckets[SAFE_SECTION],
    sections: CONTACT_SECTIONS.map((s) => ({ ...s, counts: buckets[s.key] })),
    // The four headline numbers the owner asked for.
    headline: {
      safe: buckets[SAFE_SECTION].total,
      beforeImport: buckets.critical.unresolved,
      historicalReview: reviewable.filter((_, i) => REVIEW_SECTIONS[i].key !== 'critical').reduce((n, b) => n + b.unresolved, 0),
      noDecisionRequired: buckets.none.total,
    },
    // The gate the owner actually cares about: can Identity Import begin?
    criticalCleared: buckets.critical.unresolved === 0,
  };
}
