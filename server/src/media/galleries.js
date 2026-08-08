import { prisma } from '../db.js';
import {
  GENERIC_GALLERY_TITLE_EN,
  GENERIC_GALLERY_TITLE_HE,
  buildGalleryTitle,
  newGalleryToken,
} from '../tours/gallery/service.js';
import { GALLERY_AUDIT_ACTIONS, recordGalleryAudit } from './audit.js';

// THE canonical gallery service — one engine, two use cases.
//
//   TOUR gallery       tourEventId set. Untouched behaviour: the title is
//                      derived live from TourEvent data, guides upload through
//                      the portal, cancellation cleanup applies, and the
//                      customer link keeps its historical semantics.
//   STANDALONE gallery tourEventId NULL. Operator-created from CRM Settings,
//                      carries its own internal name, bilingual public text and
//                      permission matrix.
//
// Functions take the prisma client (or a tx) first so tests can stub them, the
// same convention as tours/gallery/service.js.

export const GALLERY_STATUS = Object.freeze({ active: 'active', archived: 'archived' });
export const LINK_STATUS = Object.freeze({
  active: 'active',
  disabled: 'disabled',
  revoked: 'revoked',
});

// The external permission matrix. Defaults are the SAFE ones: a freshly created
// gallery can be viewed and downloaded, and nothing more. Upload/delete/edit are
// each an explicit operator decision.
export const DEFAULT_EXTERNAL_PERMISSIONS = Object.freeze({
  extCanView: true,
  extCanDownload: true,
  extCanUpload: false,
  extCanDelete: false,
  extCanEdit: false,
});

export const PERMISSION_KEYS = Object.freeze(Object.keys(DEFAULT_EXTERNAL_PERMISSIONS));

function normLang(lang) {
  return String(lang || '').toLowerCase() === 'en' ? 'en' : 'he';
}

/**
 * The customer-facing text of ANY gallery, in one place.
 *
 * For a tour gallery the title is still derived live from TourEvent data (the
 * proven behaviour, privacy rules included). For a standalone gallery it is the
 * operator's bilingual text.
 *
 * internalName is NEVER a fallback here. It is an operator label — leaking it
 * to a customer is the same class of mistake as leaking Deal.title, so an
 * untitled gallery shows the generic wording instead.
 */
export function galleryPublicText(gallery, { lang = 'he', tour = null } = {}) {
  const l = normLang(lang);
  const generic = l === 'en' ? GENERIC_GALLERY_TITLE_EN : GENERIC_GALLERY_TITLE_HE;
  if (gallery?.tourEventId) {
    return { title: buildGalleryTitle(tour, l), subtitle: null };
  }
  const title = (l === 'en' ? gallery?.titleEn : gallery?.titleHe) || '';
  const subtitle = (l === 'en' ? gallery?.subtitleEn : gallery?.subtitleHe) || '';
  // Fall back across languages before falling back to generic wording: a
  // gallery titled only in Hebrew should still read as itself to an English
  // visitor, rather than becoming anonymous.
  const other = (l === 'en' ? gallery?.titleHe : gallery?.titleEn) || '';
  const otherSub = (l === 'en' ? gallery?.subtitleHe : gallery?.subtitleEn) || '';
  return {
    title: title || other || generic,
    subtitle: subtitle || otherSub || null,
  };
}

/** The gallery's preselected public language; the visitor can still switch. */
export function galleryDefaultLanguage(gallery) {
  return normLang(gallery?.defaultLanguage);
}

/**
 * The effective permissions for an EXTERNAL (public-link) visitor.
 *
 * Tour galleries deliberately keep their own proven rules rather than reading
 * the matrix: view + download always, upload only when the tour gallery's own
 * switch is on, and never delete or edit. Their columns are left at defaults
 * and are not consulted, so turning on extCanDelete for a tour gallery cannot
 * hand a customer a delete button.
 */
export function externalPermissions(gallery) {
  if (!gallery) return { ...DEFAULT_EXTERNAL_PERMISSIONS, extCanView: false, extCanDownload: false };
  if (gallery.tourEventId) {
    return {
      extCanView: true,
      extCanDownload: true,
      extCanUpload: !!gallery.customerUploadEnabled,
      extCanDelete: false,
      extCanEdit: false,
    };
  }
  const out = {};
  for (const k of PERMISSION_KEYS) out[k] = !!gallery[k];
  // An archived gallery is readable by nobody externally. Archiving is a soft,
  // reversible "take it down" — it must not require also flipping five
  // permission switches to actually take it down.
  if (gallery.status === GALLERY_STATUS.archived) {
    for (const k of PERMISSION_KEYS) out[k] = false;
  }
  return out;
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function createGallery(client, { internalName, titleHe, titleEn, subtitleHe, subtitleEn, defaultLanguage, permissions, createdById }) {
  const name = String(internalName || '').trim();
  if (!name) {
    const err = new Error('internal_name_required');
    err.status = 422;
    throw err;
  }
  const perms = {};
  for (const k of PERMISSION_KEYS) {
    perms[k] = permissions && k in permissions ? !!permissions[k] : DEFAULT_EXTERNAL_PERMISSIONS[k];
  }
  return client.tourGallery.create({
    data: {
      tourEventId: null,
      internalName: name,
      titleHe: titleHe?.trim() || null,
      titleEn: titleEn?.trim() || null,
      subtitleHe: subtitleHe?.trim() || null,
      subtitleEn: subtitleEn?.trim() || null,
      defaultLanguage: normLang(defaultLanguage),
      status: GALLERY_STATUS.active,
      createdById: createdById || null,
      // Standalone galleries never use the tour-era customer upload switch;
      // extCanUpload is their one upload authority.
      customerUploadEnabled: false,
      ...perms,
    },
  });
}

const EDITABLE_TEXT = ['internalName', 'titleHe', 'titleEn', 'subtitleHe', 'subtitleEn'];

export async function updateGallery(client, galleryId, patch, { actorId = null, req = null } = {}) {
  const gallery = await client.tourGallery.findUnique({ where: { id: galleryId } });
  if (!gallery) {
    const err = new Error('not_found');
    err.status = 404;
    throw err;
  }
  // A tour gallery's identity comes from its TourEvent. Allowing an operator to
  // type a competing title here would create two answers to "what is this
  // gallery called", which is exactly the drift this module exists to prevent.
  if (gallery.tourEventId) {
    const err = new Error('tour_gallery_not_editable');
    err.status = 422;
    throw err;
  }

  const data = {};
  for (const k of EDITABLE_TEXT) {
    if (k in patch) {
      const v = String(patch[k] ?? '').trim();
      if (k === 'internalName' && !v) {
        const err = new Error('internal_name_required');
        err.status = 422;
        throw err;
      }
      data[k] = v || null;
    }
  }
  if ('defaultLanguage' in patch) data.defaultLanguage = normLang(patch.defaultLanguage);
  if ('status' in patch) {
    data.status = patch.status === GALLERY_STATUS.archived
      ? GALLERY_STATUS.archived
      : GALLERY_STATUS.active;
  }

  let permissionsChanged = false;
  for (const k of PERMISSION_KEYS) {
    if (patch.permissions && k in patch.permissions) {
      const next = !!patch.permissions[k];
      if (next !== gallery[k]) permissionsChanged = true;
      data[k] = next;
    }
  }

  const updated = await client.tourGallery.update({ where: { id: galleryId }, data });
  if (permissionsChanged) {
    await recordGalleryAudit(client, {
      galleryId,
      action: GALLERY_AUDIT_ACTIONS.permissionsChanged,
      actorType: 'office',
      actorId,
      req,
      detail: Object.fromEntries(PERMISSION_KEYS.map((k) => [k, updated[k]])),
    });
  }
  return updated;
}

/**
 * Archive = take it down without losing anything. Media stays in R2, the rows
 * stay, links go DISABLED (reversible) rather than revoked — so un-archiving
 * restores the exact same public URL that was already shared.
 */
export async function setGalleryArchived(client, galleryId, archived, { actorId = null, req = null } = {}) {
  const gallery = await client.tourGallery.findUnique({ where: { id: galleryId } });
  if (!gallery) {
    const err = new Error('not_found');
    err.status = 404;
    throw err;
  }
  if (gallery.tourEventId) {
    const err = new Error('tour_gallery_not_editable');
    err.status = 422;
    throw err;
  }
  const updated = await client.tourGallery.update({
    where: { id: galleryId },
    data: { status: archived ? GALLERY_STATUS.archived : GALLERY_STATUS.active },
  });
  await client.tourGalleryLink.updateMany({
    where: {
      galleryId,
      status: archived ? LINK_STATUS.active : LINK_STATUS.disabled,
    },
    data: archived
      ? { status: LINK_STATUS.disabled, disabledAt: new Date(), disabledById: actorId || null }
      : { status: LINK_STATUS.active, disabledAt: null, disabledById: null },
  });
  await recordGalleryAudit(client, {
    galleryId,
    action: archived ? GALLERY_AUDIT_ACTIONS.linkDisabled : GALLERY_AUDIT_ACTIONS.linkEnabled,
    actorType: 'office',
    actorId,
    req,
    detail: { via: 'archive', archived },
  });
  return updated;
}

// ── Media listing / ordering ────────────────────────────────────────────────

const MEDIA_LIVE = { deletedAt: null, uploadStatus: 'ready' };

/**
 * Every asset shown in a gallery: the ones it OWNS plus the ones curated into
 * it from elsewhere (GalleryItem). Ordered by sortOrder, then upload time, so
 * an operator's manual arrangement always wins over chronology.
 */
export async function galleryMedia(client, galleryId) {
  const [owned, curated] = await Promise.all([
    client.tourMedia.findMany({
      where: { galleryId, ...MEDIA_LIVE },
      orderBy: [{ sortOrder: 'asc' }, { completedAt: 'asc' }],
    }),
    client.galleryItem.findMany({
      where: { galleryId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { media: true },
    }),
  ]);
  const seen = new Set(owned.map((m) => m.id));
  const extra = curated
    .map((it) => it.media)
    .filter((m) => m && !seen.has(m.id) && !m.deletedAt && m.uploadStatus === 'ready');
  return [...owned, ...extra];
}

/**
 * Persist a manual arrangement. Only ids already in this gallery are accepted —
 * a reorder payload must never be able to pull a foreign asset into a gallery,
 * which would turn a cosmetic action into an access-control bypass.
 */
export async function reorderGalleryMedia(client, galleryId, orderedIds) {
  const current = await galleryMedia(client, galleryId);
  const allowed = new Map(current.map((m) => [m.id, m]));
  const ids = (orderedIds || []).filter((id) => allowed.has(id));
  await client.$transaction(
    ids.map((id, index) => {
      const media = allowed.get(id);
      return media.galleryId === galleryId
        ? client.tourMedia.update({ where: { id }, data: { sortOrder: index } })
        : client.galleryItem.update({
            where: { galleryId_mediaId: { galleryId, mediaId: id } },
            data: { sortOrder: index },
          });
    }),
  );
  return ids.length;
}

// ── Public links ────────────────────────────────────────────────────────────

export async function getActiveLink(client, galleryId) {
  return client.tourGalleryLink.findFirst({
    where: { galleryId, audience: { in: ['customer', 'external'] }, status: { not: LINK_STATUS.revoked } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function ensureGalleryLink(client, galleryId, { createdById = null } = {}) {
  const existing = await getActiveLink(client, galleryId);
  if (existing) return { link: existing, created: false };
  const link = await client.tourGalleryLink.create({
    data: {
      galleryId,
      audience: 'external',
      token: newGalleryToken(),
      createdById,
    },
  });
  return { link, created: true };
}

/**
 * Rotation: the old token dies permanently and a new one is minted. Deliberately
 * scoped to the public audiences — rotating a leaked customer link must never
 * kill the guide upload links already sent in WhatsApp reminders.
 */
export async function rotateGalleryLink(client, galleryId, { actorId = null, req = null } = {}) {
  await client.tourGalleryLink.updateMany({
    where: {
      galleryId,
      audience: { in: ['customer', 'external'] },
      status: { not: LINK_STATUS.revoked },
    },
    data: { status: LINK_STATUS.revoked, revokedAt: new Date(), revokedReason: 'rotated' },
  });
  const link = await client.tourGalleryLink.create({
    data: { galleryId, audience: 'external', token: newGalleryToken(), createdById: actorId },
  });
  await recordGalleryAudit(client, {
    galleryId,
    action: GALLERY_AUDIT_ACTIONS.linkRotated,
    actorType: 'office',
    actorId,
    req,
  });
  return link;
}

/**
 * Disable / enable — reversible, and NOT the same as rotation.
 *
 * Disabling keeps the token and the media exactly as they are and refuses
 * access; enabling restores the SAME URL, so a link already shared with a
 * customer starts working again without re-sharing anything. Rotation is the
 * irreversible one.
 */
export async function setGalleryLinkEnabled(client, galleryId, enabled, { actorId = null, req = null } = {}) {
  const from = enabled ? LINK_STATUS.disabled : LINK_STATUS.active;
  const to = enabled ? LINK_STATUS.active : LINK_STATUS.disabled;
  const res = await client.tourGalleryLink.updateMany({
    where: { galleryId, audience: { in: ['customer', 'external'] }, status: from },
    data: enabled
      ? { status: to, disabledAt: null, disabledById: null }
      : { status: to, disabledAt: new Date(), disabledById: actorId || null },
  });
  await recordGalleryAudit(client, {
    galleryId,
    action: enabled ? GALLERY_AUDIT_ACTIONS.linkEnabled : GALLERY_AUDIT_ACTIONS.linkDisabled,
    actorType: 'office',
    actorId,
    req,
  });
  return res.count;
}

// ── Listing for the operator ────────────────────────────────────────────────

export async function listGalleries(client, { includeArchived = false, search = '' } = {}) {
  const q = String(search || '').trim();
  const galleries = await client.tourGallery.findMany({
    where: {
      // Standalone galleries only. Tour galleries have their own surface inside
      // the tour, and mixing them into a settings list would invite editing the
      // one thing that must stay derived.
      tourEventId: null,
      ...(includeArchived ? {} : { status: GALLERY_STATUS.active }),
      ...(q
        ? {
            OR: [
              { internalName: { contains: q, mode: 'insensitive' } },
              { titleHe: { contains: q, mode: 'insensitive' } },
              { titleEn: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: { updatedAt: 'desc' },
  });
  if (galleries.length === 0) return [];

  const ids = galleries.map((g) => g.id);
  const [counts, links] = await Promise.all([
    client.tourMedia.groupBy({
      by: ['galleryId', 'mediaType'],
      where: { galleryId: { in: ids }, ...MEDIA_LIVE },
      _count: { _all: true },
    }),
    client.tourGalleryLink.findMany({
      where: { galleryId: { in: ids }, audience: { in: ['customer', 'external'] }, status: { not: LINK_STATUS.revoked } },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  const linkByGallery = new Map();
  for (const l of links) if (!linkByGallery.has(l.galleryId)) linkByGallery.set(l.galleryId, l);

  return galleries.map((g) => {
    const mine = counts.filter((c) => c.galleryId === g.id);
    const link = linkByGallery.get(g.id) || null;
    return {
      ...g,
      imageCount: mine.find((c) => c.mediaType === 'image')?._count?._all || 0,
      videoCount: mine.find((c) => c.mediaType === 'video')?._count?._all || 0,
      link: link ? { token: link.token, status: link.status } : null,
      permissions: externalPermissions(g),
    };
  });
}

export { prisma };
