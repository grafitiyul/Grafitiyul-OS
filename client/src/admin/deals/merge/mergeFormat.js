// Shared display helpers for the merge wizard. Formatting only — no rules and
// no arithmetic: every number shown here was computed by the server's preview,
// and a second calculation on the client is how two surfaces start disagreeing
// about money.

export function money(minor, currency = 'ILS') {
  const n = (Number(minor) || 0) / 100;
  const sign = currency === 'ILS' ? '₪' : `${currency} `;
  return `${sign}${n.toLocaleString('he-IL', { maximumFractionDigits: 2 })}`;
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return y && m && d ? `${d}.${m}.${y}` : String(iso);
}

export function fmtWhen(t) {
  if (!t?.date) return 'ללא מועד';
  return `${fmtDate(t.date)}${t.startTime ? ` · ${t.startTime}` : ''}`;
}

export const STATUS_HE = { open: 'OPEN', won: 'WON', lost: 'LOST' };

export const ACTIVITY_HE = { group: 'קבוצתי', private: 'פרטי', business: 'עסקי' };

export const TOUR_KIND_HE = {
  group_slot: 'סיור קבוצתי',
  private: 'סיור פרטי',
  business: 'אירוע עסקי',
};

// Server blocker codes → what the operator reads. Lives HERE rather than in the
// wizard so the review step can render blockers without importing its own
// parent (a cycle that works today only because the constant is read at render
// time — exactly the kind of accident that breaks on the next refactor).
export const BLOCKER_HE = {
  commercial_choice_required: 'יש לבחור מה קורה עם המחיר והבילדר',
  participants_choice_required: 'יש לבחור את מספר המשתתפים',
  operational_choice_required: 'יש להחליט מה קורה עם השיבוץ לסיור',
  field_choice_required: 'יש להכריע בשדות סותרים',
  currency_mismatch: 'לשני הדילים מטבעות שונים — לא ניתן לאחד',
  tour_full: 'אין מספיק מקום בסיור',
  survivor_already_retired: 'הדיל שנבחר להישאר כבר אוחד לתוך דיל אחר',
  other_already_retired: 'הדיל השני כבר אוחד לתוך דיל אחר',
};
