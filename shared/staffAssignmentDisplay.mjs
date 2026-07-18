// THE canonical staff-assignment display-name rule. Every surface that shows
// who was assigned to a tour (or who a payroll entry belongs to) resolves the
// name through THIS one function — server serializers AND client components —
// so the four surfaces can never disagree and a raw Airtable record id can
// never leak to a user.
//
// Priority (product decision):
//   1. the linked canonical GOS person's name (personRef.displayName) — always
//      wins the moment the person exists in GOS
//   2. a valid human-readable snapshot (assignment.displayName), UNLESS it is a
//      corrupted Airtable record id (see below)
//   3. the historical external identity when it is an email (externalPersonId) —
//      old imports stored the guide's email before a name snapshot existed
//   4. a neutral fallback ("איש צוות היסטורי") only when nothing usable exists
//
// A displayName matching the strict Airtable record-id shape is INVALID: those
// leaked in from an Airtable lookup field during the tour migration and are not
// human-readable. Internal handles (guide:*, manual:*, legacy:*) are likewise
// never shown — only an email-shaped externalPersonId is user-presentable.

const AIRTABLE_RECORD_ID = /^rec[a-zA-Z0-9]{14}$/;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const HISTORICAL_STAFF_FALLBACK = 'איש צוות היסטורי';

export function isAirtableRecordId(value) {
  return typeof value === 'string' && AIRTABLE_RECORD_ID.test(value.trim());
}

export function isEmailLike(value) {
  return typeof value === 'string' && EMAIL_SHAPE.test(value.trim());
}

// Input: an assignment/payroll-entry-like row
//   { personRef?: { displayName }, displayName?, externalPersonId? }
// Output: the display string to show the user (never a rec id, never a handle).
export function resolveStaffDisplayName(row) {
  if (!row) return HISTORICAL_STAFF_FALLBACK;

  const canonical = row.personRef?.displayName;
  if (canonical && String(canonical).trim()) return String(canonical).trim();

  const snapshot = row.displayName;
  if (snapshot && String(snapshot).trim() && !isAirtableRecordId(snapshot)) {
    return String(snapshot).trim();
  }

  const external = row.externalPersonId;
  if (isEmailLike(external)) return String(external).trim();

  return HISTORICAL_STAFF_FALLBACK;
}
