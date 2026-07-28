// THE server-side Guide Portal URL builders.
//
// The token and its resolver were already canonical (people/createStaff.js
// newPortalToken, guidePortal/access.js resolveGuidePortalAccess) but the URL
// string was hand-assembled in client files only. Server-sent messages need it
// too, so the shape lives here once. Route shapes match the client router:
//   /p/:token                    portal home
//   /p/:token/tour/:tourEventId  one tour
//
// portalEnabled is respected: a revoked guide gets NO link rather than a link
// that will 403 when tapped.

import { publicOrigin } from '../../communication/context.js';

const encode = (v) => encodeURIComponent(String(v));

/** Portal home for a PersonRef, or null when there is no usable link. */
export function guidePortalUrl(person, origin = publicOrigin()) {
  if (!origin || !person?.portalToken || person.portalEnabled === false) return null;
  return `${origin}/p/${encode(person.portalToken)}`;
}

/** Deep link to one tour inside the guide's portal. */
export function guideTourUrl(person, tourEventId, origin = publicOrigin()) {
  const base = guidePortalUrl(person, origin);
  if (!base || !tourEventId) return null;
  return `${base}/tour/${encode(tourEventId)}`;
}

/** Prisma select fragment carrying everything a link needs. */
export const PORTAL_LINK_SELECT = { portalToken: true, portalEnabled: true };
