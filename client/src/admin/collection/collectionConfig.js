// Collection (גבייה) status presentation — shared by the Deal panel and the
// Collection screen. The status VALUES come from the server Collection service
// (server/src/collection.js), never derived on the client.

export const COLLECTION_STATUS_LABELS = {
  no_amount: 'חסר סכום',
  unpaid: 'טרם שולם',
  partial: 'שולם חלקית',
  paid: 'שולם במלואו',
  overpaid: 'שולם ביתר',
  // The server refused to decide: the accounting evidence is contradictory or
  // ambiguous. The numbers are still shown — this says they are not trustworthy
  // until a human answers the question attached to the deal.
  review: 'דורש בדיקה',
};

export const COLLECTION_STATUS_STYLES = {
  no_amount: 'bg-gray-100 text-gray-500',
  unpaid: 'bg-red-50 text-red-600',
  partial: 'bg-amber-50 text-amber-700',
  paid: 'bg-emerald-50 text-emerald-700',
  overpaid: 'bg-sky-50 text-sky-700',
  review: 'bg-purple-50 text-purple-700',
};

// What the operator should actually DO about a review flag. A banner that only
// states a problem leaves the work undone; each of these names the next step,
// using the controls that exist in the גבייה panel.
export const REVIEW_GUIDANCE = {
  shared_document:
    'המסמך מכסה כמה עסקאות, ולכן לא שויך אוטומטית לאף אחת. אם הוא שייך לעסקה הזו — חברו אותו דרך "חבר מסמך קיים מ־iCount". אם הוא מכסה גם עסקאות אחרות — רשמו כאן את החלק ששייך לעסקה הזו דרך "רישום תשלום ידני", עם מספר המסמך כאסמכתא.',
  ambiguous_reference:
    'מספר המסמך שנרשם בעסקה מתאים ליותר ממסמך אחד באייקאונט. אתרו את המסמך הנכון וחברו אותו דרך "חבר מסמך קיים מ־iCount".',
  unresolved_reference:
    'מספר המסמך שנרשם בעסקה לא נמצא באייקאונט. ייתכן שהוא הוקלד בטעות, או שהמסמך נמחק. חברו את המסמך הנכון, או רשמו את התשלום ידנית.',
  doctype_conflict:
    'אותו מספר מסמך נרשם בעסקה בשני סוגי מסמך שונים. בדקו באייקאונט מהו המסמך הנכון וחברו אותו.',
  cancelled_document:
    'המסמך שאליו מפנה העסקה בוטל באייקאונט, ולכן אינו נספר כתשלום. אם הופק מסמך חלופי — חברו אותו לעסקה.',
  customer_mismatch:
    'המסמך רשום על שם לקוח אחר. ודאו שזה אכן המסמך של העסקה הזו; אם לא — בטלו את השיוך וחברו את המסמך הנכון.',
  amount_conflict:
    'הסכום שהתקבל גבוה מהותית מסכום העסקה. בדקו אם המסמך מכסה גם עסקאות אחרות, או אם סכום העסקה עצמו שגוי.',
  credit_without_base:
    'קיימת חשבונית זיכוי ללא חשבונית מקור משויכת. חברו את מסמך המקור כדי שהשרשרת החשבונאית תהיה שלמה.',
  currency_mismatch:
    'התקבל תשלום במטבע שונה ממטבע העסקה. מטבעות אינם מחוברים זה לזה — קבעו את מטבע העסקה הנכון או רשמו את התשלום במטבע העסקה.',
};

// How a single piece of evidence was established. The distinction is a product
// requirement, not decoration: an operator must never mistake money they typed
// in for money an accounting document proves.
export const EVIDENCE_CLASS_BADGE = {
  verified: { label: 'מאומת באייקאונט', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  provider: { label: 'סליקה אוטומטית', cls: 'bg-sky-50 text-sky-700 ring-sky-200' },
  manual: { label: 'נרשם ידנית', cls: 'bg-amber-50 text-amber-800 ring-amber-200' },
};
