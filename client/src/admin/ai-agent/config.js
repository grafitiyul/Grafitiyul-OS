// סוכן AI — module tabs and shared display vocabulary.
//
// Six screens, not ten. Knowledge + Playbook + Style share ONE tab because they
// are one thing to the operator ("what the agent is made of"); evaluation is
// split between the dashboard (headline quality) and history (per-run truth).

export const AGENT_TABS = [
  { key: 'overview', path: '', label: 'סקירה' },
  { key: 'review', path: 'review', label: 'לאישור' },
  { key: 'knowledge', path: 'knowledge', label: 'ידע' },
  { key: 'learning', path: 'learning', label: 'למידה' },
  { key: 'authority', path: 'authority', label: 'הרשאות' },
  { key: 'history', path: 'history', label: 'היסטוריה' },
];

export const MODE_LABELS = {
  disabled: 'כבוי',
  shadow: 'צל',
  approval: 'דורש אישור',
  auto: 'אוטומטי',
};

// Colour carries meaning here: green = the agent may act, amber = a human is in
// the loop, grey = it is not participating.
export const MODE_STYLE = {
  disabled: 'bg-gray-100 text-gray-600 border-gray-200',
  shadow: 'bg-slate-100 text-slate-700 border-slate-200',
  approval: 'bg-amber-50 text-amber-800 border-amber-200',
  auto: 'bg-emerald-50 text-emerald-800 border-emerald-200',
};

export const RISK_LABELS = { low: 'סיכון נמוך', medium: 'סיכון בינוני', high: 'סיכון גבוה' };
export const RISK_STYLE = {
  low: 'bg-emerald-50 text-emerald-700',
  medium: 'bg-amber-50 text-amber-700',
  high: 'bg-rose-50 text-rose-700',
};

export const CONFIDENCE_LABELS = { weak: 'ודאות נמוכה', moderate: 'ודאות בינונית', strong: 'ודאות גבוהה' };

export const PROPOSAL_STATUS = {
  open: { label: 'ממתין לאישור', style: 'bg-amber-50 text-amber-800' },
  shadow: { label: 'צל — לא הוצע', style: 'bg-slate-100 text-slate-600' },
  sent_unchanged: { label: 'נשלח ללא שינוי', style: 'bg-emerald-50 text-emerald-700' },
  sent_edited: { label: 'נשלח אחרי עריכה', style: 'bg-sky-50 text-sky-700' },
  rejected: { label: 'נדחה', style: 'bg-rose-50 text-rose-700' },
  bypassed: { label: 'המפעיל ענה בעצמו', style: 'bg-gray-100 text-gray-600' },
  superseded: { label: 'הוחלף בהצעה חדשה', style: 'bg-gray-100 text-gray-500' },
  stale: { label: 'לא רלוונטי יותר', style: 'bg-gray-100 text-gray-500' },
  expired: { label: 'פג תוקף', style: 'bg-gray-100 text-gray-500' },
};

export const KNOWLEDGE_CATEGORIES = [
  { key: 'meeting_point', label: 'נקודות מפגש' },
  { key: 'logistics', label: 'לוגיסטיקה' },
  { key: 'policy', label: 'מדיניות' },
  { key: 'product', label: 'מוצרים ופעילויות' },
  { key: 'pricing_rules', label: 'כללי תמחור' },
  { key: 'general', label: 'כללי' },
];

export const PLAYBOOK_CATEGORIES = [
  { key: 'qualification', label: 'איפיון פנייה' },
  { key: 'pricing', label: 'מחיר' },
  { key: 'objection', label: 'התנגדויות' },
  { key: 'follow_up', label: 'מעקב' },
  { key: 'service', label: 'שירות' },
  { key: 'logistics', label: 'לוגיסטיקה' },
];

export const LANGUAGE_LABELS = { both: 'עברית ואנגלית', he: 'עברית בלבד', en: 'אנגלית בלבד' };

export const STATUS_LABELS = { draft: 'טיוטה', approved: 'מאושר', archived: 'בארכיון' };
export const STATUS_STYLE = {
  draft: 'bg-amber-50 text-amber-800 border-amber-200',
  approved: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  archived: 'bg-gray-100 text-gray-500 border-gray-200',
};

/**
 * Percentages are rendered ONLY with their denominator, and never at all when
 * there is nothing to divide by. "98%" that hides "of 4 cases" is the exact
 * kind of authoritative-looking-but-meaningless AI metric to avoid.
 */
export function ratePct(rate) {
  return rate == null ? null : `${Math.round(rate * 100)}%`;
}

export function fmtDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('he-IL', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}
