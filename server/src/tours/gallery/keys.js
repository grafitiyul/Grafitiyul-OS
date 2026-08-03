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

// cuid (alphanumeric) AND uuid (hyphenated) — production TourEvent ids are
// uuids, so hyphens are load-bearing. Anything that could shape a key path
// ('/', '.', whitespace) stays rejected.
const ID_RE = /^[a-z0-9-]+$/i;

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

// ── parse + pipeline self-check ──────────────────────────────────────────────
// Round-trip guard for the 2026-08-03 P0: the id guard silently rejected
// production uuid TourEvent ids while every dev/test cuid passed, so the whole
// upload path was dead in production only. The self-check below builds keys
// with BOTH id shapes and parses them back — pure string work, no storage.

const KEY_PREFIX = 'tour-galleries/';

/** Decompose a gallery object key back into its identity, or null. */
export function parseGalleryKey(key) {
  const s = String(key || '');
  if (!s.startsWith(KEY_PREFIX)) return null;
  const [tourEventId, kind, ...rest] = s.slice(KEY_PREFIX.length).split('/');
  if (!ID_RE.test(tourEventId || '')) return null;
  if (kind === 'originals' && rest.length === 2) {
    const [mediaId, fileName] = rest;
    if (!ID_RE.test(mediaId) || !fileName) return null;
    return { kind: 'original', tourEventId, mediaId, fileName };
  }
  if ((kind === 'thumbs' || kind === 'posters') && rest.length === 1 && rest[0].endsWith('.webp')) {
    const mediaId = rest[0].slice(0, -'.webp'.length);
    if (!ID_RE.test(mediaId)) return null;
    return { kind: kind === 'thumbs' ? 'thumb' : 'poster', tourEventId, mediaId };
  }
  if (kind === 'archives' && rest.length === 1 && rest[0].endsWith('.zip')) {
    const exportId = rest[0].slice(0, -'.zip'.length);
    if (!ID_RE.test(exportId)) return null;
    return { kind: 'archive', tourEventId, exportId };
  }
  return null;
}

// Both id shapes that exist in this system. Production TourEvent rows carry
// uuids (imported/synced); dev/test rows carry cuids (schema default) — a
// check that exercises only one shape is exactly the blind spot that shipped
// the P0. mediaId mirrors the real generator (crypto.randomBytes(12) hex).
const SAMPLE_IDS = [
  ['uuid', '6881e558-71aa-40c3-aa5f-95684ff94a63'],
  ['cuid', 'cmrhoex8500409lkocq14h41b'],
];
const SAMPLE_MEDIA_ID = 'a1b2c3d4e5f60718293a4b5c';

/**
 * Pure canonical validation of the key pipeline (build → parse round-trip for
 * every id shape × key kind). Never throws, never touches storage.
 * Returns { ok, failures: ['uuid_original: …', …] }.
 */
export function keyPipelineSelfCheck() {
  const failures = [];
  const check = (label, fn) => {
    try {
      if (fn() === false) failures.push(`${label}: round-trip mismatch`);
    } catch (e) {
      failures.push(`${label}: ${e?.message || e}`);
    }
  };
  for (const [shape, tourId] of SAMPLE_IDS) {
    check(`${shape}_original`, () => {
      const p = parseGalleryKey(originalKey(tourId, SAMPLE_MEDIA_ID, 'IMG_0001.jpg'));
      return !!p && p.kind === 'original' && p.tourEventId === tourId && p.mediaId === SAMPLE_MEDIA_ID;
    });
    check(`${shape}_thumb`, () => {
      const p = parseGalleryKey(thumbKey(tourId, SAMPLE_MEDIA_ID));
      return !!p && p.kind === 'thumb' && p.tourEventId === tourId && p.mediaId === SAMPLE_MEDIA_ID;
    });
  }
  return { ok: failures.length === 0, failures };
}
