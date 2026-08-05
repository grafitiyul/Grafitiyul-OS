// Who are "the tour's guides"? — the ONE resolver.
//
// The lead/guide split was previously an inlined `rows.find(a => a.role ===
// 'lead_guide')` copy-pasted across routes. The notification rule the owner
// specified ("primary guide; if none, the assigned guide; if several, all of
// them") needs it in one place, so it lives here and the notifications and any
// future consumer share it.
//
// Names always go through the canonical resolveStaffDisplayName — an
// assignment's raw displayName may hold a migrated Airtable record id.

import { resolveStaffDisplayName } from '../../../shared/staffAssignmentDisplay.mjs';

/** Roles that make someone a guide of the tour (assistants are not). */
export const GUIDE_ROLES = ['lead_guide', 'guide'];

/**
 * The guides a tour notification addresses:
 *   • the lead guide(s) when any exist,
 *   • otherwise every assigned guide,
 *   • empty when nobody is assigned.
 * Assignment order is preserved so the message reads in staffing order.
 */
export function notifiableGuides(assignments = []) {
  const relevant = (assignments || []).filter((a) => a && GUIDE_ROLES.includes(a.role));
  const leads = relevant.filter((a) => a.role === 'lead_guide');
  return leads.length ? leads : relevant;
}

/** First name only — the notifications greet the guide by first name. */
export function guideFirstName(assignment) {
  const full = resolveStaffDisplayName(assignment) || '';
  return full.split(/\s+/)[0] || full || null;
}

/** Full display name through the canonical resolver. */
export function guideFullName(assignment) {
  return resolveStaffDisplayName(assignment) || null;
}

/**
 * The guide language of a WHOLE tour, for one shared (group-destination)
 * message that cannot be split per person: 'en' only when EVERY notifiable
 * guide prefers English in their canonical staff profile; 'he' when any
 * prefers Hebrew or has no language set; null when nobody is assigned
 * (callers fall back to Hebrew).
 */
export function guidesPreferredLanguage(assignments = []) {
  const guides = notifiableGuides(assignments);
  if (!guides.length) return null;
  return guides.every((a) => a.personRef?.profile?.preferredLanguage === 'en') ? 'en' : 'he';
}

/** Prisma select fragment for assignments used by notifications. */
export const GUIDE_ASSIGNMENT_SELECT = {
  role: true,
  displayName: true,
  externalPersonId: true,
  personRef: {
    select: {
      id: true, displayName: true, phone: true, portalToken: true, portalEnabled: true,
      // GOS-owned name + language. Carried on every guide read so a report or a
      // form can address this person correctly without a second query.
      profile: {
        select: {
          firstNameHe: true, lastNameHe: true,
          firstNameEn: true, lastNameEn: true,
          preferredLanguage: true,
        },
      },
    },
  },
};
