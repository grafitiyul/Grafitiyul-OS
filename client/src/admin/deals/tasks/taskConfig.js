// Shared display config for the Deal Tasks (משימות) UI. Icons are keyed by the
// TaskType.icon string persisted server-side, so the catalog (CRM settings) can
// remap an icon without any code change. Priority ("סדר עדיפות") tones follow the
// spec: none = neutral, low = blue, medium = yellow, high = red.

// Emoji icon map — small, dependency-free, RTL-safe. 'whatsapp' is rendered as a
// green mark by callers that want the brand look; the emoji is a safe fallback.
export const TASK_ICONS = {
  phone: '📞',
  'phone-missed': '📵',
  money: '💰',
  refresh: '🔁',
  whatsapp: '🟢',
  check: '✅',
  calendar: '📅',
  mail: '✉️',
  star: '⭐',
};

export function taskIcon(name) {
  return TASK_ICONS[name] || TASK_ICONS.check;
}

// Priority options for the composer + badges.
export const PRIORITY_OPTIONS = [
  { value: 'none', label: 'ללא' },
  { value: 'low', label: 'נמוך' },
  { value: 'medium', label: 'בינוני' },
  { value: 'high', label: 'גבוה' },
];

export const PRIORITY_TONE = {
  low: { dot: 'bg-blue-500', chip: 'bg-blue-50 text-blue-700 ring-blue-200', label: 'נמוך' },
  medium: { dot: 'bg-yellow-400', chip: 'bg-yellow-50 text-yellow-700 ring-yellow-200', label: 'בינוני' },
  high: { dot: 'bg-red-500', chip: 'bg-red-50 text-red-700 ring-red-200', label: 'גבוה' },
};

// Format a due date + optional "HH:MM" for the strip. Date is he-IL short.
export function formatDue(dueDate, dueTime) {
  if (!dueDate) return '';
  const d = new Date(dueDate);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' });
  return dueTime ? `${date} · ${dueTime}` : date;
}

// "YYYY-MM-DD" for a Date, in LOCAL time (so <input type="date"> matches what the
// user sees). Never use toISOString() here — it shifts across the UTC boundary.
export function toDateInput(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Default "YYYY-MM-DD" for a task type's due-offset rule.
export function defaultDueDate(type) {
  const d = new Date();
  const kind = type?.defaultDueOffsetType || 'today';
  if (kind === 'tomorrow') d.setDate(d.getDate() + 1);
  else if (kind === 'days_from_now') d.setDate(d.getDate() + (Number(type?.defaultDueOffsetDays) || 0));
  // 'today' and 'none' both start at today (the field is required either way).
  return toDateInput(d);
}
