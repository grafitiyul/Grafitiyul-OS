// Split a single "full name" field into first + last name.
//
// The first whitespace-delimited token is the first name; everything after it is
// the last name. This holds for both Hebrew (RTL) and Latin (LTR) input because
// the stored fields are logical (first/last), not visual — the order of words in
// "ישראל ישראלי" and "John Smith" both map first-token → firstName.
export function splitFullName(full) {
  const parts = String(full || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const first = parts.shift() || '';
  const last = parts.join(' ');
  return { first, last };
}

// True when the text is Latin script (and contains no Hebrew letters). Used to
// decide which language's name fields a contact should populate.
export function isLatinName(s) {
  return /[A-Za-z]/.test(s) && !/[֐-׿]/.test(s);
}

// Build the bilingual contact name payload from first + last name parts.
// The script of the entered name decides where it is stored — and ONLY there:
//   Latin (e.g. "John Smith")  → English fields, Hebrew left empty
//   otherwise (Hebrew / mixed) → Hebrew fields, English left empty
// We never duplicate a name into the other language (no fake "John" in a Hebrew
// field). The API accepts a first name in EITHER language, so one side is enough.
// Mixed input falls back to the Hebrew fields (the primary, always-shown name).
export function contactNamesFromParts(first, last) {
  const f = String(first || '').trim();
  const l = String(last || '').trim();
  const latin = isLatinName(`${f} ${l}`);
  return latin
    ? { firstNameHe: '', lastNameHe: '', firstNameEn: f, lastNameEn: l }
    : { firstNameHe: f, lastNameHe: l, firstNameEn: '', lastNameEn: '' };
}

// Same payload from a single full-name string (splits it first). Kept for the
// flows that still capture one combined field (e.g. the Create Deal dialog).
export function contactNamesFromFull(full) {
  const { first, last } = splitFullName(full);
  return contactNamesFromParts(first, last);
}
