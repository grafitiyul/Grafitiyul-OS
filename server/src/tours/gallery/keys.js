// Stable R2 object keys for Tour Gallery media. THE RULE (project decision):
// keys are built ONLY from immutable ids — never from product name, customer
// name, date, time or gallery title. Those change; changing them must never
// move or copy storage objects. Display titles are computed live from
// TourEvent data (see service.buildGalleryTitle).
//
// Layout under one per-tour prefix (cleanup purges the whole prefix):
//   tour-galleries/<tourEventId>/originals/<mediaId>/<safeFileName>
//   tour-galleries/<tourEventId>/thumbs/<mediaId>.webp
//   tour-galleries/<tourEventId>/posters/<mediaId>.webp
//   tour-galleries/<tourEventId>/archives/<exportId>.zip

const ID_RE = /^[a-z0-9]+$/i;

function assertId(id, label) {
  if (!ID_RE.test(String(id || ''))) throw new Error(`invalid_${label}`);
  return String(id);
}

// Keep a human-recognizable filename tail (nice download names come from the
// DB row, not the key — this is only for storage-console readability).
export function sanitizeFileName(name) {
  const s = String(name || 'file')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(-80);
  return s || 'file';
}

export function galleryPrefix(tourEventId) {
  return `tour-galleries/${assertId(tourEventId, 'tour_event_id')}/`;
}

export function originalKey(tourEventId, mediaId, fileName) {
  return `${galleryPrefix(tourEventId)}originals/${assertId(mediaId, 'media_id')}/${sanitizeFileName(fileName)}`;
}

export function thumbKey(tourEventId, mediaId) {
  return `${galleryPrefix(tourEventId)}thumbs/${assertId(mediaId, 'media_id')}.webp`;
}

export function posterKey(tourEventId, mediaId) {
  return `${galleryPrefix(tourEventId)}posters/${assertId(mediaId, 'media_id')}.webp`;
}

export function archiveKey(tourEventId, exportId) {
  return `${galleryPrefix(tourEventId)}archives/${assertId(exportId, 'export_id')}.zip`;
}
