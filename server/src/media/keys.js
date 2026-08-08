// THE canonical R2 key builder for the media platform.
//
// Inherits the tour gallery's hard-won rule unchanged: keys are built ONLY from
// immutable ids — never from a title, customer name, product or date. Those
// change, and changing them must never move or copy a storage object. Display
// text is always computed live at read time.
//
// Three storage scopes, one shape:
//   tour       tour-galleries/<tourEventId>/…   (HISTORICAL — byte-identical to
//                                                what shipped; existing objects
//                                                must keep resolving forever)
//   gallery    galleries/<galleryId>/…          (standalone CRM gallery)
//   library    library/…                        (Content Library asset, in no
//                                                gallery — the mediaId already
//                                                appears in the key body, so the
//                                                prefix carries no owner id)
//
// The tour scope DELEGATES to tours/gallery/keys.js rather than re-deriving the
// same string here. That is deliberate: two independent implementations of a
// production key format is exactly how live objects become unreachable, so the
// old module stays the single author of the old prefix.

import {
  galleryPrefix as tourGalleryPrefix,
  sanitizeFileName,
} from '../tours/gallery/keys.js';

export { sanitizeFileName };

// cuid (alphanumeric) AND uuid (hyphenated). Production TourEvent ids are
// uuids, so hyphens are load-bearing — a 2026-08-03 P0 was caused by a guard
// that silently rejected them in production while every dev cuid passed.
// Anything that could reshape a key path ('/', '.', whitespace) stays rejected.
const ID_RE = /^[a-z0-9-]+$/i;

function assertId(id, label) {
  if (!ID_RE.test(String(id || ''))) throw new Error(`invalid_${label}`);
  return String(id);
}

/**
 * The storage prefix for an asset, from its owning scope.
 *
 * The library scope must be requested EXPLICITLY (`{ library: true }`) rather
 * than being the fallback for "no owner given". An empty or malformed
 * galleryId must be an error, never a silent downgrade to another prefix —
 * silently relocating objects is how uploads become unreachable later.
 *
 * @param {{tourEventId?: string|null, galleryId?: string|null, library?: boolean}} owner
 */
export function storagePrefix(owner = {}) {
  const { tourEventId, galleryId, library } = owner;
  if (tourEventId != null && tourEventId !== '') return tourGalleryPrefix(tourEventId);
  if (galleryId != null && galleryId !== '') {
    return `galleries/${assertId(galleryId, 'gallery_id')}/`;
  }
  if (library === true) return 'library/';
  throw new Error('invalid_storage_scope');
}

/**
 * The storage owner of an EXISTING media row.
 *
 * Precedence is tour → gallery → library, and it must stay that way: a tour
 * asset also carries a galleryId, and reading that first would look for its
 * objects under a prefix where none were ever written.
 */
export function ownerOf(media) {
  if (media?.tourEventId) return { tourEventId: media.tourEventId };
  if (media?.galleryId) return { galleryId: media.galleryId };
  return { library: true };
}

/** Which scope a prefix belongs to — 'tour' | 'gallery' | 'library'. */
export function scopeOf(owner = {}) {
  if (owner.tourEventId) return 'tour';
  if (owner.galleryId) return 'gallery';
  if (owner.library === true) return 'library';
  throw new Error('invalid_storage_scope');
}

export function originalKey(owner, mediaId, fileName) {
  return `${storagePrefix(owner)}originals/${assertId(mediaId, 'media_id')}/${sanitizeFileName(fileName)}`;
}

export function thumbKey(owner, mediaId) {
  return `${storagePrefix(owner)}thumbs/${assertId(mediaId, 'media_id')}.webp`;
}

export function posterKey(owner, mediaId) {
  return `${storagePrefix(owner)}posters/${assertId(mediaId, 'media_id')}.webp`;
}

export function archiveKey(owner, exportId) {
  return `${storagePrefix(owner)}archives/${assertId(exportId, 'export_id')}.zip`;
}

// ── parse + self-check ───────────────────────────────────────────────────────

const PREFIXES = [
  ['tour', 'tour-galleries/'],
  ['gallery', 'galleries/'],
  ['library', 'library/'],
];

/** Decompose any media key back into { scope, ownerId, kind, mediaId }, or null. */
export function parseMediaKey(key) {
  const s = String(key || '');
  // Longest prefix first: 'galleries/' is a suffix-collision risk against
  // 'tour-galleries/' only in the other direction, but ordering keeps it exact.
  const found = PREFIXES.find(([, p]) => s.startsWith(p));
  if (!found) return null;
  const [scope, prefix] = found;
  const parts = s.slice(prefix.length).split('/');

  // Tour and gallery scopes carry an owner id right after the prefix; the
  // library scope has none (its assets are identified by mediaId in the body).
  let ownerId = null;
  if (scope !== 'library') {
    ownerId = parts.shift();
    if (!ID_RE.test(ownerId || '')) return null;
  }
  const [kind, ...rest] = parts;

  if (kind === 'originals' && rest.length === 2) {
    const [mediaId, fileName] = rest;
    if (!ID_RE.test(mediaId) || !fileName) return null;
    return { scope, ownerId, kind: 'original', mediaId, fileName };
  }
  if ((kind === 'thumbs' || kind === 'posters') && rest.length === 1 && rest[0].endsWith('.webp')) {
    const mediaId = rest[0].slice(0, -'.webp'.length);
    if (!ID_RE.test(mediaId)) return null;
    return { scope, ownerId, kind: kind === 'thumbs' ? 'thumb' : 'poster', mediaId };
  }
  if (kind === 'archives' && rest.length === 1 && rest[0].endsWith('.zip')) {
    const exportId = rest[0].slice(0, -'.zip'.length);
    if (!ID_RE.test(exportId)) return null;
    return { scope, ownerId, kind: 'archive', exportId };
  }
  return null;
}

// Both id shapes that exist in this system — a check exercising only one is
// precisely the blind spot that shipped the 2026-08-03 P0.
const SAMPLE_IDS = [
  ['uuid', '6881e558-71aa-40c3-aa5f-95684ff94a63'],
  ['cuid', 'cmrhoex8500409lkocq14h41b'],
];
const SAMPLE_MEDIA_ID = 'a1b2c3d4e5f60718293a4b5c';

/**
 * Pure build → parse round-trip over every id shape × scope × key kind.
 * Never throws, never touches storage. Returns { ok, failures: [...] }.
 */
export function mediaKeyPipelineSelfCheck() {
  const failures = [];
  const check = (label, fn) => {
    try {
      if (fn() === false) failures.push(`${label}: round-trip mismatch`);
    } catch (e) {
      failures.push(`${label}: ${e?.message || e}`);
    }
  };
  const owners = (id) => [
    ['tour', { tourEventId: id }, id],
    ['gallery', { galleryId: id }, id],
    ['library', { library: true }, null],
  ];
  for (const [shape, id] of SAMPLE_IDS) {
    for (const [scope, owner, ownerId] of owners(id)) {
      check(`${shape}_${scope}_original`, () => {
        const p = parseMediaKey(originalKey(owner, SAMPLE_MEDIA_ID, 'IMG_0001.jpg'));
        return !!p && p.scope === scope && p.ownerId === ownerId && p.kind === 'original'
          && p.mediaId === SAMPLE_MEDIA_ID;
      });
      check(`${shape}_${scope}_thumb`, () => {
        const p = parseMediaKey(thumbKey(owner, SAMPLE_MEDIA_ID));
        return !!p && p.scope === scope && p.kind === 'thumb' && p.mediaId === SAMPLE_MEDIA_ID;
      });
    }
    // The compatibility guarantee, asserted rather than assumed: the generic
    // builder must emit EXACTLY the historical tour key.
    check(`${shape}_tour_compat`, () => {
      const generic = originalKey({ tourEventId: id }, SAMPLE_MEDIA_ID, 'IMG_0001.jpg');
      return generic === `tour-galleries/${id}/originals/${SAMPLE_MEDIA_ID}/IMG_0001.jpg`;
    });
  }
  return { ok: failures.length === 0, failures };
}
