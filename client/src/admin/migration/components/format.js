// Small display helpers, local to the Review Center so the temporary tool can be
// deleted without touching shared utilities.
export const num = (n) => (n == null ? '—' : Number(n).toLocaleString('he-IL'));

export function bytes(b) {
  if (b == null) return '—';
  const mb = b / 1048576;
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

export function dateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
}
