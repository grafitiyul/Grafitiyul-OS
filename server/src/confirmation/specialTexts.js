// Confirmation Email — special-text CATEGORY registry. Pure, no DB.
//
// A special text is an office-curated wording OPTION the operator selects
// inside a Deal (via the matching filler); the customer receives only the
// bodyHe/bodyEn. Cancellation policies are the FIRST category — adding a
// future one (new-guide wording, shortened tour, route change, weather…) is
// ONE entry here; the model, routes and settings UI are category-generic.

// `fillerKind` links a category to the Deal filler that selects from it — the
// ONE place that mapping lives (composer, routes and the deal card all read
// it). A category without a fillerKind is settings-only.
export const SPECIAL_TEXT_CATEGORIES = [
  {
    key: 'cancellation_policy',
    labelHe: 'מדיניות ביטול',
    labelEn: 'Cancellation policies',
    fillerKind: 'cancellation_policy',
    // Shown under the category header in settings.
    hintHe: 'האפשרויות שהמשרד בוחר מהן בתוך הדיל; ברירת המחדל נשלחת כשלא נבחר אחרת.',
  },
  {
    key: 'new_guide',
    labelHe: 'מדריך חדש',
    labelEn: 'New guide wording',
    fillerKind: 'new_guide',
    hintHe: 'הנוסחים שנשלחים ללקוח כשסוכם על מדריך חדש; ברירת המחדל נבחרת אוטומטית בדיל.',
  },
];

export const SPECIAL_TEXT_CATEGORY_KEYS = SPECIAL_TEXT_CATEGORIES.map((c) => c.key);

const BY_KEY = Object.fromEntries(SPECIAL_TEXT_CATEGORIES.map((c) => [c.key, c]));

export function getSpecialTextCategory(key) {
  return BY_KEY[key] || null;
}

export function isValidSpecialTextCategory(key) {
  return Object.prototype.hasOwnProperty.call(BY_KEY, key);
}

const BY_FILLER_KIND = Object.fromEntries(
  SPECIAL_TEXT_CATEGORIES.filter((c) => c.fillerKind).map((c) => [c.fillerKind, c]),
);

/** The category a Deal filler picks from, or null for plain-note fillers. */
export function categoryForFillerKind(kind) {
  return BY_FILLER_KIND[kind] || null;
}
