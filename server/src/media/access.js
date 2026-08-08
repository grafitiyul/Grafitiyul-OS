import { resolveCustomerGalleryAccess } from '../tours/gallery/access.js';
import { LINK_STATUS, externalPermissions, galleryDefaultLanguage, galleryPublicText } from './galleries.js';

// Server-side access resolution for the PUBLIC gallery surface.
//
// The one rule that makes this safe: the gallery identity ALWAYS derives from
// the token. A client-supplied gallery id is never read, so no amount of
// tampering can point a valid token at someone else's gallery.
//
// Every refusal is the same generic 404 — unknown, disabled, revoked, archived
// and cancelled are indistinguishable from outside. A capability surface must
// not explain itself to a caller probing it, and "this link is disabled" would
// confirm that the link once existed.
//
// Tour galleries are delegated WHOLE to the proven tour resolver: guide/staff
// audiences, cancellation and postponement rules, portal switches. Nothing
// about their behaviour is re-implemented here.

const NOT_FOUND = { ok: false, status: 404, error: 'not_found' };

export async function resolvePublicGalleryAccess(client, { token }) {
  const t = String(token || '');
  if (!t) return NOT_FOUND;

  const link = await client.tourGalleryLink.findUnique({
    where: { token: t },
    include: { gallery: true },
  });
  if (!link || !link.gallery) return NOT_FOUND;

  // Tour galleries keep their existing semantics end to end.
  if (link.gallery.tourEventId) {
    return resolveCustomerGalleryAccess(client, { token: t });
  }

  // Only a live link opens a standalone gallery. Disabled is reversible and
  // revoked is not, but from here they read identically.
  if (link.status !== LINK_STATUS.active) return NOT_FOUND;

  const gallery = link.gallery;
  const permissions = externalPermissions(gallery);
  // externalPermissions already zeroes an archived gallery; this makes the
  // consequence explicit rather than relying on every caller checking canView.
  if (!permissions.extCanView) return NOT_FOUND;

  return {
    ok: true,
    link,
    gallery,
    tour: null,
    permissions: {
      canView: permissions.extCanView,
      canDownload: permissions.extCanDownload,
      canUpload: permissions.extCanUpload,
      canDelete: permissions.extCanDelete,
      canEdit: permissions.extCanEdit,
    },
    defaultLanguage: galleryDefaultLanguage(gallery),
    text: (lang) => galleryPublicText(gallery, { lang }),
    uploader: { type: 'customer', linkId: link.id, label: 'אורח' },
  };
}

/**
 * Assert one capability or throw an HTTP-shaped error.
 *
 * Routes call this even when the UI already hid the button, because hiding a
 * control is presentation and this is enforcement. A refused capability answers
 * 403 (the caller legitimately reached a gallery they may view but not modify),
 * which is deliberately different from the 404 that hides a gallery's existence.
 */
export function requireCapability(access, capability) {
  if (!access?.ok || !access.permissions?.[capability]) {
    const err = new Error('not_allowed');
    err.status = access?.ok ? 403 : 404;
    throw err;
  }
  return true;
}

/**
 * An external actor may only ever touch media that belongs to the gallery their
 * token opened. This is the boundary that stops a valid token for gallery A
 * from deleting or editing an asset in gallery B by passing its id.
 */
export async function assertMediaInGallery(client, { galleryId, mediaId }) {
  const media = await client.tourMedia.findFirst({
    where: { id: String(mediaId || ''), deletedAt: null },
    select: { id: true, galleryId: true },
  });
  if (media?.galleryId === galleryId) return media;
  const curated = media
    ? await client.galleryItem.findUnique({
        where: { galleryId_mediaId: { galleryId, mediaId: media.id } },
        select: { mediaId: true },
      })
    : null;
  if (!curated) {
    const err = new Error('not_found');
    err.status = 404;
    throw err;
  }
  return media;
}

/**
 * Which media an external visitor is allowed to MODIFY.
 *
 * canEdit and canDelete are deliberately narrow: they cover the visitor's own
 * uploads, identified by the link that created them, and nothing else. A
 * visitor can tidy what they contributed; they can never touch the operator's
 * media or another guest's. Widening this is an explicit product decision, not
 * something a call site gets to assume.
 */
export function mayModifyMedia(access, media) {
  if (!access?.ok || !media) return false;
  return media.uploadedByType === 'customer' && media.uploadedByLinkId === access.link?.id;
}
