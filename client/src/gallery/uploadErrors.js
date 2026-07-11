// Human-readable upload failure reasons — one mapper for every surface
// (staff workspace, guide portal, customer page). The raw code stays
// available for QA (UploadQueuePanel puts it in the row's title attribute);
// the user sees WHAT went wrong in plain Hebrew, not 'upload_http_403'.

const EXACT = {
  unsupported_type: 'סוג הקובץ לא נתמך (רק תמונות וסרטונים)',
  file_too_large: 'הקובץ גדול מדי',
  invalid_size: 'גודל הקובץ לא תקין',
  // XHR status 0: offline, connection dropped mid-file, or the browser
  // blocked the request because the storage bucket has no CORS policy.
  network_error: 'החיבור לאחסון נכשל — בעיית רשת או חסימת אבטחה (CORS)',
  aborted: 'ההעלאה בוטלה',
  object_missing: 'ההעלאה לא הושלמה — נסו שוב',
  invalid_content: 'האימות נכשל — תוכן הקובץ אינו תואם את סוגו',
  no_parts_uploaded: 'לא נקלטו חלקים מהקובץ — נסו שוב',
  upload_not_found: 'סשן ההעלאה פג — נסו שוב',
  not_pending: 'הקובץ כבר הועלה',
  tour_cancelled: 'הסיור בוטל — לא ניתן להעלות אליו מדיה',
  uploads_disabled: 'העלאת קבצים כבויה בגלריה זו',
  r2_not_configured: 'אחסון הקבצים אינו מוגדר בשרת',
  too_many_files_per_call: 'יותר מדי קבצים בבקשה אחת',
  not_allowed: 'אין הרשאה לפעולה זו',
  not_found: 'הפריט לא נמצא',
  no_files: 'לא נבחרו קבצים',
  rejected: 'הקובץ נדחה',
};

export function uploadErrorLabel(code) {
  if (!code) return '';
  const c = String(code);
  if (EXACT[c]) return EXACT[c];
  if (c.startsWith('upload_http_403')) return 'האחסון דחה את הבקשה — ייתכן שקישור ההעלאה פג (403)';
  if (c.startsWith('upload_http_4')) return `האחסון דחה את הבקשה (${c.replace('upload_http_', '')})`;
  if (c.startsWith('upload_http_5')) return `תקלת אחסון זמנית (${c.replace('upload_http_', '')}) — נסו שוב`;
  if (c.startsWith('HTTP ')) return `שגיאת שרת (${c.slice(5).trim()})`;
  return `שגיאה: ${c}`;
}
