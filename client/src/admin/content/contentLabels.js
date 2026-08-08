// Business language for the Content Library. Internal identifiers
// ('mirrored_to_r2', 'external_reference', 'queued') never reach the screen —
// operators read about content, not about storage strategies.

export const CONTENT_TYPE_LABELS = {
  video: 'וידאו',
  audio: 'אודיו',
  image: 'תמונה',
  pdf: 'PDF',
  document: 'מסמך',
  youtube: 'יוטיוב',
  vimeo: 'וימאו',
  link: 'קישור',
  r2: 'אחסון שלנו',
};

const GLYPHS = {
  video: '🎬',
  audio: '🎧',
  image: '🖼️',
  pdf: '📄',
  document: '📄',
  youtube: '▶️',
  vimeo: '🎞️',
  link: '🔗',
};

export function typeGlyph(type) {
  return GLYPHS[type] || '📦';
}

// Processing state, worded honestly. "queued" and "processing" are their own
// states — neither is ever dressed up as success — and a failure carries its
// reason in the tooltip rather than showing a bare "נכשל".
export const TRANSCRIPT_LABELS = {
  not_started: { label: 'אין תמלול', className: 'bg-gray-100 text-gray-600' },
  queued: { label: 'בתור', className: 'bg-blue-50 text-blue-700' },
  processing: { label: 'מתמלל…', className: 'bg-blue-50 text-blue-700' },
  completed: { label: 'תומלל', className: 'bg-emerald-50 text-emerald-700' },
  failed: { label: 'נכשל', className: 'bg-red-50 text-red-700' },
  unavailable: { label: 'לא זמין', className: 'bg-gray-100 text-gray-400' },
};

// Why an action is unavailable, in words an operator can act on.
export const BLOCKED_REASONS = {
  transcription_not_configured: 'תמלול לא מוגדר במערכת — חסר מפתח ספק.',
  not_audio_or_video: 'תמלול אפשרי רק לווידאו או אודיו.',
  youtube_reference_has_no_media: 'תמלול לא זמין למקור זה — סרטון יוטיוב נשאר אצל יוטיוב, ואיננו מורידים אותו.',
  external_reference_has_no_media: 'תמלול לא זמין למקור זה — אין אצלנו קובץ מדיה.',
  file_too_large_for_provider: 'הקובץ גדול מהמותר לתמלול (25MB).',
  no_media: 'לפריט אין קובץ מדיה.',
  r2_not_configured: 'האחסון לא מוגדר.',
  media_object_missing: 'קובץ המדיה לא נמצא באחסון.',
  transcription_returned_empty: 'הספק החזיר תמלול ריק — ייתכן שאין דיבור בקובץ.',
  vimeo_no_source_file_exposed: 'וימאו לא חושף קובץ מקור להורדה עבור הסרטון הזה.',
  plan_does_not_expose_source_files: 'החשבון בוימאו לא חושף קובצי מקור — נדרשת חבילה שתומכת בהורדה.',
  token_missing_video_files_scope: 'לטוקן של וימאו חסרה הרשאת video_files.',
  no_videos_available_to_verify_download: 'אין סרטונים בחשבון שאפשר לבדוק עליהם זמינות הורדה.',
  vimeo_not_configured: 'וימאו לא מחובר.',
  youtube_not_configured: 'יוטיוב לא מחובר.',
  youtube_download_not_supported: 'לא מורידים סרטוני יוטיוב — הסרטון נשאר ביוטיוב.',
  no_source_file_exposed: 'אין קובץ מקור זמין להורדה.',
};

export function reasonText(code) {
  return BLOCKED_REASONS[code] || code || '';
}

export function fmtDuration(seconds) {
  if (!seconds && seconds !== 0) return '—';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function fmtBytes(bytes) {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = Number(bytes);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
