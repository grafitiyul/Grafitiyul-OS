// THE cutover policy — what each legacy system is still allowed to do.
//
// Until 2026-07-31 the mirror was a full two-system reconciler: Airtable owned
// scheduling, guides and participants; Pipedrive owned the CRM; GOS received
// both and merged them. That period is over. The business decision is now:
//
//   * GOS is the canonical operational system.
//   * Airtable is no longer an operational system — read-only until retired.
//   * Pipedrive's ONLY remaining job is being a temporary ingress for leads that
//     still land there. A lead that reaches Pipedrive must reach GOS. Nothing
//     else may synchronize: no updates, no status sync, no contacts sync, no
//     organizations sync, no activities sync, no write-back.
//
// And one architectural law, which is the reason this module exists as a module
// rather than a handful of `if`s:
//
//     LEGACY SYSTEMS MAY PROPOSE, NEVER DISPOSE.
//
// A legacy system may CREATE data while it still participates in migration. It
// may never delete or invalidate canonical GOS state. The 2026-07-31 incident is
// what that law is made of: an Airtable reconciler cancelled three bookings on
// the next morning's tour because the corresponding legacy rows did not exist —
// they never had, the bookings came from the migration import. Absence of a
// legacy row is not evidence that live GOS state should die.
//
// Every permission the mirror still holds is declared HERE and nowhere else, so
// the answer to "can Pipedrive still change this?" is a lookup, not an
// archaeology exercise across four call sites.

/**
 * A capability triple. `create` is proposing; `update` and `dispose` are the two
 * ways a legacy system can reach into state GOS already owns.
 */
const NONE = Object.freeze({ create: false, update: false, dispose: false });
const PROPOSE_ONLY = Object.freeze({ create: true, update: false, dispose: false });
const FULL = Object.freeze({ create: true, update: true, dispose: true });

export const LEGACY_MODE = Object.freeze({
  CUTOVER: 'cutover',
  FULL_MIRROR: 'full_mirror',
});

/**
 * THE target architecture, as the code enforces it.
 *
 * Contacts and organizations keep `create` deliberately, and it is worth being
 * explicit about why, because "no contacts sync" could be read as forbidding it:
 * a lead is a deal AND the person it came from. A deal created without its
 * contact is an unusable lead — a name-less row nobody can call back. Creation
 * of a person/organization is the deal's own prerequisite arriving through the
 * front door, not an ongoing contact sync. Every FIELD-level contact change,
 * phone/email append included, is off.
 */
const CUTOVER_POLICY = Object.freeze({
  pipedrive: Object.freeze({
    deal: PROPOSE_ONLY,          // the temporary lead ingress — the last live legacy path
    contact: PROPOSE_ONLY,       // a lead's person, arriving with it
    organization: PROPOSE_ONLY,  // a lead's company, arriving with it
    task: NONE,                  // activities: retired
    note: NONE,                  // notes: retired (history already imported, and immutable)
    file: NONE,                  // files: retired
  }),
  airtable: Object.freeze({
    tourEvent: NONE,             // scheduling, guides, participants — all GOS-owned now
  }),
});

/** The pre-cutover behaviour, kept ONLY as a break-glass. */
const FULL_MIRROR_POLICY = Object.freeze({
  pipedrive: Object.freeze({
    deal: FULL, contact: FULL, organization: FULL, task: FULL, note: FULL, file: FULL,
  }),
  airtable: Object.freeze({ tourEvent: FULL }),
});

/**
 * Current mode. Defaults to CUTOVER — the target architecture is the default,
 * and reverting is the thing that has to be asked for explicitly.
 *
 * `LEGACY_MIRROR_MODE=full_mirror` restores the pre-cutover behaviour without a
 * deploy. It exists because switching a live integration off is exactly the kind
 * of decision that must be reversible in seconds if the business discovers a
 * dependency nobody wrote down. It is NOT a supported operating mode: if it is
 * ever set, the cutover is not finished.
 *
 * Break-glass restores the pre-cutover behaviour in full, disposal included — it
 * is a time machine, not a safer variant. What it does NOT restore is the
 * incident fix underneath it: the adapter's own `protectRemoval` guards still
 * refuse to cancel a booking that holds live seats, and the Booking CHECK
 * constraint still forbids a cancellation with no timestamp. Reverting the
 * cutover cannot revert those.
 */
export function legacyMode(env = process.env) {
  const raw = String(env.LEGACY_MIRROR_MODE || '').trim().toLowerCase();
  return raw === LEGACY_MODE.FULL_MIRROR ? LEGACY_MODE.FULL_MIRROR : LEGACY_MODE.CUTOVER;
}

/**
 * What may this (system, entity) still do?
 *
 * An UNDECLARED pair returns NONE. That default is load-bearing: a source nobody
 * wrote a policy for must not inherit permission by omission, and a typo in an
 * entity name must fail closed rather than silently reopen a retired path.
 */
export function legacyCapabilities(system, entity, env = process.env) {
  const policy = legacyMode(env) === LEGACY_MODE.FULL_MIRROR ? FULL_MIRROR_POLICY : CUTOVER_POLICY;
  return policy[system]?.[entity] || NONE;
}

/** Is this (system, entity) fully retired — no create, no update, no dispose? */
export function isRetired(system, entity, env = process.env) {
  const c = legacyCapabilities(system, entity, env);
  return !c.create && !c.update && !c.dispose;
}

/** Is EVERY entity of this system retired? (i.e. the system no longer writes at all) */
export function isSystemRetired(system, env = process.env) {
  const policy = legacyMode(env) === LEGACY_MODE.FULL_MIRROR ? FULL_MIRROR_POLICY : CUTOVER_POLICY;
  const entities = Object.keys(policy[system] || {});
  return entities.length > 0 && entities.every((e) => isRetired(system, e, env));
}

/**
 * Why an event was refused, in a form that belongs on the audit row.
 *
 * A skipped event whose reason reads `no_adapter` teaches an operator nothing
 * and looks like a bug. These codes say which architectural decision refused it,
 * so a year from now the MirrorEvent table still explains itself.
 */
export function refusalReason(system, entity, capability, env = process.env) {
  if (system === 'airtable') {
    return {
      code: 'airtable_retired',
      message:
        'Airtable is no longer an operational system (cutover 2026-07-31). It holds no scheduling, '
        + 'guide, participant or operational authority and is read-only until it is retired entirely.',
    };
  }
  if (system === 'pipedrive') {
    if (isRetired(system, entity, env)) {
      return {
        code: `pipedrive_${entity}_sync_retired`,
        message:
          `Pipedrive ${entity} synchronization is retired (cutover 2026-07-31). Pipedrive's only remaining `
          + 'responsibility is acting as a temporary ingress for NEW leads.',
      };
    }
    if (capability === 'update') {
      return {
        code: 'pipedrive_update_retired',
        message:
          'Pipedrive may only propose NEW leads (cutover 2026-07-31). GOS owns every record it already '
          + 'holds, so a change to a crosswalked record is not applied — the GOS value stands.',
      };
    }
    if (capability === 'dispose') {
      return {
        code: 'legacy_may_not_dispose',
        message:
          'Legacy systems may propose, never dispose. A deletion in Pipedrive is recorded on the '
          + 'crosswalk but never removes canonical GOS state.',
      };
    }
  }
  return {
    code: 'legacy_participation_retired',
    message: `${system}:${entity} has no remaining participation in GOS.`,
  };
}

/**
 * THE disposal law, as a function the recompute engine can hold.
 *
 * parent_recompute is the mode that can destroy state without ever being told
 * to: a member stops appearing in the source and the set diff calls it a
 * removal. That is exactly how the 2026-07-31 incident happened. So when the
 * system has no disposal authority, EVERY disappearance becomes a conflict —
 * an operator decision — regardless of what the adapter would have permitted.
 * The adapter describes the domain; it does not get to overrule architecture.
 *
 * Returns the `protectRemoval` the engine should use. When disposal IS allowed,
 * the adapter's own guard is handed back untouched.
 */
export function removalGuardFor(system, entity, adapterProtectRemoval = null, env = process.env) {
  if (legacyCapabilities(system, entity, env).dispose) return adapterProtectRemoval || null;
  return () => 'conflict';
}

/**
 * The whole policy, rendered for the operator surface and the cutover report.
 * Derived from the same tables the pipeline obeys, so a status screen can never
 * describe a permission the engine does not actually hold.
 */
export function policyStatus(env = process.env) {
  const mode = legacyMode(env);
  const policy = mode === LEGACY_MODE.FULL_MIRROR ? FULL_MIRROR_POLICY : CUTOVER_POLICY;
  return {
    mode,
    cutoverComplete: mode === LEGACY_MODE.CUTOVER,
    systems: Object.entries(policy).map(([system, entities]) => ({
      system,
      retired: isSystemRetired(system, env),
      entities: Object.entries(entities).map(([entity, caps]) => ({
        entity,
        ...caps,
        retired: !caps.create && !caps.update && !caps.dispose,
      })),
    })),
  };
}
