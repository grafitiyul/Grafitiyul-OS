// Shared emoji-picker infrastructure — ONE place for the emoji-picker-element
// wiring (already bundled for the WhatsApp composer; no external service, the
// dataset ships with the build). Everything loads LAZILY on first open so the
// web component + dataset never weigh on initial load or on node test runs.

export const EMOJI_I18N_HE = {
  categoriesLabel: 'קטגוריות',
  emojiUnsupportedMessage: 'האימוג׳י אינו נתמך',
  favoritesLabel: 'בשימוש תדיר',
  loadingMessage: 'טוען…',
  networkErrorMessage: 'טעינת האימוג׳ים נכשלה',
  regionLabel: 'בחירת אימוג׳י',
  searchDescription: 'הקלידו לחיפוש; תוצאות יופיעו למטה',
  searchLabel: 'חיפוש',
  searchResultsLabel: 'תוצאות חיפוש',
  skinToneDescription: 'בחירת גוון עור',
  skinToneLabel: 'גוון עור',
  skinTonesLabel: 'גווני עור',
  skinTones: ['ברירת מחדל', 'בהיר', 'בהיר-בינוני', 'בינוני', 'כהה-בינוני', 'כהה'],
  categories: {
    custom: 'מותאם אישית',
    'smileys-emotion': 'סמיילים ורגשות',
    'people-body': 'אנשים',
    'animals-nature': 'חיות וטבע',
    'food-drink': 'אוכל ושתייה',
    'travel-places': 'נסיעות ומקומות',
    activities: 'פעילויות',
    objects: 'חפצים',
    symbols: 'סמלים',
    flags: 'דגלים',
  },
};

// Lazy singleton: registers the <emoji-picker> custom element and returns the
// bundled dataset URL. Safe to call repeatedly.
let loadPromise = null;
export function loadEmojiPicker() {
  if (!loadPromise) {
    loadPromise = Promise.all([
      import('emoji-picker-element'),
      import('emoji-picker-element-data/en/emojibase/data.json?url'),
    ]).then(([, data]) => ({ dataSource: data.default }));
  }
  return loadPromise;
}
