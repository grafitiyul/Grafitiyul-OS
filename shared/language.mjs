// THE language vocabulary shared by server and client.
//
// Two DIFFERENT lists, deliberately:
//   TOUR_LANGS — the language a tour is GUIDED in (he/en/es/fr/ru)
//   COMM_LANGS — the language we WRITE to the customer in (he/en). GOS only
//                composes Hebrew and English, so offering French here would
//                promise a message nothing can produce.
//
// The client's deals/config.js re-exports these so its existing importers are
// unchanged; the server needs them because the merge wizard resolves a deal's
// stored 'he' into "עברית" before the operator is asked to choose between two
// values (never an enum on screen — product standard 9).

export const TOUR_LANGS = Object.freeze([
  { key: 'he', label: 'עברית' },
  { key: 'en', label: 'אנגלית' },
  { key: 'es', label: 'ספרדית' },
  { key: 'fr', label: 'צרפתית' },
  { key: 'ru', label: 'רוסית' },
]);

export const COMM_LANGS = Object.freeze([
  { key: 'he', label: 'עברית' },
  { key: 'en', label: 'אנגלית' },
]);

export const TOUR_LANG_LABELS = Object.freeze(
  Object.fromEntries(TOUR_LANGS.map((l) => [l.key, l.label])),
);
export const COMM_LANG_LABELS = Object.freeze(
  Object.fromEntries(COMM_LANGS.map((l) => [l.key, l.label])),
);

/** Hebrew label for a tour language code; unknown codes fall through unchanged. */
export function tourLanguageLabel(code) {
  return TOUR_LANG_LABELS[code] || code || null;
}

/** Hebrew label for a communication language code. */
export function commLanguageLabel(code) {
  return COMM_LANG_LABELS[code] || code || null;
}
