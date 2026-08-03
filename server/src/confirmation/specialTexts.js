// Confirmation Email — special-text CATEGORY registry. Pure, no DB.
//
// A special text is an office-curated wording OPTION the operator selects
// inside a Deal (via the matching filler); the customer receives only the
// bodyHe/bodyEn. Cancellation policies are the FIRST category — adding a
// future one (new-guide wording, shortened tour, route change, weather…) is
// ONE entry here; the model, routes and settings UI are category-generic.

export const SPECIAL_TEXT_CATEGORIES = [
  {
    key: 'cancellation_policy',
    labelHe: 'מדיניות ביטול',
    labelEn: 'Cancellation policies',
    // Shown under the category header in settings.
    hintHe: 'האפשרויות שהמשרד בוחר מהן בתוך הדיל; ברירת המחדל נשלחת כשלא נבחר אחרת.',
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
