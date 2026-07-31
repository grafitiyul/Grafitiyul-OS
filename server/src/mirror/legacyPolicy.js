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
 *
 * There is deliberately NO triple with `dispose: true`. Disposal is not a
 * permission this file is able to grant — see `legacyCapabilities`.
 */
const NONE = Object.freeze({ create: false, update: false, dispose: false });
const PROPOSE_ONLY = Object.freeze({ create: true, update: false, dispose: false });
const PROPOSE_AND_UPDATE = Object.freeze({ create: true, update: true, dispose: false });

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

/**
 * The break-glass. Restores CAPTURE and UPDATE — and nothing else.
 *
 * It used to restore disposal too, on the theory that a break-glass should be a
 * faithful time machine. That was wrong, and the way it was wrong is worth
 * recording: once Airtable is emptied out (which is the whole point of retiring
 * it), a reconciler running in this mode would see every child row missing and
 * read that as "delete them all". Payroll rows and bookings-with-seats have
 * their own adapter guards, but tour ASSIGNMENTS do not — so pulling the
 * break-glass after the Airtable cleanup would have silently unassigned guides
 * from every tour.
 *
 * Owner ruling, 2026-07-31: "legacy may propose, never dispose" is a permanent
 * architectural rule, not a cutover rule. Break-glass may restore capture or
 * update. It may never restore the authority to destroy canonical GOS state.
 */
const FULL_MIRROR_POLICY = Object.freeze({
  pipedrive: Object.freeze({
    deal: PROPOSE_AND_UPDATE, contact: PROPOSE_AND_UPDATE, organization: PROPOSE_AND_UPDATE,
    task: PROPOSE_AND_UPDATE, note: PROPOSE_AND_UPDATE, file: PROPOSE_AND_UPDATE,
  }),
  airtable: Object.freeze({ tourEvent: PROPOSE_AND_UPDATE }),
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
 * Break-glass restores CAPTURE and UPDATE. It does NOT restore disposal, in any
 * mode, ever — see `legacyCapabilities`. Nor does it revert the incident fix
 * underneath it: the adapter's own `protectRemoval` guards still refuse to
 * cancel a booking that holds live seats, and the Booking CHECK constraint
 * still forbids a cancellation with no timestamp.
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
  const declared = policy[system]?.[entity] || NONE;

  // THE PERMANENT INVARIANT (owner ruling, 2026-07-31).
  //
  // No legacy system may destroy canonical GOS state, in ANY operating mode,
  // ever. Clamping it here rather than trusting the tables above is the whole
  // point: the tables are data, and data gets edited by someone in a hurry two
  // years from now who only means to re-enable one thing. This makes disposal
  // un-grantable rather than merely un-granted — there is no value anyone can
  // write in this file, or any env var they can set, that produces
  // `dispose: true` at a call site.
  //
  // The `dispose` key is kept rather than deleted so every consumer still reads
  // an explicit false, and so the day a legitimate disposal case appears it has
  // to be argued for here, in the open, instead of appearing by omission.
  return declared.dispose ? Object.freeze({ ...declared, dispose: false }) : declared;
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
