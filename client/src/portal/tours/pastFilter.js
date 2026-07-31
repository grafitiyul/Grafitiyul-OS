// Past-tours month/year filtering — pure helpers (unit-tested), the page
// only renders. Values derive from the loaded feed, so the pickers never
// offer a year/month with zero results.

export const MONTHS_HE = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

const yearOf = (t) => String(t.date || '').slice(0, 4);
const monthOf = (t) => String(t.date || '').slice(5, 7);

// Distinct years present in the feed, newest first.
export function pastYears(tours) {
  return [...new Set((tours || []).map(yearOf).filter((y) => /^\d{4}$/.test(y)))].sort().reverse();
}

// Distinct months ("01".."12") present in the feed — narrowed to a year when
// one is selected, so the month picker only offers real combinations.
export function pastMonths(tours, year = '') {
  const scoped = year ? (tours || []).filter((t) => yearOf(t) === year) : tours || [];
  return [...new Set(scoped.map(monthOf).filter((m) => /^\d{2}$/.test(m)))].sort();
}

// Apply the (optional) year + month selection. '' = no restriction.
export function filterPastTours(tours, { year = '', month = '' } = {}) {
  return (tours || []).filter(
    (t) => (!year || yearOf(t) === year) && (!month || monthOf(t) === month),
  );
}

export function monthLabel(mm) {
  const idx = Number(mm) - 1;
  return MONTHS_HE[idx] || mm;
}
