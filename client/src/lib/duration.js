// Duration display. durationHours (numeric) is the only source of truth; the
// localized text is derived here, never stored.
//
//   1   → שעה / 1 hour
//   1.5 → שעה וחצי / 1.5 hours
//   2   → שעתיים / 2 hours
//   2.5 → שעתיים וחצי / 2.5 hours
//   3   → 3 שעות / 3 hours

function trimNum(n) {
  return Number.isInteger(n) ? String(n) : String(n);
}

export function durationHe(hours) {
  if (hours == null || hours === '' || !Number.isFinite(Number(hours))) return '';
  const h = Number(hours);
  const whole = Math.floor(h);
  const half = Math.abs(h - whole - 0.5) < 1e-9;

  // Whole-hour words
  const wholeWord = (w) => {
    if (w === 1) return 'שעה';
    if (w === 2) return 'שעתיים';
    return `${w} שעות`;
  };

  if (half) {
    if (whole === 0) return 'חצי שעה';
    if (whole === 1) return 'שעה וחצי';
    if (whole === 2) return 'שעתיים וחצי';
    return `${whole} שעות וחצי`;
  }
  // Non-half fractional (e.g. 2.25) — fall back to a numeric form.
  if (!Number.isInteger(h)) return `${trimNum(h)} שעות`;
  return wholeWord(whole);
}

export function durationEn(hours) {
  if (hours == null || hours === '' || !Number.isFinite(Number(hours))) return '';
  const h = Number(hours);
  return `${trimNum(h)} ${h === 1 ? 'hour' : 'hours'}`;
}

// Combined display, e.g. "שעתיים וחצי · 2.5 hours".
export function durationDisplay(hours) {
  const he = durationHe(hours);
  const en = durationEn(hours);
  if (!he && !en) return '';
  return `${he} · ${en}`;
}
