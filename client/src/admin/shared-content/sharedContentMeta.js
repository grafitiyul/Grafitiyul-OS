// Client-side labels + helpers for the Shared Content Library. Mirrors the server
// Type vocabulary (server validates; this is display only).

export const SHARED_CONTENT_TYPES = [
  { key: 'meeting_point', label: 'נקודת מפגש' },
  { key: 'ending_point', label: 'נקודת סיום' },
  { key: 'arrival_instructions', label: 'הוראות הגעה' },
  { key: 'walking_notes', label: 'הערות הליכה' },
  { key: 'safety', label: 'בטיחות' },
  { key: 'map', label: 'מפה' },
  { key: 'custom', label: 'תוכן כללי' },
];

export const TYPE_LABEL = Object.fromEntries(SHARED_CONTENT_TYPES.map((t) => [t.key, t.label]));

// Per-variant state → { label, tone } for the status chip.
export const STATE_META = {
  shared: { label: 'משותף', tone: 'blue' },
  standalone: { label: 'עצמאי', tone: 'gray' },
  inherited: { label: 'ברירת מחדל של המיקום', tone: 'violet' },
  legacy: { label: 'תוכן ישן (לא משותף)', tone: 'amber' },
  empty: { label: 'ריק', tone: 'gray' },
};

// Plain-text preview of rich HTML (tags stripped, whitespace collapsed, clamped).
export function htmlPreview(html, max = 140) {
  if (!html) return '';
  const text = String(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max) + '…' : text;
}
