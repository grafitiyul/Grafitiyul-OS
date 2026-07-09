# GOS Tours Module — Architecture (Locked Decisions + Technical Design)

Status: **DECISIONS LOCKED (product) — implementation not started.**
Updated: 2026-07-09. Supersedes the first audit draft of the same date.

Process rule (locked): product/business-model decisions come from the owner.
Engineering audits the current implementation, states architectural implications,
and recommends technical approaches — it does not decide product behavior. When a
product decision surfaces mid-implementation: stop and ask.

---

## 1) Locked product decisions

These are requirements, not open questions:

1. **Deal = commercial relationship. Tour = operational execution.** Separate entities.
2. **Booking is the ONLY relationship layer.** No `tourId` on Deal, no `dealId` on
   Tour — ever. (Matches the prior phase0 design: GOS-phase0-schema-design.md §6.)
3. **Private/business tours are created from the Deal at the FIRST WON transition.**
   No separate scheduling workflow beforehand.
4. **Group tours are scheduled Tour Slots**, created ahead of time, existing long
   before (and possibly without) any deal. Customers attach later via Bookings.
   At WON, the operator picks the target slot.
5. **No draft tours.** If mandatory information is missing, the deal is not ready to
   become a tour and WON is refused. The Deal is the planning workspace; a Tour
   exists only once it is a real operational tour.
6. **The Deal remains the operational planning source after WON.** The Tour is the
   execution layer. Do NOT assume Tour ownership of planning fields. The precise
   field-ownership matrix will be defined by the owner before implementation.
7. **Existing `Tour` content models stay untouched.** No rename migration. The new
   operational model uses a different name.
8. **WON mandatory-field list is NOT hardcoded.** The validation framework takes an
   explicit required-field list (defined by the owner before implementation), rather
   than embedding assumptions.
9. **Slot join sync:** when a group deal is WON into a slot whose date/time differ
   from the deal's planned `tourDate`/`tourTime`, the slot **overwrites** the deal's
   planning fields, with a changelog entry. No mismatch can exist.
10. **Reopen/LOST with a live tour: operator chooses.** Never auto-cancel. Dialog:
    "Remove this deal from the tour" or "Keep the tour". Keeping it creates an
    intentional **orphan** tour/booking. A **global, always-visible header warning**
    surfaces existing orphans; from it the operator can **reconnect** the tour to a
    deal or **cancel/delete** the orphan. Goal: never silently lose operational
    work, never hide orphans.
11. **Group slots are created in the new Tours screen AND inline from the WON
    slot-picker.** Slot-creation required fields follow the same explicit-list
    framework as decision 8.

Open items the owner will specify before implementation:
- **(A)** the exact mandatory-field list for private/business WON (and for group WON);
- **(B)** the exact mandatory-field list for creating a group slot;
- **(C)** the precise field-ownership matrix Deal↔Tour (per decision 6).

---

## 2) Audit summary (what exists today)

- **WON:** `Deal.status` (`open|won|lost`), not a stage. Single transition path:
  `PUT /api/deals/:id` (server/src/routes/deals.js:259-414) with a first-transition
  guard (`existing.status !== 'won'`, line ~345) that already stamps `wonAt` +
  `wonQuoteRef` + timeline events. **No validation at WON today** — everything
  operational is nullable. The WON branch is not yet a transaction.
- **Deal planning fields already exist:** `activityType` (group|private|business,
  nullable today), `productId`, `productVariantId`, `locationId`, `tourDate`,
  `tourTime`, `participants`, `tourLanguage`, `customerInfo`.
- **`Tour`/`TourStation`/`TourStep`/`TourContentBlock`… (schema:2641-2746)** are the
  tour CONTENT/training system (recruitment export via sourceRef). Untouched per
  decision 7.
- **Staff:** `PersonRef` (+`portalToken`, lifecycle trainee/staff/former, GOS-owned)
  + `PersonProfile` (incl. `bankDetails`) + `TeamRef`. **No role model** (guide/
  assistant/lead) exists anywhere.
- **Guide Portal:** token-gated `/p/:token`, bucketed task feed, only `procedure`
  tasks; `'tour'` task type already stubbed (client/src/portal/GuidePortal.jsx:15-21).
- **Catalog:** `Product`, `ProductVariant` (product×location; `durationHours`,
  meeting/ending points, `baseGuidePaymentMinor`, `travelPaymentMinor`, per-format
  availability), `Location`.
- **Customer:** `Organization`/`OrganizationUnit`/`Contact`/`DealContact` (roles
  include `fieldRep`; per-deal comms flags).
- **Numbering: DONE** (commit 9db45f8): `Deal.orderNo Int @unique` backed by
  Postgres sequence `deal_order_no_seq` starting 27000; shown in the Deal header and
  used as the Deal URL via a `router.param('id')` resolver (deals.js:148-159) that
  accepts EITHER cuid or number — old cuid links keep working. cuid stays the
  internal PK/FK. Client uses a `dealPath` helper. `orderNo` is never sent to
  external providers.
- **Timeline:** `TimelineEntry` uses `subjectType`/`subjectId` — verify genericity
  for `subjectType='tour'` at implementation time (built for deals).

## 3) New operational models (technical recommendation)

Naming: the operational instance model is **`TourEvent`** (avoids the content-model
collision without any rename; UI label stays "סיור"). Join = **`Booking`**,
assignments = **`TourAssignment`** (names free — no collisions).

### TourEvent
- `id` cuid; `kind` string enum `private | business | group_slot` (string-enum-at-API
  per project convention).
- Scheduling: `date`, `startTime`, `durationHours?`, timezone-explicit storage
  (UTC + `timeZone`, default Asia/Jerusalem) so a future calendar isn't precluded.
- Catalog anchors: `productId`, `productVariantId`, `locationId` FKs (SetNull) —
  carried on the TourEvent itself because a group slot exists with zero deals.
- `tourLanguage`, `capacity?` (group slots), `status` string enum
  (`scheduled | confirmed | in_progress | completed | cancelled` — **no draft**,
  per decision 5), `notes` (operational), timestamps.
- NO commercial fields, NO dealId, NO customer copies.
- Occupancy is always **derived**: `SUM(booking.seats WHERE status != 'cancelled')`
  via one shared server-side helper; never stored.

### Booking
- `tourEventId` FK, `dealId` FK, `seats Int`, `status` string enum
  (`active | cancelled | orphaned`), `orphanedAt?`/`orphanReason?` (decision 10),
  optional per-pair operational note; timestamps.
- Partial unique: one non-cancelled Booking per (deal, tourEvent).
- `orphaned` = intentionally disconnected from its deal's commercial outcome
  (deal reopened/lost but tour kept). An orphaned Booking retains `dealId` for
  history/reconnect but is excluded from "this deal's live tour" reads.

### TourAssignment (Phase 3)
- `tourEventId` FK; `personRefId` FK **+ `externalPersonId` snapshot** (the
  codebase's stable person handle — same pattern as `Attempt.externalPersonId`).
- `role` string enum on the assignment (`lead_guide | guide | workshop_assistant`,
  extensible) — a role is per-tour, not per-person.
- `status` (`proposed | confirmed | declined | cancelled`); pay columns designed in
  now, nullable, unused until the pay phase (defaults source:
  `ProductVariant.baseGuidePaymentMinor` / `travelPaymentMinor`).
- Unique: one active assignment per (tourEvent, person). Role changes update the row
  + timeline entry. Double-booking (overlap) = application-level warning.

## 4) WON flow integration

All inside the existing first-transition guard (deals.js ~345), the entire first-WON
branch wrapped in one `prisma.$transaction`:

1. **Gate (decision 5+8):** validate against the explicit required-field list for the
   deal's `activityType` (list = open item A; stored as a declarative config the
   server reads — not inline conditionals). Failure → 422 with a machine-readable
   missing-field list; the client renders the same list as a pre-WON checklist so the
   422 is a safety net, not the UX. `activityType` itself becomes required at WON.
2. **Private/business:** create `TourEvent(kind=activityType)` seeded from the deal's
   planning fields + one `Booking(seats=participants)`.
3. **Group:** operator picks a `group_slot` TourEvent in the WON dialog (with derived
   occupancy + capacity warning; overbooking allowed with explicit confirm) or
   creates a slot inline (decision 11) → create `Booking`. The slot's date/time
   **overwrite** `deal.tourDate`/`tourTime` with a changelog entry (decision 9).
4. Timeline events on both deal (`tour_created`/`tour_joined`) and tour timelines.
5. **Idempotency:** the first-transition guard + the partial-unique Booking prevent
   duplicate tours on reopen→re-win; if a live Booking already exists, reuse it.

## 5) Reopen / LOST flow (decision 10)

When a deal with a non-cancelled Booking leaves WON (→open or →lost):
- The API refuses the bare status change with a structured 409/422 carrying the
  choice contract; the client shows the dialog:
  - **Remove from tour** → Booking `cancelled`; a private/business TourEvent left
    with zero active bookings is `cancelled` too (status, never delete).
  - **Keep the tour** → Booking `orphaned` (tour untouched).
- **Global orphan warning:** an always-visible header indicator (app shell) driven by
  a cheap count endpoint (`no-store`, per project caching rules) of orphaned
  bookings / orphan tours. Clicking opens an orphan queue where the operator can
  **reconnect** (attach the Booking to a deal — same deal re-won or another deal) or
  **cancel/delete** the orphan tour.
- Reconnect semantics beyond "attach to a deal" (e.g., field mismatches at reconnect
  time) are a product decision → will be asked when Phase 1 reaches it.

## 6) Field ownership (pending owner matrix — open item C)

Locked baseline (decision 6): **the Deal remains the operational planning source
after WON.** The Tour is execution. Engineering implication offered for the matrix
discussion (recommendation only, not assumed):

- Private/business: TourEvent scheduling fields act as a **mechanical one-way mirror
  of the Deal** (single writer = Deal; deal edits propagate to the TourEvent in the
  same write path — not a background sync). This keeps tours listable/calendar-able
  by date without joining into deal scalars, while the Deal stays the only place an
  operator edits planning data.
- Group slots: the slot owns its schedule (it predates deals); deal joins copy FROM
  the slot (decision 9). Per-deal participants: `deal.participants` remains the
  writer; `booking.seats` mirrors it mechanically.
- Execution-only facts (status lifecycle, assignments, operational notes, runsheet)
  live on the TourEvent — they have no Deal counterpart.

## 7) Customer information on the Tour screen

Read-through composition at read time in the TourEvent GET — zero copied columns:
Organization/Unit, ordering contact (`DealContact.isPrimary` + primary phone/email),
field representative (`DealContact` role `fieldRep` — already in `VALID_ROLES`),
important info (`deal.customerInfo`). Group slots render this per Booking. Contact
edits happen where contacts live today; the Tour screen deep-links. Tour-pair-specific
notes go on the **Booking**, not the TourEvent.

## 8) Guide Portal

Extend the existing token portal feed — no second portal. A confirmed
`TourAssignment` becomes a `type='tour'` task (date, time, meeting point resolved
from variant/location defaults, role, participant count). Dedicated operational-only
serializer: portal payloads never include commercial data (value, payment state).
Later: link the TourEvent to relevant `Tour` (content) routes for the guide.

## 9) Numbering

Deal `orderNo` (sequence from 27000) is **shipped** (9db45f8) — header display, Deal
URL with dual-accept resolver (old cuid links still work), cuid remains the internal
key, number never sent to external systems. TourEvents reference deals through
Booking→Deal and therefore inherit the order number for display. A separate
`tourNumber` sequence only if ops asks later (same sequence mechanism, own range).

## 10) Risks (updated for locked decisions)

1. **Mirror discipline (top risk).** With the Deal as planning source, the
   Deal→TourEvent mirror must be single-writer and synchronous in the same write
   path. Any second write path (or background sync) recreates the dual-SSOT problem.
   Blocked on the ownership matrix (open item C).
2. **Orphan queue hygiene.** Orphans are now a feature; the header warning + queue
   must be impossible to miss but also actionable, or orphans accumulate. Count
   endpoint must be cheap and `no-store`.
3. **Hard WON gate friction.** With no draft escape hatch (decision 5), the
   required-field list (open item A) directly controls sales friction — the
   pre-WON checklist UI must make readiness visible long before the WON click.
4. **Reconnect semantics underspecified** — deliberately deferred; ask before
   building that part of the orphan queue.
5. **Derived-occupancy consistency** — one shared helper, never a stored total.
6. **Assignment identity drift** — must use the `externalPersonId` snapshot pattern.
7. **Portal data exposure** — separate serializer, operational fields only.
8. **WON transaction** — the first-WON branch must become a `prisma.$transaction`.
9. **Timeline genericity** — verify `subjectType='tour'` support before Phase 1.
10. **Scheduling scope creep** — calendar/availability/recurrence stay out of
    Phase 1; the timezone-explicit model keeps the door open.

## 11) Phased plan

- **Phase 0 — owner inputs (blocking):** required-field lists for WON
  (private/business + group) and for slot creation (open items A+B); field-ownership
  matrix (open item C). ~~orderNo~~ (done, 9db45f8). No renames (decision 7).
- **Phase 1 — spine:** `TourEvent` + `Booking` models; transactional WON gate
  (declarative required-field config) + private/business auto-create + group slot
  picker with inline slot creation; reopen/LOST choice dialog + orphan statuses +
  global orphan header warning (basic queue: reconnect-to-same-deal / cancel);
  minimal Tour screen (details, status, customer read-through, participating deals);
  Tours list (upcoming by date).
- **Phase 2 — group depth:** slot management UX on the Tours screen, derived
  occupancy displays + capacity warnings everywhere, multi-deal aggregation panel,
  full reconnect flow (after semantics are decided).
- **Phase 3 — guide assignments:** `TourAssignment` + Tour-screen assignment UI +
  role changelog + double-booking warning.
- **Phase 4 — guide portal:** `type='tour'` tasks in the existing feed,
  operational-only serializer, meeting-point resolution.
- **Phase 5 — depth (as needed):** status lifecycle polish, calendar view (reuse
  Sabbath/holiday rules), pay snapshots, `tourNumber`, TourEvent→content links.

Each phase deploys alone. Phase 1 cannot start before Phase 0's three owner inputs.
