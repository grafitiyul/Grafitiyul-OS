// THE machine-readable source ownership map.
//
// This is the executable counterpart of docs/architecture/GOS-source-ownership-map.md.
// The document is the contract humans agree on; this file is what the mirror
// actually obeys. They must be changed together — and because the mirror asks
// THIS module before touching any field, a field that is not declared here
// simply cannot be synchronized. That is the enforcement mechanism: ownership
// is a lookup, never an implicit consequence of what some adapter happened to
// map.
//
// Classes (see the map §2):
//   L  legacy-owned   — badged, still editable, 3-way merged, conflicts surfaced
//   G  GOS-owned      — the mirror never writes it
//   G! GOS-owned, legacy-seeded once — never re-written (identity columns)
//   D  derived        — computed by GOS, not a sync target
//
// The stabilization decision is that L is a BADGE, NOT A LOCK: the team keeps
// full CRM editing throughout the mirror period. Divergence is made visible;
// it is not prevented.

export const CLASS = Object.freeze({
  LEGACY: 'L',
  GOS: 'G',
  SEEDED: 'G!',
  DERIVED: 'D',
});

// Merge strategies. `three_way` is the default and the only one that can raise
// a conflict; the others exist because some fields genuinely have different
// semantics and pretending otherwise is how attribution bugs are born.
export const MERGE = Object.freeze({
  THREE_WAY: 'three_way',       // base/source/gos — the decision table in merge.js
  APPEND_ONLY: 'append_only',   // channels: add what is missing, never edit or remove
  IMMUTABLE: 'immutable',       // write-once; a different later value is a conflict
  LATEST_WINS: 'latest_wins',   // freely overwritten (latest-touch attribution)
  NEVER: 'never',               // the mirror must not write this field
});

const f = (name, cls, merge, opts = {}) => ({ name, cls, merge, ...opts });

/**
 * Field ownership per synchronized entity.
 *
 * `guard` names a runtime condition that can REVOKE legacy ownership of an
 * otherwise legacy-owned field. There is exactly one today and it is
 * load-bearing: once GOS has produced the commercial document for a deal, GOS
 * owns the money, and a stale Pipedrive value must never overwrite a signed
 * quote.
 */
export const OWNERSHIP = Object.freeze({
  deal: {
    system: 'pipedrive',
    fields: [
      f('title', CLASS.LEGACY, MERGE.THREE_WAY),
      f('status', CLASS.LEGACY, MERGE.THREE_WAY),
      f('dealStageId', CLASS.LEGACY, MERGE.THREE_WAY, { compareBy: 'stageKey' }),
      f('valueMinor', CLASS.LEGACY, MERGE.THREE_WAY, { guard: 'gosOwnsCommercials' }),
      f('currency', CLASS.LEGACY, MERGE.THREE_WAY),
      f('wonAt', CLASS.LEGACY, MERGE.THREE_WAY),
      f('lostAt', CLASS.LEGACY, MERGE.THREE_WAY),
      f('lostReason', CLASS.LEGACY, MERGE.THREE_WAY),
      f('expectedCloseDate', CLASS.LEGACY, MERGE.THREE_WAY),
      f('tourDate', CLASS.LEGACY, MERGE.THREE_WAY),
      f('tourTime', CLASS.LEGACY, MERGE.THREE_WAY),
      f('participants', CLASS.LEGACY, MERGE.THREE_WAY),
      f('dealSourceId', CLASS.LEGACY, MERGE.THREE_WAY, { postRetirement: 'ingress' }),
      f('source', CLASS.LEGACY, MERGE.THREE_WAY, { postRetirement: 'ingress' }),
      f('ownerUserId', CLASS.LEGACY, MERGE.THREE_WAY),
      // Identity — permanent, never rewritten. orderNo IS the deal's URL.
      f('orderNo', CLASS.SEEDED, MERGE.NEVER),
      // Derived by GOS from the linked organization.
      f('activityType', CLASS.DERIVED, MERGE.NEVER),
      f('organizationTypeId', CLASS.DERIVED, MERGE.NEVER),
      f('organizationSubtypeId', CLASS.DERIVED, MERGE.NEVER),
      // GOS-owned outright.
      f('lostReasonId', CLASS.GOS, MERGE.NEVER),
      f('lostNotes', CLASS.GOS, MERGE.NEVER),
      f('productId', CLASS.GOS, MERGE.NEVER),
      f('productVariantId', CLASS.GOS, MERGE.NEVER),
      f('locationId', CLASS.GOS, MERGE.NEVER),
      f('paymentTermId', CLASS.GOS, MERGE.NEVER),
      f('paymentMethodId', CLASS.GOS, MERGE.NEVER),
      f('noPaymentWaiver', CLASS.GOS, MERGE.NEVER),
      f('wonQuoteRef', CLASS.GOS, MERGE.NEVER),
      f('notes', CLASS.GOS, MERGE.NEVER),
    ],
  },

  // Notes → TimelineEntry. Imported history is IMMUTABLE: a note edited in
  // Pipedrive appends a revision rather than mutating the original, so there
  // are no mergeable fields at all. Declared so note webhooks are captured and
  // auditable rather than dropped as an unknown entity.
  note: {
    system: 'pipedrive',
    appendOnlyHistory: true,
    fields: [],
  },

  contact: {
    system: 'pipedrive',
    fields: [
      f('firstNameHe', CLASS.LEGACY, MERGE.THREE_WAY),
      f('lastNameHe', CLASS.LEGACY, MERGE.THREE_WAY),
      f('firstNameEn', CLASS.LEGACY, MERGE.THREE_WAY),
      f('lastNameEn', CLASS.LEGACY, MERGE.THREE_WAY),
      f('taxId', CLASS.LEGACY, MERGE.THREE_WAY),
      // Never reformat, never re-primary, never delete an existing channel.
      f('phones', CLASS.LEGACY, MERGE.APPEND_ONLY),
      f('emails', CLASS.LEGACY, MERGE.APPEND_ONLY),
      f('contactNo', CLASS.SEEDED, MERGE.NEVER),
      f('communicationLanguage', CLASS.GOS, MERGE.NEVER),
    ],
  },

  organization: {
    system: 'pipedrive',
    fields: [
      f('name', CLASS.LEGACY, MERGE.THREE_WAY),
      f('taxId', CLASS.LEGACY, MERGE.THREE_WAY),
      f('address', CLASS.LEGACY, MERGE.THREE_WAY),
      f('organizationTypeId', CLASS.LEGACY, MERGE.THREE_WAY),
      f('orgNo', CLASS.SEEDED, MERGE.NEVER),
    ],
  },

  task: {
    system: 'pipedrive',
    fields: [
      f('title', CLASS.LEGACY, MERGE.THREE_WAY),
      f('dueAt', CLASS.LEGACY, MERGE.THREE_WAY),
      f('status', CLASS.LEGACY, MERGE.THREE_WAY),
      f('taskTypeId', CLASS.LEGACY, MERGE.THREE_WAY),
      f('assigneeId', CLASS.LEGACY, MERGE.THREE_WAY),
    ],
  },

  dealMarketing: {
    system: 'pipedrive',
    postRetirement: 'ingress',
    fields: [
      f('leadSource', CLASS.LEGACY, MERGE.LATEST_WINS),
      f('leadSourceKey', CLASS.LEGACY, MERGE.LATEST_WINS),
      f('leadSourceText', CLASS.LEGACY, MERGE.LATEST_WINS),
      f('channel', CLASS.LEGACY, MERGE.LATEST_WINS),
      f('campaign', CLASS.LEGACY, MERGE.LATEST_WINS),
      f('medium', CLASS.LEGACY, MERGE.LATEST_WINS),
      f('content', CLASS.LEGACY, MERGE.LATEST_WINS),
      f('term', CLASS.LEGACY, MERGE.LATEST_WINS),
      f('landingUrl', CLASS.LEGACY, MERGE.LATEST_WINS),
      f('referrer', CLASS.LEGACY, MERGE.LATEST_WINS),
      f('utmSource', CLASS.LEGACY, MERGE.LATEST_WINS),
      f('utmMedium', CLASS.LEGACY, MERGE.LATEST_WINS),
      f('utmCampaign', CLASS.LEGACY, MERGE.LATEST_WINS),
      f('utmContent', CLASS.LEGACY, MERGE.LATEST_WINS),
      f('utmTerm', CLASS.LEGACY, MERGE.LATEST_WINS),
      // First touch is immutable; latest touch is not. Opposite rules on
      // purpose — conflating them rewrites acquisition history.
      f('firstTouchAt', CLASS.LEGACY, MERGE.IMMUTABLE),
      f('firstTouchSource', CLASS.LEGACY, MERGE.IMMUTABLE),
      f('firstTouchCampaign', CLASS.LEGACY, MERGE.IMMUTABLE),
      f('latestTouchAt', CLASS.LEGACY, MERGE.LATEST_WINS),
      f('latestTouchSource', CLASS.LEGACY, MERGE.LATEST_WINS),
      f('originalIngressSource', CLASS.SEEDED, MERGE.IMMUTABLE),
      f('sourceCreatedAt', CLASS.LEGACY, MERGE.IMMUTABLE),
    ],
  },

  tourEvent: {
    system: 'airtable',
    // Applies ONLY to TourEvents carrying an airtable/tour crosswalk row.
    // GOS-native tours are class G throughout and the mirror must not consider them.
    scope: 'crosswalked_only',
    fields: [
      f('date', CLASS.LEGACY, MERGE.THREE_WAY, { gate: 'parsableDate' }),
      f('startTime', CLASS.LEGACY, MERGE.THREE_WAY),
      f('status', CLASS.LEGACY, MERGE.THREE_WAY, { gate: 'neverUncancel' }),
      f('cancelledAt', CLASS.LEGACY, MERGE.THREE_WAY, { gate: 'neverUncancel' }),
      f('locationId', CLASS.LEGACY, MERGE.THREE_WAY),
      f('tourLanguage', CLASS.LEGACY, MERGE.THREE_WAY),
      f('capacity', CLASS.LEGACY, MERGE.THREE_WAY),
      f('notes', CLASS.LEGACY, MERGE.THREE_WAY),
      // completedReason='migration' is what suppresses payroll on imported
      // tours. The mirror must never touch it.
      f('completedAt', CLASS.GOS, MERGE.NEVER),
      f('completedReason', CLASS.GOS, MERGE.NEVER),
      f('openTourTemplateId', CLASS.GOS, MERGE.NEVER),
      f('generatedByRuleId', CLASS.GOS, MERGE.NEVER),
      f('productId', CLASS.DERIVED, MERGE.NEVER),
      f('productVariantId', CLASS.DERIVED, MERGE.NEVER),
    ],
    // Every gcal*/woo* column is GOS-owned. Listed as a prefix rule so a new
    // sync column added later is protected by default rather than by memory.
    gosOwnedPrefixes: ['gcal', 'woo'],
  },
});

const _index = new Map();
for (const [entity, spec] of Object.entries(OWNERSHIP)) {
  _index.set(entity, new Map(spec.fields.map((x) => [x.name, x])));
}

/**
 * The single question the mirror asks before writing anything.
 * An UNDECLARED field is never writable — silence means "not synchronized",
 * not "probably fine".
 */
export function fieldOwnership(entity, field) {
  const spec = OWNERSHIP[entity];
  if (!spec) return null;
  const found = _index.get(entity).get(field);
  if (found) return found;
  for (const prefix of spec.gosOwnedPrefixes || []) {
    if (field.startsWith(prefix)) return f(field, CLASS.GOS, MERGE.NEVER, { byPrefix: prefix });
  }
  return null;
}

export function isMirrorWritable(entity, field) {
  const o = fieldOwnership(entity, field);
  return !!o && o.cls === CLASS.LEGACY && o.merge !== MERGE.NEVER;
}

/** Every field the mirror is allowed to write for an entity. */
export function writableFields(entity) {
  return (OWNERSHIP[entity]?.fields || [])
    .filter((x) => x.cls === CLASS.LEGACY && x.merge !== MERGE.NEVER)
    .map((x) => x.name);
}

/** Which legacy system owns this entity today. */
export function owningSystem(entity) {
  return OWNERSHIP[entity]?.system || null;
}

/**
 * Who owns the field once its legacy source is retired. Defaults to GOS —
 * marketing is the deliberate exception, where the ingress platform takes over
 * as the writer and the UI does not change.
 */
export function postRetirementOwner(entity, field) {
  const o = fieldOwnership(entity, field);
  return o?.postRetirement || OWNERSHIP[entity]?.postRetirement || 'gos';
}
