// THE media & content translation registry.
//
// One file, two languages, every static UI string of the PUBLIC gallery — and
// the canonical Hebrew vocabulary the Content Library admin reuses for shared
// concepts (download, upload, delete, processing, failed, ready, transcript…),
// so the same idea can never be worded two different ways in two modules.
//
// Same rules as the Guide Portal registry (portal/i18n.js), deliberately:
//   * no component may write a user-visible literal inline
//   * no component may carry its own `lang === 'en' ? … : …` ternary — that is
//     exactly how a product ends up half-translated
//   * components call `t.<group>.<key>` and nothing else
//
// SCOPE — CHROME ONLY. This file contains ZERO business data. Gallery titles,
// subtitles, captions, customer names and product names are DATA: they are
// resolved from their own bilingual columns on the server and shipped verbatim.
// Putting a business value here would be a translation-in-code bug.
//
// BRAND / PROPER NOUNS are intentionally identical in both languages and are
// NOT translated: Grafitiyul, YouTube, Vimeo, R2, ZIP, PDF, CORS.

export const MEDIA_LANGUAGES = ['he', 'en'];
export const DEFAULT_MEDIA_LANGUAGE = 'he';

export function mediaDir(lang) {
  return lang === 'en' ? 'ltr' : 'rtl';
}

export function normalizeMediaLanguage(value) {
  const v = String(value ?? '').trim().toLowerCase();
  return MEDIA_LANGUAGES.includes(v) ? v : DEFAULT_MEDIA_LANGUAGE;
}

const HE = {
  common: {
    loading: 'טוען…',
    close: 'סגירה',
    cancel: 'ביטול',
    retry: 'נסו שוב',
    previous: 'הקודם',
    next: 'הבא',
    media: 'מדיה',
    switchLanguage: 'English',
    brand: 'גרפיטיול',
  },
  gallery: {
    loadingGallery: 'טוען את הגלריה…',
    unavailableTitle: 'הגלריה אינה זמינה',
    unavailableSub: 'ייתכן שהקישור הוחלף או שהגלריה הוסרה. פנו אלינו לקבלת קישור מעודכן.',
    errorTitle: 'שגיאה בטעינת הגלריה',
    errorSub: 'נסו לרענן את העמוד.',
    emptyTitle: 'הגלריה עדיין ריקה',
    emptyBody: 'התמונות והסרטונים יופיעו כאן.',
    emptyUploadHint: 'יש לכם תמונות משלכם? הוסיפו אותן עכשיו.',
    emptyGrid: 'אין עדיין תמונות או סרטונים',
    itemCount: (n) => `${n} תמונות וסרטונים`,
    groupBadge: 'קבוצתי',
    coverBadge: '★ קאבר',
    genericActivity: 'סיור',
  },
  actions: {
    upload: 'העלאת תמונות וסרטונים',
    uploadShort: 'העלה',
    uploadPill: 'העלאת תמונות',
    downloadAll: '⬇ הורדת הכול (ZIP)',
    downloadReady: '⬇ הקובץ מוכן — הורדה',
    preparingArchive: 'מכינים את הקובץ…',
    archiveFailed: 'ההכנה נכשלה — נסו שוב',
    download: 'הורדה',
    delete: 'מחיקה',
    edit: 'עריכה',
    copyLink: 'העתקת קישור',
    save: 'שמירה',
  },
  uploadQueue: {
    waiting: 'ממתין',
    preparing: 'מכין…',
    uploading: 'מעלה…',
    verifying: 'מאמת…',
    done: 'הושלם',
    failed: 'נכשל',
    canceled: 'בוטל',
    rejected: 'לא נתמך',
    cancel: 'ביטול',
    retryAllFailed: '↻ נסו שוב את כל הכושלים',
    separator: ' · ',
    doneOf: (done, total) => `${done} מתוך ${total} הועלו`,
    uploadingN: (n) => `${n} מעלים`,
    queuedN: (n) => `${n} ממתינים`,
    failedN: (n) => `${n} נכשלו`,
    rejectedN: (n) => `${n} לא נתמכים`,
    // Fallback for a status this build does not know. Never the raw enum.
    unknownState: 'בעיבוד…',
  },
  uploader: {
    office: 'משרד',
    guide: 'מדריך',
    customer: 'לקוח',
  },
  caption: {
    placeholder: 'הוסיפו כיתוב…',
  },
  footer: {
    contactTitle: 'להזמנת פעילויות דומות:',
    tagline: 'גרפיטיול · סיורי גרפיטי ואמנות רחוב',
  },
  uploadErrors: {
    r2_not_configured: 'אחסון הקבצים אינו מוגדר בשרת',
    uploads_disabled: 'העלאת קבצים כבויה בגלריה זו',
    gallery_archived: 'הגלריה סגורה כרגע להעלאות',
    tour_cancelled: 'הסיור בוטל — לא ניתן להעלות אליו מדיה',
    no_files: 'לא נבחרו קבצים',
    too_many_files_per_call: 'יותר מדי קבצים בבקשה אחת',
    unsupported_type: 'סוג הקובץ לא נתמך (רק תמונות וסרטונים)',
    file_too_large: 'הקובץ גדול מדי',
    invalid_size: 'גודל הקובץ לא תקין',
    not_found: 'הפריט לא נמצא',
    not_pending: 'הקובץ כבר הועלה',
    already_ready: 'הקובץ כבר הועלה',
    rejected: 'הקובץ נדחה',
    canceled: 'ההעלאה בוטלה',
    incomplete: 'ההעלאה לא הושלמה — נסו שוב',
    no_parts: 'לא נקלטו חלקים מהקובץ — נסו שוב',
    session_expired: 'סשן ההעלאה פג — נסו שוב',
    verification_failed: 'האימות נכשל — תוכן הקובץ אינו תואם את סוגו',
    forbidden: 'אין הרשאה לפעולה זו',
    storage_forbidden: 'האחסון דחה את הבקשה — ייתכן שקישור ההעלאה פג (403)',
    network: 'החיבור לאחסון נכשל — בעיית רשת או חסימת אבטחה (CORS)',
    server: 'תקלה זמנית בשרת — נסו שוב בעוד רגע',
    storageRejected: (code) => `האחסון דחה את הבקשה (${code})`,
    storageTemporary: (code) => `תקלת אחסון זמנית (${code})`,
    generic: 'ההעלאה נכשלה — נסו שוב',
  },
};

const EN = {
  common: {
    loading: 'Loading…',
    close: 'Close',
    cancel: 'Cancel',
    retry: 'Try again',
    previous: 'Previous',
    next: 'Next',
    media: 'Media',
    switchLanguage: 'עברית',
    brand: 'Grafitiyul',
  },
  gallery: {
    loadingGallery: 'Loading the gallery…',
    unavailableTitle: 'This gallery is not available',
    unavailableSub: 'The link may have been replaced, or the gallery removed. Contact us for an up-to-date link.',
    errorTitle: 'Could not load the gallery',
    errorSub: 'Please refresh the page.',
    emptyTitle: 'This gallery is still empty',
    emptyBody: 'Photos and videos will appear here.',
    emptyUploadHint: 'Have photos of your own? Add them now.',
    emptyGrid: 'No photos or videos yet',
    itemCount: (n) => `${n} photos and videos`,
    groupBadge: 'Group',
    coverBadge: '★ Cover',
    genericActivity: 'Tour',
  },
  actions: {
    upload: 'Upload photos and videos',
    uploadShort: 'Upload',
    uploadPill: 'Upload photos',
    downloadAll: '⬇ Download all (ZIP)',
    downloadReady: '⬇ Ready — download',
    preparingArchive: 'Preparing your file…',
    archiveFailed: 'Preparation failed — try again',
    download: 'Download',
    delete: 'Delete',
    edit: 'Edit',
    copyLink: 'Copy link',
    save: 'Save',
  },
  uploadQueue: {
    waiting: 'Waiting',
    preparing: 'Preparing…',
    uploading: 'Uploading…',
    verifying: 'Verifying…',
    done: 'Done',
    failed: 'Failed',
    canceled: 'Canceled',
    rejected: 'Not supported',
    cancel: 'Cancel',
    retryAllFailed: '↻ Retry all failed',
    separator: ' · ',
    doneOf: (done, total) => `${done} of ${total} uploaded`,
    uploadingN: (n) => `${n} uploading`,
    queuedN: (n) => `${n} waiting`,
    failedN: (n) => `${n} failed`,
    rejectedN: (n) => `${n} unsupported`,
    unknownState: 'Working…',
  },
  uploader: {
    office: 'Office',
    guide: 'Guide',
    customer: 'Guest',
  },
  caption: {
    placeholder: 'Add a caption…',
  },
  footer: {
    contactTitle: 'To book a similar activity:',
    tagline: 'Grafitiyul · Graffiti and street-art tours',
  },
  uploadErrors: {
    r2_not_configured: 'File storage is not configured on the server',
    uploads_disabled: 'Uploads are turned off for this gallery',
    gallery_archived: 'This gallery is currently closed for uploads',
    tour_cancelled: 'The tour was cancelled — media cannot be uploaded to it',
    no_files: 'No files selected',
    too_many_files_per_call: 'Too many files in one request',
    unsupported_type: 'This file type is not supported (images and videos only)',
    file_too_large: 'The file is too large',
    invalid_size: 'Invalid file size',
    not_found: 'Item not found',
    not_pending: 'This file was already uploaded',
    already_ready: 'This file was already uploaded',
    rejected: 'The file was rejected',
    canceled: 'Upload canceled',
    incomplete: 'The upload did not finish — try again',
    no_parts: 'No parts of the file were received — try again',
    session_expired: 'The upload session expired — try again',
    verification_failed: 'Verification failed — the file contents do not match its type',
    forbidden: 'You do not have permission for this action',
    storage_forbidden: 'Storage rejected the request — the upload link may have expired (403)',
    network: 'Could not reach storage — a network problem or a security block (CORS)',
    server: 'A temporary server problem — try again in a moment',
    storageRejected: (code) => `Storage rejected the request (${code})`,
    storageTemporary: (code) => `Temporary storage problem (${code})`,
    generic: 'The upload failed — try again',
  },
};

const STRINGS = { he: HE, en: EN };

export function mediaStrings(lang) {
  return STRINGS[normalizeMediaLanguage(lang)];
}

/** The canonical Hebrew vocabulary, for the Hebrew-only admin surfaces. */
export const MEDIA_VOCABULARY_HE = HE;

export { HE as MEDIA_STRINGS_HE, EN as MEDIA_STRINGS_EN };
