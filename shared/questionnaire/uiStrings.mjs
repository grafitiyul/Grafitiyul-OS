// Runtime UI strings for the questionnaire fill experience — the small fixed
// vocabulary around the admin-authored content (yes/no, choose…, validation
// messages). he + en are maintained; any other language falls back to en
// (the admin-authored CONTENT itself is fully localized via the JSON maps —
// this file only covers engine chrome).

const STRINGS = {
  he: {
    yes: 'כן',
    no: 'לא',
    choose: 'בחירה…',
    other: 'אחר…',
    otherDetail: 'פירוט…',
    submit: 'שליחה',
    submitting: 'שולח…',
    previewNote: 'תצוגה מקדימה — התשובות אינן נשמרות',
    back: 'הקודם',
    next: 'הבא',
    uploadImage: 'העלאת תמונה',
    uploadFile: 'העלאת קובץ',
    uploadFailed: 'ההעלאה נכשלה — נסו שוב',
    signHere: 'חתמו כאן בעזרת האצבע או העכבר',
    signAgain: 'חתימה מחדש',
    errors: {
      required: 'שדה חובה',
      invalid_type: 'ערך לא תקין',
      invalid_email: 'כתובת אימייל לא תקינה',
      invalid_phone: 'מספר טלפון לא תקין',
      invalid_url: 'כתובת לא תקינה',
      invalid_date: 'תאריך לא תקין',
      invalid_time: 'שעה לא תקינה',
      invalid_datetime: 'תאריך ושעה לא תקינים',
      unknown_option: 'בחירה לא תקינה',
      other_not_allowed: 'בחירה לא תקינה',
      other_text_required: 'יש למלא טקסט חופשי',
      too_long: 'הטקסט ארוך מדי',
      too_few_selections: 'יש לבחור עוד אפשרויות',
      too_many_selections: 'נבחרו יותר מדי אפשרויות',
      duplicate_values: 'בחירה כפולה',
      out_of_range: 'ערך מחוץ לטווח',
      below_min: 'ערך נמוך מדי',
      above_max: 'ערך גבוה מדי',
      pattern_mismatch: 'פורמט לא תקין',
      not_integer: 'יש להזין מספר שלם',
    },
  },
  en: {
    yes: 'Yes',
    no: 'No',
    choose: 'Choose…',
    other: 'Other…',
    otherDetail: 'Please specify…',
    submit: 'Submit',
    submitting: 'Submitting…',
    previewNote: 'Preview — answers are not saved',
    back: 'Back',
    next: 'Next',
    uploadImage: 'Upload image',
    uploadFile: 'Upload file',
    uploadFailed: 'Upload failed — try again',
    signHere: 'Sign here with your finger or mouse',
    signAgain: 'Sign again',
    errors: {
      required: 'Required field',
      invalid_type: 'Invalid value',
      invalid_email: 'Invalid email address',
      invalid_phone: 'Invalid phone number',
      invalid_url: 'Invalid URL',
      invalid_date: 'Invalid date',
      invalid_time: 'Invalid time',
      invalid_datetime: 'Invalid date/time',
      unknown_option: 'Invalid choice',
      other_not_allowed: 'Invalid choice',
      other_text_required: 'Please fill in the free text',
      too_long: 'Text is too long',
      too_few_selections: 'Please select more options',
      too_many_selections: 'Too many options selected',
      duplicate_values: 'Duplicate selection',
      out_of_range: 'Value out of range',
      below_min: 'Value too low',
      above_max: 'Value too high',
      pattern_mismatch: 'Invalid format',
      not_integer: 'Please enter a whole number',
    },
  },
};

export function uiStrings(lang) {
  return STRINGS[lang] || STRINGS.en;
}

export function errorText(lang, code) {
  const s = uiStrings(lang);
  return s.errors[code] || s.errors.invalid_type;
}
