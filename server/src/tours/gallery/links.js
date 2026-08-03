// Guide-scoped gallery upload links — THE one generator for the direct
// photo-upload URL a guide receives in the tour-summary reminders (#14-#16)
// and the office reuses on the Tour Summary review card.
//
// Same capability model as the customer gallery link (one TourGalleryLink
// table, one token convention, one /g/:token page), scoped one step tighter:
// a staff link belongs to ONE guide (personRefId) on ONE tour's gallery, and
// resolution re-checks the assignment every time — an unassigned or blocked
// guide's link dies without anything being deleted.
//
// Idempotent by business identity (gallery + guide): the first reminder mints
// the link, every later reminder and every review-card read REUSES it, so the
// URL in an already-sent WhatsApp message keeps working. Tour cancellation
// revokes it together with every other gallery link (scheduleGalleryCleanup);
// customer-link rotation deliberately does NOT touch it.
//
// Lives in its own module (not service.js) because it needs
// guidePortal/access.js — which itself imports service.js.

import { ensureGallery, newGalleryToken } from './service.js';
import { getGuidePortalSettings } from '../guidePortal/access.js';
import { publicOrigin } from '../../communication/context.js';

/** Get-or-create the ONE staff link for this guide on this tour's gallery. */
export async function ensureGuideGalleryLink(client, { tourEventId, personRefId }) {
  if (!tourEventId || !personRefId) return null;
  // Never re-arm a capability on a cancelled tour — cancellation revoked every
  // gallery link on purpose, and a reminder retry must not resurrect one.
  const tour = await client.tourEvent.findUnique({
    where: { id: String(tourEventId) },
    select: { id: true, status: true },
  });
  if (!tour || tour.status === 'cancelled') return null;
  const gallery = await ensureGallery(client, tour.id);
  const existing = await client.tourGalleryLink.findFirst({
    where: { galleryId: gallery.id, audience: 'staff', personRefId, status: 'active' },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) return existing;
  return client.tourGalleryLink.create({
    data: { galleryId: gallery.id, audience: 'staff', personRefId, token: newGalleryToken() },
  });
}

/**
 * Mint + format in one call — what the reminder sweep and the review-items
 * read use. Returns the direct /g/<token> upload URL, or null when no link
 * should exist: gallery switched off for guides, no PersonRef, cancelled tour,
 * or any failure. Never throws into a notification — a missing link makes the
 * message omit its photo section, not fail.
 */
export async function guideGalleryUploadUrl(client, { tourEventId, personRefId }, { log = console } = {}) {
  try {
    const origin = publicOrigin();
    if (!origin || !personRefId) return null;
    const portalSettings = await getGuidePortalSettings(client);
    if (!portalSettings.useTourGallery) return null;
    const link = await ensureGuideGalleryLink(client, { tourEventId, personRefId });
    return link ? `${origin}/g/${encodeURIComponent(link.token)}` : null;
  } catch (err) {
    log.warn?.(`[gallery-guide-link] could not build link: ${err?.message || err}`);
    return null;
  }
}
