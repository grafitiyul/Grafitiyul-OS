// Activity Components + Workshop Locations — shared PURE logic for the two
// Tours catalogs. Kept DB-free so it unit-tests like the rest of the module
// (productDeletionVerdict / wonGate pattern): the route handlers wrap these.

// Fixed tone palette for an ActivityComponent chip. Stored as a stable key on
// the row; the client maps the key to Tailwind classes (dynamic class names
// can't be Tailwind-generated, so the set is closed on purpose). 'slate' is the
// neutral default.
export const COMPONENT_TONES = ['slate', 'emerald', 'blue', 'amber', 'rose', 'violet', 'cyan'];
export const DEFAULT_TONE = 'slate';

export function normalizeTone(v) {
  return COMPONENT_TONES.includes(v) ? v : DEFAULT_TONE;
}

// Seeded starting catalog (the examples from the spec). Lazy-seeded on first
// GET, exactly like TaskType defaults — the operator edits/reorders/deletes them
// freely. isWorkshop follows the "סדנה" (workshop) convention.
export const DEFAULT_ACTIVITY_COMPONENTS = [
  { nameHe: 'סיור גרפיטי', icon: '🎨', color: 'violet', isWorkshop: false },
  { nameHe: 'סדנת תקליטים', icon: '🎧', color: 'blue', isWorkshop: true },
  { nameHe: 'סדנת ציור קיר', icon: '🖌️', color: 'emerald', isWorkshop: true },
  { nameHe: 'טעימת אוכל', icon: '🍽️', color: 'amber', isWorkshop: false },
];

// Deletion verdict for a catalog entry. An entry that is referenced anywhere
// (a Product default or any TourEvent, past or present) must never be hard-
// deleted — deactivate instead so history stays readable. `counts` are the
// reference counts; missing/zero counts mean "safe to hard-delete".
//   → { canHardDelete: boolean, blockers: [{ kind, count }] }
export function catalogDeletionVerdict(counts = {}, kinds = []) {
  const blockers = [];
  for (const kind of kinds) {
    const n = Number(counts[kind]) || 0;
    if (n > 0) blockers.push({ kind, count: n });
  }
  return { canHardDelete: blockers.length === 0, blockers };
}

// ActivityComponent is referenced by Product defaults and by TourEvents.
export function activityComponentDeletionVerdict(counts = {}) {
  return catalogDeletionVerdict(counts, ['productLinks', 'tourEventLinks']);
}

// WorkshopLocation is referenced only by TourEvent component rows.
export function workshopLocationDeletionVerdict(counts = {}) {
  return catalogDeletionVerdict(counts, ['tourEventLinks']);
}
