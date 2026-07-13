import crypto from 'node:crypto';
import {
  personChangeSnapshot,
  diffPersonFields,
  normalizeBankDetails,
} from '../timeline/personChangelog.js';

// Manual ("+ איש צוות חדש") staff creation — the office adds a staff member
// directly in GOS, for people who did NOT come from recruitment.
//
// One identity model only: this produces a plain PersonRef + PersonProfile,
// exactly like the recruitment ingest (staffEvents.js) does, with two
// deliberate differences:
//   * identitySource = 'management'  → GOS OWNS name/email/phone. The upstream
//     recruitment pull already skips 'management' rows (people.js), so a
//     manually-created person's identity can never be overwritten by a sync.
//   * externalPersonId = 'manual:<uuid>' → a stable, unique handle that is NOT
//     a recruitment id. It survives everywhere the stable handle is used
//     (payroll, tour assignments) and is intentionally not evaluator-eligible
//     (that gate keys on 'guide:'/'candidate:' prefixes).
//
// The three requested statuses map onto the existing two axes (lifecycleHint +
// status), so no schema changes and no new "type" column:
//   active   → lifecycleHint 'staff',   status 'active'
//   trainee  → lifecycleHint 'trainee', status 'active'
//   inactive → lifecycleHint  null,     status 'blocked'  (excluded from the
//              Tour-assignment picker by the canonical eligibility rule)
//
// Portal eligibility ("does the role support the portal?") maps onto the
// existing portalEnabled switch. A portalToken is ALWAYS minted (the column is
// required + unique), but access is only OPEN when the role is portal-eligible
// AND the person is active — the same mechanism the admin toggles later.

export const NEW_STAFF_STATUSES = ['active', 'trainee', 'inactive'];

export const NEW_STAFF_STATUS_LABELS_HE = {
  active: 'פעיל',
  trainee: 'מתלמד',
  inactive: 'לא פעיל',
};

// status → lifecycleHint. 'inactive' carries no working lifecycle (null) and is
// held out of assignment by status='blocked'.
function lifecycleForStatus(status) {
  if (status === 'trainee') return 'trainee';
  if (status === 'inactive') return null;
  return 'staff'; // active
}

export function newPortalToken() {
  // 24 bytes → 32-char URL-safe token — same shape people.js/staffEvents.js use.
  return crypto.randomBytes(24).toString('base64url');
}

export function newManualExternalId() {
  return `manual:${crypto.randomUUID()}`;
}

function normEmail(v) {
  return String(v || '').trim().toLowerCase();
}
function normPhone(v) {
  return String(v || '').replace(/\D/g, '');
}

// PURE: validate the modal payload and build the exact prisma.create() data,
// or return an { error }. Injectable ids/token keep it fully unit-testable.
export function buildManualStaffCreate(input, opts = {}) {
  const displayName = String(input?.displayName || '').trim();
  if (!displayName) return { error: 'displayName_required' };

  const status = String(input?.status || '').trim();
  if (!NEW_STAFF_STATUSES.includes(status)) {
    return { error: 'invalid_status', allowed: NEW_STAFF_STATUSES };
  }

  const active = status !== 'inactive';
  // Default portal-eligible unless the caller explicitly opts out; an inactive
  // person never keeps open access regardless.
  const portalEligible = input?.portalEligible !== false;
  const portalEnabled = active && portalEligible;

  const now = opts.now instanceof Date ? opts.now : new Date();

  const data = {
    externalPersonId: opts.externalPersonId || newManualExternalId(),
    identitySource: 'management',
    displayName,
    email: input?.email ? String(input.email).trim() : null,
    phone: input?.phone ? String(input.phone).trim() : null,
    status: active ? 'active' : 'blocked',
    lifecycleHint: lifecycleForStatus(status),
    portalToken: opts.portalToken || newPortalToken(),
    portalEnabled,
    accessGrantedAt: portalEnabled ? now : null,
    accessRevokedAt: portalEnabled ? null : now,
    identitySyncedAt: now,
    ...(input?.teamRefId ? { teamRefId: String(input.teamRefId) } : {}),
    profile: {
      create: {
        notes: input?.notes ? String(input.notes).trim() : null,
        // Every bank write funnels through the ONE structured normalizer.
        bankDetails: normalizeBankDetails(input?.bankDetails),
      },
    },
  };

  return { data, summary: { status, portalEnabled } };
}

// PURE: given the current roster (rows with id/displayName/email/phone), find a
// person whose email or phone already matches — normalized so formatting /
// casing differences still collide. Returns { person, matchedOn } or null.
export function findDuplicatePerson(people, { email, phone } = {}) {
  const e = normEmail(email);
  const p = normPhone(phone);
  for (const person of people || []) {
    const matchedOn = [];
    if (e && normEmail(person.email) === e) matchedOn.push('email');
    if (p && normPhone(person.phone) === p) matchedOn.push('phone');
    if (matchedOn.length) return { person, matchedOn };
  }
  return null;
}

// PURE: the creation audit — a `data.changes` array carrying the initial
// identity/profile values plus explicit status + portal-access rows, so the
// person's immutable history opens with WHAT they were created as (WHO + WHEN +
// source='admin' are added by the caller via emitTimelineEvent origin).
export function buildManualStaffAudit(person, profile, summary) {
  const before = personChangeSnapshot(null, null);
  const after = personChangeSnapshot(person, profile);
  const changes = diffPersonFields(before, after);
  changes.push({
    fieldKey: 'lifecycleStatus',
    labelHe: 'סטטוס',
    oldValue: null,
    newValue: summary?.status ?? null,
    oldDisplay: '—',
    newDisplay: NEW_STAFF_STATUS_LABELS_HE[summary?.status] || summary?.status || null,
  });
  changes.push({
    fieldKey: 'portalAccess',
    labelHe: 'גישה לפורטל',
    oldValue: null,
    newValue: !!summary?.portalEnabled,
    oldDisplay: '—',
    newDisplay: summary?.portalEnabled ? 'יש גישה' : 'אין גישה',
  });
  return changes;
}
