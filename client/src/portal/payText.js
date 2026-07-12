// Canonical Hebrew wording for the payroll summary cards — ONE place for the
// singular/plural rule (the waiting card counts ACTIVITIES awaiting the
// guide's action; it never shows their monetary total).
export function waitingLabel(count) {
  if (count === 0) return 'אין פעילויות הממתינות לאישורך';
  if (count === 1) return 'פעילות אחת ממתינה לאישורך';
  return `${count} פעילויות ממתינות לאישורך`;
}
