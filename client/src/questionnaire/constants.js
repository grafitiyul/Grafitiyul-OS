// Client-side labels for the Questionnaire Engine. The authoritative type
// registry lives on the server (types.js); this file only translates keys to
// Hebrew UI labels — an unknown key falls back to the raw key, so a server-
// side type addition never breaks the builder.

export const QUESTION_TYPE_LABELS = {
  text: 'טקסט קצר',
  textarea: 'טקסט ארוך',
  number: 'מספר',
  email: 'אימייל',
  phone: 'טלפון',
  url: 'קישור',
  date: 'תאריך',
  time: 'שעה',
  datetime: 'תאריך ושעה',
  yesno: 'כן / לא',
  choice: 'בחירה אחת',
  dropdown: 'רשימה נפתחת',
  multi: 'בחירה מרובה',
  scale: 'סולם (1–10)',
  rating: 'דירוג כוכבים',
  slider: 'סרגל',
  static_text: 'טקסט חופשי (תצוגה)',
  image_upload: 'העלאת תמונה',
  file_upload: 'העלאת קובץ',
  signature: 'חתימה',
};

export const typeLabel = (t) => QUESTION_TYPE_LABELS[t] || t;

export const PURPOSE_LABELS = {
  tour_summary: 'סיכום סיור',
  coordination: 'שיחת תיאום',
  general: 'כללי',
};

export const purposeLabel = (p) => PURPOSE_LABELS[p] || p;

export const TEMPLATE_STATUS_LABELS = {
  draft: 'טיוטה',
  active: 'פעיל',
  archived: 'בארכיון',
};

export const VERSION_STATUS_LABELS = {
  draft: 'טיוטה',
  published: 'מפורסמת',
  archived: 'בארכיון',
};

export const SUBMISSION_STATUS_LABELS = {
  draft: 'בתהליך',
  submitted: 'הוגש',
  reviewed: 'נסקר',
  void: 'בוטל',
};

export const CONDITION_OP_LABELS = {
  eq: 'שווה ל-',
  neq: 'שונה מ-',
  in: 'אחד מ-',
  nin: 'לא אחד מ-',
  gt: 'גדול מ-',
  gte: 'גדול או שווה',
  lt: 'קטן מ-',
  lte: 'קטן או שווה',
  answered: 'נענתה',
  empty: 'לא נענתה',
  contains: 'מכיל',
};

// Publish-validation problem codes → Hebrew (rendered in the builder).
export const PUBLISH_PROBLEM_LABELS = {
  template_title_missing_default_language: 'לכותרת השאלון חסר תרגום בשפת ברירת המחדל',
  no_sections: 'אין מקטעים בשאלון',
  no_questions: 'אין שאלות בשאלון',
  section_title_missing_default_language: 'לכותרת מקטע חסר תרגום בשפת ברירת המחדל',
  question_label_missing_default_language: 'לשאלה חסרה כותרת בשפת ברירת המחדל',
  option_label_missing_default_language: 'לאפשרות חסרה כותרת בשפת ברירת המחדל',
  options_required: 'שאלת בחירה חייבת לכלול לפחות אפשרות אחת',
  duplicate_option_value: 'ערכי אפשרויות כפולים באותה שאלה',
  duplicate_question_key: 'מפתח שאלה כפול',
  unknown_question_type: 'סוג שאלה לא מוכר',
  invalid_condition: 'תנאי תצוגה לא תקין (ייתכן שהוא מפנה לשאלה מאוחרת יותר)',
  invalid_regex: 'תבנית (regex) לא תקינה',
};
