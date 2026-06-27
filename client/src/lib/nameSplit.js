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
// decide whether a contact's name should also populate the English name fields.
export function isLatinName(s) {
  return /[A-Za-z]/.test(s) && !/[֐-׿]/.test(s);
}

// Build the bilingual contact name payload from a single full-name string.
// The Hebrew fields are always filled (the API requires firstNameHe); when the
// input is Latin we mirror it into the English fields too.
export function contactNamesFromFull(full) {
  const { first, last } = splitFullName(full);
  const latin = isLatinName(full);
  return {
    firstNameHe: first,
    lastNameHe: last,
    firstNameEn: latin ? first : '',
    lastNameEn: latin ? last : '',
  };
}
