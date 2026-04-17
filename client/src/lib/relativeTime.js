// Hebrew relative time, minimal and grammatical for common cases.
// Used purely for display; never drives logic.
export function relativeHebrew(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  const seconds = (Date.now() - date.getTime()) / 1000;
  if (seconds < 60) return 'עכשיו';
  const minutes = Math.floor(seconds / 60);
  if (minutes === 1) return 'לפני דקה';
  if (minutes < 60) return `לפני ${minutes} דקות`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return 'לפני שעה';
  if (hours < 24) return `לפני ${hours} שעות`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'אתמול';
  if (days < 30) return `לפני ${days} ימים`;
  return date.toLocaleDateString('he-IL');
}
