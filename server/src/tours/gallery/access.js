import { getGallerySettings } from './service.js';
import { getGuidePortalSettings } from '../guidePortal/access.js';

// Server-side permission resolution for every gallery surface. UI hiding is
// never the enforcement layer — each route resolves access here first.
//
// Three actors:
//   * office/admin — requireAdminAuth on the route; full rights.
//   * guide — portal token (PersonRef) + a TourAssignment on THIS tour;
//     delete/share rights come from TourGallerySettings.
//   * customer — TourGalleryLink token; view/upload/download only, never
//     delete, and the gallery identity ALWAYS derives from the token.
//
// Failures return { ok: false, status, error } so routes translate 1:1 to
// HTTP. 404 (not 403) for unknown tokens — no enumeration signal.

export async function resolveGuideGalleryAccess(client, { portalToken, tourEventId }) {
  const token = String(portalToken || '');
  if (!token) return { ok: false, status: 404, error: 'not_found' };
  const person = await client.personRef.findUnique({ where: { portalToken: token } });
  if (!person) return { ok: false, status: 404, error: 'not_found' };
  if (!person.portalEnabled || person.status === 'blocked') {
    return { ok: false, status: 403, error: 'portal_disabled' };
  }
  const tour = await client.tourEvent.findUnique({
    where: { id: String(tourEventId || '') },
    select: { id: true, status: true },
  });
  if (!tour) return { ok: false, status: 404, error: 'not_found' };
  const assignment = await client.tourAssignment.findFirst({
    where: { tourEventId: tour.id, externalPersonId: person.externalPersonId },
  });
  if (!assignment) return { ok: false, status: 403, error: 'not_assigned' };
  // Portal-wide switch (Settings → Tours → הרשאות מדריכים): when gallery use
  // is off for guides, every gallery route answers 403 — not just hidden UI.
  const portalSettings = await getGuidePortalSettings(client);
  if (!portalSettings.useTourGallery) {
    return { ok: false, status: 403, error: 'not_allowed' };
  }
  const settings = await getGallerySettings(client);
  return {
    ok: true,
    person,
    assignment,
    tour,
    permissions: {
      canUpload: tour.status !== 'cancelled',
      canDelete: !!settings.guideCanDelete,
      canSetCover: true,
      canShareCustomerLink: !!settings.guideCanShareCustomerLink,
    },
  };
}

export async function resolveCustomerGalleryAccess(client, { token }) {
  const t = String(token || '');
  if (!t) return { ok: false, status: 404, error: 'not_found' };
  const link = await client.tourGalleryLink.findUnique({
    where: { token: t },
    include: { gallery: true },
  });
  if (!link || link.status !== 'active') return { ok: false, status: 404, error: 'not_found' };
  const tour = await client.tourEvent.findUnique({
    where: { id: link.gallery.tourEventId },
    include: {
      product: { select: { nameHe: true, nameEn: true } },
      location: { select: { nameHe: true } },
      productVariant: { select: { location: { select: { nameHe: true } } } },
      bookings: {
        where: { status: 'active' },
        select: {
          status: true,
          deal: { select: { title: true, organization: { select: { name: true } } } },
        },
      },
    },
  });
  // A cancelled (or deleted) tour behaves as if the link never existed.
  if (!tour || tour.status === 'cancelled') {
    return { ok: false, status: 404, error: 'not_found' };
  }
  return {
    ok: true,
    link,
    gallery: link.gallery,
    tour,
    permissions: {
      canUpload: !!link.gallery.customerUploadEnabled,
      canDelete: false,
    },
  };
}
