// Holiday classification — pure helpers (no DB), so the import + mark logic is
// unit-testable. ערב חג defaults to 15:00 → end of day; חג is all-day.

export const EREV_START_MINUTE = 15 * 60; // 15:00

// Stable, year-independent key for a recurring holiday (the Hebcal title — it
// carries no year). Manual rows (no source name) get no rule.
export function normalizeHolidayKey(sourceName) {
  return String(sourceName || '').trim();
}

// The row patch for an explicit "mark as …" review action. Returns null for a
// non-mark action. (reviewedAt/By are added by the route.)
export function markPatch(action) {
  if (action === 'mark_chag') {
    return { status: 'approved', active: true, type: 'chag', allDay: true, startMinute: null, endMinute: null };
  }
  if (action === 'mark_erev') {
    return { status: 'approved', active: true, type: 'erev_chag', allDay: false, startMinute: EREV_START_MINUTE, endMinute: null };
  }
  return null;
}

// The classification rule body derived from a (just-classified) holiday row, to
// be carried forward to future years.
export function ruleFromRow(row) {
  return {
    defaultType: row.type,
    defaultStartMinute: row.startMinute ?? null,
    defaultEndMinute: row.endMinute ?? null,
    active: true,
  };
}

// Decide what an import should write for one fetched holiday, honoring:
//   - approved / manuallyEdited rows are NEVER overwritten (mirror source only);
//   - a matching active classification rule auto-applies type+times and approves
//     the row (auto-classification carries the prior review forward);
//   - otherwise new rows are pending and pending rows refresh from source.
// Returns { op: 'create'|'refresh'|'mirror', data }. Dates stay as ISO strings;
// the route converts them for the DB.
export function planImport({ existing, fetched, rule }) {
  const mirror = { sourceName: fetched.sourceName, sourceDate: fetched.date };
  const classified = rule && rule.active
    ? {
        type: rule.defaultType,
        allDay: rule.defaultStartMinute == null && rule.defaultEndMinute == null,
        startMinute: rule.defaultStartMinute ?? null,
        endMinute: rule.defaultEndMinute ?? null,
        status: 'approved',
        reviewedBy: 'system', // marks an auto-classified (rule-applied) row
      }
    : null;

  if (!existing) {
    const base = {
      externalId: fetched.externalId,
      nameHe: fetched.nameHe,
      nameEn: fetched.nameEn,
      date: fetched.date,
      type: fetched.type,
      allDay: fetched.allDay,
      startMinute: fetched.startMinute,
      endMinute: fetched.endMinute,
      source: 'imported',
      status: 'pending',
      ...mirror,
    };
    return { op: 'create', data: classified ? { ...base, ...classified } : base };
  }

  // Protected: never overwrite a human decision — refresh only the source mirror.
  if (existing.status === 'approved' || existing.manuallyEdited) {
    return { op: 'mirror', data: mirror };
  }

  // Pending + unedited → refresh from source, apply the rule if one matches.
  const refresh = {
    nameHe: fetched.nameHe,
    nameEn: fetched.nameEn,
    date: fetched.date,
    type: fetched.type,
    allDay: fetched.allDay,
    startMinute: fetched.startMinute,
    endMinute: fetched.endMinute,
    ...mirror,
  };
  return { op: 'refresh', data: classified ? { ...refresh, ...classified } : refresh };
}
