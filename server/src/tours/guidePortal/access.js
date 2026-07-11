import { getGallerySettings } from '../gallery/service.js';

// Server-side access + permission resolution for the Guide Portal tour
// surfaces. Same enforcement philosophy as gallery/access.js: UI hiding is
// never the gate — every /api/portal guide route resolves access HERE first.
//
// Two resolvers:
//   * resolveGuidePortalAccess  — token → PersonRef + effective permissions.
//     Used by list/nav endpoints that are not scoped to one tour.
//   * resolveGuideTourAccess    — the above PLUS a TourAssignment on THIS
//     tour. Unlike the gallery resolver, a CANCELLED tour still resolves —
//     the guide may open it read-only with a clear cancelled state (galleries
//     keep their own stricter rule).
//
// Failures return { ok: false, status, error } so routes translate 1:1 to
// HTTP. 404 (not 403) for unknown tokens — no enumeration signal.

const SETTINGS_ID = 'singleton';

export async function getGuidePortalSettings(client) {
  const existing = await client.guidePortalSettings.findUnique({
    where: { id: SETTINGS_ID },
  });
  if (existing) return existing;
  // First read seeds the defaults row (same pattern as TourGallerySettings).
  return client.guidePortalSettings.upsert({
    where: { id: SETTINGS_ID },
    update: {},
    create: { id: SETTINGS_ID },
  });
}

// The ONE permissions shape every guide surface reads. Gallery delete/share
// come from TourGallerySettings (their existing SSOT) so the two settings
// screens can't drift apart.
export function buildGuidePermissions(settings, gallerySettings) {
  return {
    viewTeam: !!settings.viewTeam,
    viewParticipantPhone: !!settings.viewParticipantPhone,
    viewParticipantEmail: !!settings.viewParticipantEmail,
    viewCustomerInfo: !!settings.viewCustomerInfo,
    viewFieldRep: !!settings.viewFieldRep,
    fillTourSummary: !!settings.fillTourSummary,
    useTourGallery: !!settings.useTourGallery,
    deleteGalleryMedia: !!gallerySettings.guideCanDelete,
    shareGalleryCustomerLink: !!gallerySettings.guideCanShareCustomerLink,
    useCoordinationForms: !!settings.useCoordinationForms,
    viewPastTours: !!settings.viewPastTours,
    viewPay: !!settings.viewPay,
    viewProcedures: !!settings.viewProcedures,
    viewTraining: !!settings.viewTraining,
    editPersonalProfile: !!settings.editPersonalProfile,
  };
}

export async function resolveGuidePortalAccess(client, { portalToken }) {
  const token = String(portalToken || '');
  if (!token) return { ok: false, status: 404, error: 'not_found' };
  const person = await client.personRef.findUnique({
    where: { portalToken: token },
  });
  if (!person) return { ok: false, status: 404, error: 'not_found' };
  if (!person.portalEnabled || person.status === 'blocked') {
    return { ok: false, status: 403, error: 'portal_disabled' };
  }
  const [settings, gallerySettings] = await Promise.all([
    getGuidePortalSettings(client),
    getGallerySettings(client),
  ]);
  return {
    ok: true,
    person,
    permissions: buildGuidePermissions(settings, gallerySettings),
  };
}

// THE access rule for every per-tour guide surface (detail, participants,
// summary, coordination, gallery): a guide reaches a tour ONLY while a
// TourAssignment row for (this tour, this person) currently exists. Removal
// hard-deletes the row (tours.js DELETE /assignments/:id), so revocation is
// immediate and absolute — there is no historical-access exception, for
// past and cancelled tours included. Both resolvers below and the gallery
// resolver share this ONE lookup.
export async function findActiveAssignment(client, person, tourEventId) {
  return client.tourAssignment.findFirst({
    where: { tourEventId, externalPersonId: person.externalPersonId },
  });
}

export async function resolveGuideTourAccess(client, { portalToken, tourEventId }) {
  const base = await resolveGuidePortalAccess(client, { portalToken });
  if (!base.ok) return base;
  const tourId = String(tourEventId || '');
  const tour = await client.tourEvent.findUnique({
    where: { id: tourId },
    select: { id: true, status: true },
  });
  if (!tour) return { ok: false, status: 404, error: 'not_found' };
  const assignment = await findActiveAssignment(client, base.person, tour.id);
  if (!assignment) return { ok: false, status: 403, error: 'not_assigned' };
  return { ...base, tour, assignment };
}
