// One place that turns iCount/GOS API failures into clean Hebrew — the modal
// must NEVER render raw upstream bodies (Cloudflare HTML, stack traces).

const CODE_MESSAGES = {
  payment_required: 'כדי להפיק קבלה חובה להזין אמצעי תשלום ופרטי תשלום.',
  payment_amount_invalid: 'סכום תשלום אינו תקין — חובה סכום גדול מאפס.',
  payment_method_duplicate: 'לא ניתן להזין את אותו אמצעי תשלום פעמיים (רק שיקים מרובים נתמכים).',
  payment_method_invalid: 'אמצעי תשלום לא נתמך.',
  doc_date_invalid: 'תאריך המסמך אינו תקין.',
  allocation_fields_missing: 'חסר ח.פ / עוסק מורשה של הלקוח — נדרש עבור מספר הקצאה מרשות המסים.',
  base_document_required: 'חובה לבחור מסמך מקור לחשבונית זיכוי.',
  base_document_type_invalid: 'סוג מסמך המקור אינו תקף לסוג המסמך שנבחר.',
  client_name_required: 'חובה למלא שם לקוח.',
  rows_required: 'חובה להזין לפחות שורת מוצר אחת.',
  invalid_doctype: 'סוג מסמך לא מוכר.',
  docnum_required: 'חובה להזין מספר מסמך.',
  icount_timeout: 'אייקאונט לא הגיב בזמן — נסו שוב בעוד רגע.',
  icount_not_configured: 'חיבור iCount אינו מוגדר בסביבה זו (משתני ICOUNT_*).',
  phone_search_unsupported: 'חיפוש לפי מספר טלפון אינו נתמך ע״י אייקאונט — חפשו לפי אימייל, שם לקוח, ח.פ או מספר מסמך.',
};

export function friendlyIcountError(e) {
  const code = e?.payload?.error;
  const reason = String(e?.payload?.reason || '');
  if (code && CODE_MESSAGES[code]) return CODE_MESSAGES[code];
  if (code === 'icount_request_failed') {
    // iCount's numbering-chronology rejection (issue date earlier than an
    // already-issued document).
    if (/date|chronolog|earlier|later|קדום|מאוחר/i.test(reason)) {
      return 'לא ניתן להפיק מסמך בתאריך זה כי קיימים מסמכים מאוחרים יותר.';
    }
    return `אייקאונט דחה את הבקשה: ${reason.slice(0, 200) || 'שגיאה לא מפורטת'}`;
  }
  // Anything that looks like an HTML page / oversized blob → generic message.
  const msg = String(e?.message || '');
  if (msg.includes('<') || msg.length > 200) return 'השרת אינו זמין כרגע — נסו שוב בעוד רגע.';
  return msg || 'שגיאה לא צפויה — נסו שוב.';
}
