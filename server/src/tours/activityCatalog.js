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

// Sanitize a requested ordered list of component ids (Product defaults OR a
// TourEvent's components) against the catalog. Rules (spec §11):
//   • duplicates are collapsed, first occurrence wins (order preserved)
//   • unknown ids are dropped
//   • an INACTIVE component may not be NEWLY added, but one already present
//     (existingIds) is kept so retiring a component never corrupts saved config
// Returns { ids, rejected:[{id,reason}] }. Pure — the caller persists `ids`.
export function sanitizeComponentSelection(requestedIds, { validIds, activeIds, existingIds = [] } = {}) {
  const valid = new Set(validIds || []);
  const active = new Set(activeIds || []);
  const existing = new Set(existingIds || []);
  const seen = new Set();
  const ids = [];
  const rejected = [];
  for (const raw of requestedIds || []) {
    const id = typeof raw === 'string' ? raw : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (!valid.has(id)) {
      rejected.push({ id, reason: 'unknown' });
      continue;
    }
    if (!active.has(id) && !existing.has(id)) {
      rejected.push({ id, reason: 'inactive' });
      continue;
    }
    ids.push(id);
  }
  return { ids, rejected };
}

// WorkshopLocation is referenced only by TourEvent component rows.
export function workshopLocationDeletionVerdict(counts = {}) {
  return catalogDeletionVerdict(counts, ['tourEventLinks']);
}

// Seed rows for a TourEvent from an ORDERED list of default component ids — a
// COPY, not a live link (later Product-default edits never touch existing
// tours). Non-workshop rows carry no location; workshop rows start unset (the
// operator picks the location on the tour). Pure — the caller createMany's it.
export function seedRowsFromDefaults(componentIds, tourEventId) {
  return (componentIds || []).map((activityComponentId, i) => ({
    tourEventId,
    activityComponentId,
    sortOrder: i,
    workshopLocationId: null,
  }));
}

// Validate a workshop-location assignment against the component's nature
// (spec §7): a location is allowed ONLY on a workshop component; anything set on
// a non-workshop component is rejected. A workshop component may be left unset
// (null → "חסר מיקום סדנה" warning in the UI). Returns
//   { ok:true, workshopLocationId } | { ok:false, error }
export function validateWorkshopLocationForComponent(isWorkshop, workshopLocationId) {
  const loc = workshopLocationId || null;
  if (!isWorkshop) {
    if (loc) return { ok: false, error: 'workshop_location_not_allowed' };
    return { ok: true, workshopLocationId: null };
  }
  return { ok: true, workshopLocationId: loc };
}

// When a tour's Product changes, the operator explicitly chooses (spec §5):
//   'keep'    → leave the tour's current components untouched
//   'replace' → reseed from the NEW product's defaults
// Never silent. Returns the resulting ordered component-id list.
export function componentsAfterProductChange(mode, currentIds, newDefaultIds) {
  return mode === 'replace' ? [...(newDefaultIds || [])] : [...(currentIds || [])];
}
