# GOS Cutover — Final Pass (2026-07-31)

The migration runbooks in this folder describe how data got from Airtable and
Pipedrive into GOS. This document describes the moment GOS stopped *receiving*
from them and started simply *being* the system.

It is the authoritative statement of what each legacy system is still allowed to
do. Where it disagrees with an older document in this folder, this one wins.

---

## 1. The business decision

- GOS is the canonical operational system.
- **Airtable** is no longer an operational system. No scheduling, no guide
  management, no participant management, no operational updates. Read-only until
  it can be retired entirely.
- **Pipedrive** has exactly one remaining responsibility: acting as a temporary
  ingress for leads that still arrive there. If a lead reaches Pipedrive but not
  GOS, it should reach GOS. Nothing else synchronizes.

## 2. The architectural principle

> **Legacy systems may propose, never dispose.**

A legacy system may create or update data while it still participates in
migration. It must never have authority to delete or invalidate canonical GOS
state.

This is a **permanent architectural rule, not a cutover setting** (owner ruling,
2026-07-31). It holds in every operating mode, including the break-glass, and it
is enforced structurally rather than by convention: `legacyCapabilities` clamps
`dispose` to `false` on the way out, so there is no value anyone can write in the
policy tables — and no environment variable anyone can set — that reaches a call
site as `dispose: true`. Disposal is *un-grantable*, not merely un-granted.

The concrete trap this closed: the break-glass originally restored disposal too,
on the theory that it should be a faithful time machine. But once Airtable is
emptied — which is the point of retiring it — a reconciler in that mode would
see every child row missing and read it as "delete them all". Payroll rows and
bookings-with-seats have adapter guards; tour **assignments do not**. Pulling the
break-glass after the Airtable cleanup would have silently unassigned guides from
every tour.

One consequence, recorded because it reverses an earlier decision: the Pipedrive
note adapter's `applySourceDeleted` — which hard-deleted a crosswalked
`TimelineEntry` when a note was deleted in Pipedrive (ruling of 2026-07-31,
morning) — has been **removed**, not just gated. Unreachable destructive code is
a trap waiting for someone to relax the clamp "because nothing uses it". The
pipeline hook remains, so a legitimate disposal case can still be argued for and
implemented in the open. A Pipedrive deletion is still recorded on the crosswalk;
only the destruction is gone.

## 3. Where the answer lives

`server/src/mirror/legacyPolicy.js`.

One module answers "may this legacy system still do this?" as a
`(create, update, dispose)` triple per `system` + `entity`. The poller, the retry
worker, the webhook route, the replay endpoint, the recompute engine and the
admin status screen all ask it. None of them decides for itself.

| system | entity | create | update | dispose | meaning |
|---|---|---|---|---|---|
| airtable | tourEvent | ✗ | ✗ | ✗ | retired — covers the master tours table and the coordination + payroll child tables, which all mirror into `tourEvent` |
| pipedrive | deal | **✓** | ✗ | ✗ | **the temporary lead ingress** |
| pipedrive | contact | **✓** | ✗ | ✗ | a lead's person, arriving with it |
| pipedrive | organization | **✓** | ✗ | ✗ | a lead's company, arriving with it |
| pipedrive | task | ✗ | ✗ | ✗ | activities retired |
| pipedrive | note | ✗ | ✗ | ✗ | notes retired |
| pipedrive | file | ✗ | ✗ | ✗ | files retired |

**Why contacts and organizations keep `create`.** "No contacts sync" could be
read as forbidding it. A lead, though, is a deal *and the person it came from* —
a deal created without its contact is a name-less row nobody can call back.
Creating a person or an organization here is the deal's own prerequisite
arriving through the front door, not an ongoing contact sync. Every field-level
change to an existing contact is off, including the append-only phone/email
reconciliation.

**An undeclared source gets nothing.** Omission never grants authority, and a
typo in an entity name fails closed rather than silently reopening a retired
path.

## 4. How it is enforced

Defence in depth, because a single check is a single thing to forget:

1. **No poller is built.** `buildPollTargets` produces zero Airtable targets and
   no Pipedrive files target. They cannot run, cannot fail, cannot spend quota.
2. **The retry worker settles retired events before any adapter exists.** This
   also keeps a retired `parent_recompute` event away from the coalescer, which
   is the only place that recomputes.
3. **`processEvent` refuses terminally, by name**, whatever route the event
   arrived by — webhook, poll, retry or admin replay.
4. **The cutover gate sits *before* the apply gate.** The apply gate *buffers*,
   so a paused mirror loses nothing. Buffering a change we have decided never to
   apply would grow a queue that will never be drained while the mirror reported
   itself healthy.
5. **The disposal law lives in the engine, above the adapter.** When a system has
   no disposal authority, a member vanishing from the source can only become an
   operator conflict. The adapter describes the domain; it does not overrule
   architecture.
6. **`applySourceDeleted` runs only with disposal authority.** A deletion in
   Pipedrive is recorded on the crosswalk and destroys nothing.

Refusals carry a named reason on the `MirrorEvent` row — `airtable_retired`,
`pipedrive_update_retired`, `pipedrive_note_sync_retired`,
`legacy_may_not_dispose` — so the audit spine still explains itself in a year.

## 5. The break-glass

`LEGACY_MIRROR_MODE=full_mirror` restores the pre-cutover behaviour in seconds,
without a deploy.

It is **not a supported operating mode**. If it is set, the cutover is not
finished. It exists because switching a live integration off is exactly the kind
of decision that must be reversible if the business discovers a dependency
nobody wrote down.

It restores **capture and update, and only those**. It does not restore disposal
— see §2; that is permanent and un-grantable. Nor does it revive the incident
fix underneath it: the booking `protectRemoval` guards and the
`Booking_cancelled_requires_timestamp` CHECK constraint hold in either mode.

This means the break-glass is safe to pull **even after Airtable has been
emptied**, which is the whole reason the invariant was made permanent rather
than left as a cutover setting.

## 6. The incident this pass was built around

On 2026-07-31 a reconciliation pass cancelled GOS Bookings whose Airtable rows
did not exist. They never had — those bookings came from the legacy migration
import, which has no Airtable counterpart by construction.

Measured in production the same afternoon: **3 bookings, all on the next
morning's tour (2026-08-01 10:00), 8 confirmed seats, deals #26047, #26283,
#26335 — every one of them WON.** The seats never moved (`TicketRegistration` is
the seat SSOT and was untouched), but the tour screen renders customer cards off
`Booking.status`, so the participants vanished from the tour a guide was about
to run.

Four guards now stand between that and a repeat:

- `protectRemoval` turns a booking that still owns capacity-holding
  registrations into an operator conflict — not deleted, and not silently
  retained either;
- the reconciler's cancel path writes `cancelledAt`, and a **DB CHECK
  constraint** forbids `status='cancelled'` without it for every writer, present
  and future — that missing timestamp is what made a machine-written
  cancellation indistinguishable from a real one;
- the migration **repairs before it constrains**, in one step (the constraint is
  validated, so a row created in the gap would wedge the service at boot);
- a בקרה detector, `booking_cancelled_with_live_seats`, is the backstop. It does
  not care *who* produced the state, only that it exists, so a future writer
  inventing a new way in is surfaced within one sweep instead of being noticed by
  a guide standing in front of a group GOS believes is not coming.

## 7. Operator surface

`GET /api/mirror-admin/status` reports the live policy, derived from the same
module the pipeline obeys — a status screen must not be able to describe a
permission the engine does not hold. Its `enabled` flag now reads the canonical
phase flags; it used to read `MIRROR_ENABLED`, which nobody sets any more, so a
fully live mirror reported itself as disabled.

A retired cursor is reported as **finished, not stale**. The four Airtable
cursors are deliberately kept — they are the evidence of where the mirror got to
— but judging them against liveness rules forever is how a health screen trains
everyone to ignore it.

## 8. What is still connected

**Live:**

- Pipedrive → GOS, **creation only**, for deals/persons/organizations. The
  temporary lead ingress. Retire it by cutting each source over in
  `sourceRegistry.js` (`SOURCE_WRITER_*=direct`) so leads arrive at GOS ingress
  directly; when the last one is `direct`, this path has no traffic left and the
  Pipedrive webhook subscription can be deleted.
- GOS → WooCommerce, GOS → Google Calendar. Not legacy — these are GOS pushing
  outward as the system of record.

**Retired:** every Airtable path; Pipedrive updates, status sync, contacts sync,
organizations sync, activities sync, notes sync, files sync. There has never
been any write-back to either system — the mirror holds no code that could.

## 9. Temporary compatibility layers still in the tree

| Thing | Why it is still there | Remove when |
|---|---|---|
| Pipedrive lead ingress (create-only) | leads still arrive there | all four sources are `direct` in `sourceRegistry.js` |
| `LEGACY_MIRROR_MODE` break-glass | reversibility during the first weeks | the business confirms nothing was missed |
| Airtable adapters + poll sources | needed by the break-glass; unreachable otherwise | the break-glass goes |
| `airtableCursorTargets` + `seed-cursors.mjs` | pins the cursor-id contract the break-glass would need | the break-glass goes |
| Airtable credentials in Railway | still used by migration scripts | Airtable is retired outright |
| `MIRROR_FILES_POLL_ENABLED` | predates the policy; kept so two switches cannot disagree | files stay retired |
| four frozen Airtable `MirrorCursor` rows | evidence of where the mirror stopped | never urgent |
| legacy `MIRROR_ENABLED` flag in `config.js` | protects a deployment that still sets it | confirmed unset everywhere |

## 10. Open items that are NOT part of this cutover

- **`WOO_SYNC_BULK_ENABLED`** — RESOLVED 2026-07-31: `true` is now the normal
  permanent operating mode. The website must always be an exact reflection of the
  Open Tours in GOS. Checklist §0.2 has been withdrawn; its rationale did not
  match the code (the no-sellable-cards check precedes the first-publication
  gate, so a template-less imported tour can never publish under any flag value).
- **WhatsApp number migration** — tracked in
  `GOS-whatsapp-number-migration-audit.md` §1, triggered by a QR scan.
- **The Pipedrive files backfill** (`import-files.mjs`) is a migration job, not
  an operational sync. Unaffected by the policy, which governs the mirror.
