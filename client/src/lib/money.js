// Money helpers. Values are stored and transmitted as integer MINOR units
// (agorot / cents); the UI formats and parses to/from major units (₪).
//
// The server sends minor units as plain numbers (BigInt is serialized to Number
// in the API layer), and accepts plain numbers in minor units on write.

const SYMBOLS = { ILS: '₪', USD: '$', EUR: '€' };

// Format minor units for display, e.g. 125050 -> "₪1,250.50".
export function formatMinor(minor, currency = 'ILS') {
  const n = Number(minor || 0) / 100;
  try {
    return new Intl.NumberFormat('he-IL', {
      style: 'currency',
      currency: currency || 'ILS',
      minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    const sym = SYMBOLS[currency] || '';
    return `${sym}${n.toLocaleString('he-IL')}`;
  }
}

// Parse a user-entered major-unit string (e.g. "1,250.5" or "1250") into minor
// units (125050). Returns null for empty input.
export function toMinor(majorInput) {
  if (majorInput === '' || majorInput === null || majorInput === undefined)
    return null;
  const cleaned = String(majorInput).replace(/[^0-9.-]/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

// Convert minor units back to a major-unit string for editing inputs.
export function minorToInput(minor) {
  if (minor === null || minor === undefined) return '';
  return String(Number(minor) / 100);
}
