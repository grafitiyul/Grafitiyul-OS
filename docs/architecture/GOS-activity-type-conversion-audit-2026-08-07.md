# Activity-Type Conversion — audit, matrix, state machine

**Date:** 2026-08-07
**Status:** IMPLEMENTED — see §10 for what shipped and how the owner decisions landed
**Scope:** converting an existing Deal between any two supported activity types
(`group` ⇄ `private` ⇄ `business`), in both directions, as one canonical framework.
**Explicitly out of scope:** Deal #26107. Nothing in this document is written for it
and nothing here mutates it.

---

## 0. One-paragraph summary

Changing `Deal.activityType` is currently a **plain field write with no operational
guard at all**. Every other dangerous transition in GOS (WON, LOST, reopen, replace
tour, delete) is routed through a canonical service with gates, audit and reconciliation
— activity type is the one that was left as a dropdown. The good news from the audit:
almost every mechanism a conversion needs **already exists and is canonical**
(`createTourForWonDeal`, `cancelDealBooking`, `syncDealRegistration`, `occupancyFor`,
`markTourWooPending`, `calendarPendingPatch`, `emitTourChangeImpact`, `computeCollection`,
`createReviewItem`, `recordDealChanges`). The work is therefore **orchestration, not new
machinery** — one conversion service that sequences the existing canonical writers, plus
exactly **two genuinely new pieces**: stale-communication reconciliation, and the
conversion audit/idempotency record.

---

## 1. What exists today (verified in code)

### 1.1 The vocabulary

| Layer | Field | Values |
|---|---|---|
| Deal | `Deal.activityType` | `group` \| `private` \| `business` (`server/src/routes/deals.js:91`) |
| Tour | `TourEvent.kind` | `group_slot` \| `private` \| `business` (`server/src/tours/requiredFields.js:8`) |

`Deal.activityType='group'` maps to `TourEvent.kind='group_slot'`; `private`/`business`
map 1:1.

### 1.2 The canonical writers already in place

| Concern | Canonical owner | Notes |
|---|---|---|
| Create/join a tour for a deal | `tours/tourFromDeal.js` → `createTourForWonDeal` | capacity guard, `allowOverbook`, plan materialization, reactivation-instead-of-twin, registration sync, calendar dirty |
| Detach a deal from a tour | `tours/tourFromDeal.js` → `cancelDealBooking` | cancels booking, mirrors registration → `cancelled` (**seats released**), auto-cancels an emptied private/business tour, gallery cleanup, calendar dirty |
| Preserve operational state before cancelling | `tourFromDeal.js` → `copyTourStateToPlan` | guides/components/notes → `DealTourPlan` (the reopen path already uses it) |
| Seat SSOT | `tours/registrations.js` → `syncDealRegistration` | also calls `recomputeTourOperationalProduct` + `markTourWooPending` for group slots |
| Capacity truth | `tours/occupancy.js` → `occupancyFor` | already excludes the deal's own held reservation |
| Overbooking rule | `createTourForWonDeal({ allowOverbook })` | **an existing, explicitly supported operator action** — §5's "reuse, don't invent" is satisfied by threading this flag |
| Woo stock | `markTourWooPending` (called from `syncDealRegistration`) | fires on **both** release and consume — no extra work |
| Google Calendar | `calendarPendingPatch()` + `kickTourCalendarSync()` | fires on tour create, cancel and field change |
| Org classification SSOT | `deals/classification.js` → `normalizeClassification` | linked org ⇒ `business`, always |
| Money | `collection.js` → `computeCollection` | derived from `IcountDocument` + `DealCollectionEvidence` vs `Deal.valueMinor`; already yields `overpaid` |
| Changelog | `timeline/dealChangelog.js` | already tracks `activityType` with a Hebrew label |
| Customer-impact issue | `tours/changeImpact.js` → `emitTourChangeImpact` | dedupe `(tourEvent, impactType)`, requirements sub-records |
| Exactly-once operator cards | `reviewItems/service.js` → `createReviewItem` | keyed on `dedupeKey` |
| בקרה detectors | `control/detectors/*` + `registry.js` | one file per detector |

### 1.3 The DB constraints that dictate ordering

- `Booking_one_active_per_deal_key` — `UNIQUE(dealId) WHERE status='active'`
  (`migrations/20260711090000_tour_events/migration.sql:65`).
  ⇒ **The old booking must be cancelled before the new one is created**, in the same
  transaction, or the write fails with P2002.
- `Booking.tourEventId` / `TicketRegistration.tourEventId` — `onDelete: Restrict`.
  ⇒ Tours are never deleted, only `cancelled`. Conversion follows the same rule.
- Partial unique on active generated group slots (canonical slot identity).
  ⇒ Conversion never creates a group slot; it only **joins** an existing one.

---

## 2. The hole — what actually happens today

`PUT /api/deals/:id` (`server/src/routes/deals.js:761-771`) accepts `activityType` and
writes it directly. `GROUP_LOCKED_FIELDS` blocks slot-owned *planning* fields while the
deal sits on a group slot — but `activityType` **is not in that list**.

Consequence, verified by reading the code paths:

**Flipping a WON group deal to `private` today:**
1. `Deal.activityType` becomes `private`. ✔ written
2. The `Booking` stays `active` on the `group_slot`. ✘
3. The `TicketRegistration` stays `active` — **the seat is still consumed**, Woo stock
   still shows it sold. ✘
4. `pendingTourUpdate()` returns `[]` because it early-returns on
   `tour.kind === 'group_slot'` (`tourFromDeal.js:580`) — so the
   `deal_tour_out_of_sync` בקרה detector **never fires**. ✘
5. `wonGate` is only evaluated on a WON *transition*, so the now-missing
   private-tour required fields are never checked. ✘
6. Nothing tells anyone. The deal is commercially `private` and operationally a group
   participant, indefinitely and undetectably.

**Flipping a WON private deal to `group`** leaves a live private `TourEvent` while the
deal claims `group`; `POST /:id/tour-booking` then becomes reachable and *does* cancel
the private tour and join a slot — but as two uncontrolled steps, with no capacity
pre-check against the commercial change, no financial reconciliation, no comms cleanup,
and no audit record tying the two halves together.

**This is the class of edge case to close.**

---

## 3. Genuinely new problems the conversion service must solve

Everything else is orchestration of existing writers. These four are not covered anywhere
today:

### 3.1 Stale scheduled communications — **a real, currently-unhandled defect**

`CommunicationDelivery.tourEventId` is frozen at scheduling time
(`communication/engine.js:64`). At send time the worker rebuilds context with
`loadTriggerContext({ dealId, sessionId, tourEventId: row.tourEventId })`, and
`context.js:164` gives the **frozen `tourEventId` precedence** over the deal's current
booking.

The worker has exactly one escape hatch: `ctx.tour.status === 'cancelled'` ⇒ cancel the
delivery (`deliveryWorker.js:110-115`). **A group slot is never cancelled when one deal
leaves it** (`tourFromDeal.js:370` — group slots are explicitly excluded from
auto-cancel). Therefore after a group→private conversion:

> every pending tour-anchored delivery still points at the live group slot, still fires
> at the **old** date, and still renders the **old** meeting point — to a customer who is
> no longer on that tour.

§11's invariant ("no future message may go out using the old operational state") is
**violated today** and requires a new reconciliation step. There is no existing mechanism
to reuse — `POST /deliveries/:id/cancel` is a manual, per-row admin action.

### 3.2 The org rule and "convert away from business" collide

`normalizeClassification` force-writes `activityType='business'` whenever an
`organizationId` is linked, on every create and update. So `business → private` and
`business → group` are **impossible while the org link exists** — the server silently
rewrites the value back.

The task spec (§6) says conversion away from business must *not* auto-remove the
Organization. Those two rules cannot both hold. **This needs an owner decision** — see
§7 Open Decisions.

### 3.3 No conversion identity

There is no record that says "this deal was converted". `recordDealChanges` will log
`activityType: group → private` as one field among others in a generic save group — §14
explicitly forbids hiding it in field-change noise. And with no stable operation id,
double-click / refresh / retry idempotency has nothing to key on.

### 3.4 Confirmation: correct by construction, but must not auto-fire

`sendConfirmationEmail` composes from **live** deal + tour state, so a post-conversion
send is automatically right. The auto-send hook (`confirmation/wonHook.js`) is wired to
`emitWonTransitionEffects`, which fires **only on a genuine non-WON→WON flip** — a
conversion is not that, so nothing auto-sends. That is the desired default (§9: offer,
never blind-send). The conversion dialog gets an explicit opt-in that routes through the
existing send path; when required data is missing, the existing
`confirmationEmailReview` card is the canonical surface.

---

## 4. The conversion matrix (the contract)

`P` = private, `B` = business, `G` = group/open tour. Rows = from, columns = to.

### 4.1 Per-pair contract

| From → To | Allowed | TourEvent | Booking | Slot selection | Org | Seats | Planning (`DealTourPlan`) | Payment | Confirmation |
|---|---|---|---|---|---|---|---|---|---|
| **G → P** | yes | old slot **kept alive** (never cancelled); **new** private TourEvent via `createTourForWonDeal` | old cancelled, new created | n/a | unchanged | old released (`syncDealRegistration`→cancelled); new tour = deal's own seats | plan materialized into the new tour; group deals rarely have one ⇒ **new tour has no guide — surfaced, not hidden** | untouched; balance re-derives from new `valueMinor` | offer fresh |
| **G → B** | yes | as G→P, `kind='business'` | as G→P | n/a | **required** (see §7 D1) | as G→P | as G→P | untouched | offer fresh |
| **P → G** | yes | private tour auto-cancels when its last booking leaves; **join** the operator-chosen slot | old cancelled, new created on the slot | **explicit, mandatory** — never guessed | unchanged | old released; new consumed on the slot (capacity gate, `allowOverbook` for the existing operator override) | `copyTourStateToPlan` **before** cancelling, so guides/components survive a conversion back | untouched | offer fresh |
| **B → G** | yes | as P→G | as P→G | **explicit, mandatory** | see §7 D1 | as P→G | as P→G | untouched | offer fresh |
| **P → B** | yes | **same TourEvent, `kind` updated in place** | **unchanged** | n/a | **required** (see §7 D1) | **unchanged** | **unchanged** | untouched | offer fresh (optional) |
| **B → P** | yes | **same TourEvent, `kind` updated in place** | **unchanged** | n/a | see §7 D1 | **unchanged** | **unchanged** | untouched | offer fresh (optional) |
| **X → X** | **refused** (`same_activity_type`, 409) | — | — | — | — | — | — | — | — |

### 4.2 Why P ⇄ B is an in-place `kind` update — evidence

Grepped every server read of `TourEvent.kind`. Nothing branches `private` vs `business`
operationally. The only two consumers that distinguish them are **display**:

- `tours/calendar/desiredState.js:172` — the Google Calendar summary label
  (`סיור פרטי` / `סיור עסקי`).
- `tours/guidePortal/dto.js:114,263` — `KIND_TO_ACTIVITY[tour.kind]`, the label the guide
  sees.

Every operational branch is `group_slot` vs not (`kind !== 'group_slot'`,
`kind: { in: ['private','business'] }`, `kind: { not: 'group_slot' }` — 55 call sites, all
of that shape). Required fields are identical for `private` and `business`
(`requiredFields.js:41-63`). Capacity is null for both. Woo syncs neither.

⇒ Replacing the TourEvent for P⇄B would destroy gallery, questionnaires, payroll linkage,
Google event identity and timeline **to change a label**. §6's "smallest correct mutation"
is unambiguous here: update `kind` in place, mark the calendar dirty, done.

### 4.3 The round-trip / reactivation rule

`createTourForWonDeal` already prefers **reactivating** a prior cancelled private/business
tour of the same deal over minting a twin (`tourFromDeal.js:200-253`). A G→P→G→P
round trip therefore returns to the **same** TourEvent id, keeping gallery/payroll/
questionnaire/calendar identity — and `coreData` overwrites date/time/product/variant/
language wholesale, so the reactivated row can never carry stale scheduling. **Reuse
as-is; do not add a conversion-specific creation path.**

---

## 5. Proposed state machine

One service: `server/src/deals/activityConversion.js`. Three phases, matching §12.

### PREVIEW — `GET /api/deals/:id/conversion/preview?target=<type>[&tourEventId=<id>]`

Pure read. Never writes. Returns:

```
{
  current:  { activityType, tourEvent{id,kind,date,startTime,productVariant,location},
              booking{id,seats}, registrations[], participants, confirmationState },
  target:   { activityType, mode: 'replace_tour' | 'join_slot' | 'update_kind' },
  plan:     [ ordered, human-readable steps in Hebrew ],
  requires: { slotSelection: bool, organization: bool, missingFields: [{field,labelHe}] },
  capacity: { slotId, capacity, activeSeats, requested, fits: bool, overbookAllowed: bool },
  money:    { totalMinor, paidMinor, balanceMinor, status },  // computeCollection, unchanged
  warnings: [ 'new tour has no assigned guide', 'N pending messages will be reconciled', … ],
  blockers: [ … ]   // non-empty ⇒ CONFIRM is refused
}
```

Blockers are evaluated here **and re-evaluated inside the CONFIRM transaction** — a
preview is advice, never authority.

### CONFIRM — `POST /api/deals/:id/conversion` (single transaction)

```
0.  guard      target ≠ current                          → 409 same_activity_type
1.  guard      re-read deal + active booking FOR UPDATE
2.  guard      wonGate(merged deal, target)              → 422 won_requirements_missing
3.  guard      target=group ⇒ tourEventId given, slot kind/status valid
                                                          → 422 tour_slot_required / _invalid
4.  guard      capacity check via occupancyFor, honouring allowOverbook
                                                          → 409 tour_full  (BEFORE any write)
5.  guard      org rule per decision D1                   → 409 organization_required
                                                             / organization_forces_business
--- no writes above this line; a refusal leaves the deal byte-identical ---
6.  mode=update_kind (P⇄B):
        tourEvent.update({ kind, ...calendarPendingPatch() })
    mode=replace_tour / join_slot:
        a. copyTourStateToPlan (only when leaving a private/business tour)
        b. cancelDealBooking(old)     ← releases seats, auto-cancels emptied tour,
                                        marks Woo + calendar dirty
        c. deal.update({ activityType, activityTypeAssumedAt: null, ...orgPatch })
        d. createTourForWonDeal(target slot | own tour, { allowOverbook })
        e. apply returned dealSync (group slot is authoritative)
7.  reconcile pending CommunicationDeliveries (§6 below)
8.  write the immutable conversion audit event (§14) + recordDealChanges
9.  stamp Deal.conversionOpId (idempotency identity)
```

### POST-COMMIT (fire-and-forget, each isolated, each idempotent)

```
kickTourCalendarSync()          // old tour deleted / new event created
kickWooSync()                   // released + consumed slot stock
kickPayrollReconcile('tour', oldTourEventId)
kickPayrollReconcile('tour', newTourEventId)
emitTourChangeImpact(...)       // only when other registered customers are affected
confirmation send               // ONLY if the operator ticked "שלח אישור מעודכן"
createReviewItem(...)           // overpayment / missing confirmation data / no guide
```

**Failure after commit never rolls back the customer's real conversion.** Each
post-commit step catches its own error and raises a loud recovery card; every step is
re-runnable (`POST /api/deals/:id/conversion/retry-effects`).

### Idempotency

`Deal.conversionOpId` (String?, unique) — a client-supplied UUID sent with CONFIRM.
Re-sending the same id returns the previous result unchanged; the transaction's first
statement is a conditional insert on that id. Combined with the existing
`Booking_one_active_per_deal_key` and `createTourForWonDeal`'s own
"active booking already exists ⇒ reuse" short-circuit, no path can produce duplicate
tours, bookings, registrations or seats.

---

## 6. Stale-communication reconciliation (the new mechanism)

New, minimal, and canonical — `communication/reconcileDealTour.js`:

```js
// Every pending delivery bound to the deal's PREVIOUS tour is reconciled the
// moment the deal moves. Two outcomes, no third:
//   • the message still applies to the new tour  → re-point tourEventId, clear
//     intendedAt so the worker's own anchor re-resolution recomputes it
//   • it does not                                → status='cancelled',
//     waitReason='הדיל הועבר לסוג פעילות אחר'
reconcilePendingDeliveries(tx, { dealId, fromTourEventId, toTourEventId })
```

Scope: `status IN ('scheduled','waiting_window','waiting_dependency','failed')`.
`sent` rows are **history and are never touched**.

Re-pointing rather than blanket-cancelling is deliberate: a "reminder 1 day before the
tour" is still the right message, just about a different tour — cancelling it would
silently drop a customer communication. The worker's existing anchor re-resolution
(`deliveryWorker.js:106-120`) then recomputes `intendedAt` from the new tour with no new
timing code. `WhatsAppScheduledMessage` rows tied to the deal get the same treatment.

---

## 7. Open decisions — I need your call before implementing

### D1 — Organization vs "convert away from business"

`normalizeClassification` makes a linked Organization force `activityType='business'`,
unconditionally, and that rule is the SSOT (`project_deal_classification_ssot`). The spec
says conversion away from business must not auto-remove the Organization. Both cannot
hold. Options:

- **(a)** Converting `business → private/group` **requires explicitly unlinking the
  Organization in the same operation**, with the dialog stating it plainly
  ("הארגון יוסר מהדיל"). The SSOT rule stays untouched. *(my recommendation — one rule,
  no exception, and the operator sees exactly what happens)*
- **(b)** Relax the SSOT: an org may stay linked on a non-business deal. Cheaper in the
  dialog, but it re-opens the exact contradiction the classification SSOT was built to
  close, and every reader of "org ⇒ business" becomes wrong.

And the mirror: converting **to** business — require an Organization (blocking), or allow
business with no org (the current model permits it)? I lean **require it in the conversion
dialog** (a deliberate business conversion should name the business) while leaving the
plain field edit as-is.

### D2 — Which conversions are reachable without a full conversion?

Proposal: **the dropdown keeps working only while the deal has no operational state**
(no active Booking, no capacity-holding TicketRegistration). The moment either exists,
`PUT /api/deals/:id` refuses `activityType` changes with `409 conversion_required` and the
UI routes to the dialog. Agreed?

### D3 — Commercial editing inside the dialog

§7 asks the Builder to be exposed before confirmation. The Builder
(`PriceBuilderDialog` / `produce.js`) is a large, already-canonical surface with its own
save path. Options:

- **(a)** The dialog **shows** the money picture (old total / paid / balance / delta) and
  offers "ערוך מחיר" which opens the existing Builder, then returns to the conversion
  dialog with refreshed numbers. *(my recommendation — reuses the premium component, no
  duplicate pricing UI, and the Builder stays the only product/price writer per
  `project_unpaid_migrated_builder_unlock`)*
- **(b)** Embed the Builder inside the conversion dialog as a step.

### D4 — Overpayment

Confirmed by audit: `computeCollection` already returns `status: 'overpaid'` with a
negative balance, with no refund side-effects anywhere. So §7 needs **no new money
logic** — only a new `ReviewItem` kind (`conversion_overpayment`) so the operator is
told, per existing accounting rules. Confirm that a review card is the right surface
(rather than, say, a בקרה issue).

---

## 8. Test plan (maps 1:1 to spec §17)

Unit/behaviour, fixture-backed, plus a `prismaShape` contract test (the fake-db blind
spot — `feedback_fake_db_blind_spot`):

1. G→P  2. G→B  3. P→G  4. B→G  5. P→B  6. B→P
7. same-type refused (409, zero writes)
8. insufficient capacity blocks **before any write** (state byte-identical)
9. old group seats released exactly once
10. new group seats allocated exactly once
11. old private tour cancelled/auto-cancelled appropriately
12. new private/business tour created once (and **reactivated**, not twinned, on round trip)
13. payment/documents/evidence untouched — byte-identical rows
14. Builder difference flows into `computeCollection` correctly
15. overpayment ⇒ review card, never an automatic refund/credit doc
16. issued `IcountDocument` rows untouched
17. pending deliveries re-pointed or cancelled; `sent` rows untouched
18. new confirmation composes from the new operational state
19. duplicate conversion request (same `conversionOpId`) is a no-op
20. post-commit failure ⇒ recovery card + idempotent retry
21. Guide Portal shows only the new assignment
22. Woo pending flags set on both released and consumed slot
23. exactly one live calendar-relevant TourEvent
24. rollback before commit leaves the original state byte-identical
25. **P⇄B does not replace the TourEvent** (same id, gallery/payroll/questionnaire intact)
26. DMMF shape contract for every new/changed Prisma write

Plus a בקרה detector test for `deal_activity_conversion_incoherent` (§15) and an extension
of the existing `deal_tour_out_of_sync` detector to stop early-returning on a group slot
whose deal is no longer a group deal — that single change would have caught the hole in §2.

---

## 9. Files this will touch

**New**
- `server/src/deals/activityConversion.js` — the service (PREVIEW/CONFIRM/effects)
- `server/src/deals/activityConversion.test.js`
- `server/src/deals/activityConversion.prismaShape.test.js`
- `server/src/communication/reconcileDealTour.js` (+ test)
- `server/src/control/detectors/activityConversion.js`
- `server/src/reviewItems/kinds/conversionOverpayment.js`
- `client/src/admin/deals/ActivityConversionDialog.jsx`
- one Prisma migration: `Deal.conversionOpId` (+ unique)

**Changed**
- `server/src/routes/deals.js` — the `409 conversion_required` guard + 3 routes
- `server/src/control/detectors/dealTourSync.js` — stop early-returning on a group slot
  whose deal is no longer `group`
- `client/src/admin/deals/DealDetail.jsx` — "שנה סוג פעילות" in the deal kebab
- `client/src/lib/api.js` — `api.deals.conversion.*` (guarded by `api.contract.test.js`)

**Deliberately NOT changed** — reused as-is: `tourFromDeal.js`, `registrations.js`,
`occupancy.js`, `collection.js`, `classification.js`, `changeImpact.js`, `woo/service.js`,
`calendar/service.js`, `confirmation/*`, `payroll/*`.

---

## 10. What shipped (2026-08-07)

### 10.1 Owner decisions, as decided

| # | Decision | Outcome |
|---|---|---|
| D1 | Organization vs converting away from business | **Neither proposed option.** The owner rejected forced unlinking: the dialog offers an explicit **keep / remove** choice, and the `organization ⇒ business` assumption was adjusted canonically rather than exempted. See §10.2. |
| D2 | When the plain dropdown still applies | Blocked once **any operational state** exists (active Booking **or** capacity-holding TicketRegistration). `hasOperationalState()` is the ONE definition. |
| D3 | Builder in the dialog | Money picture in the dialog + **ערוך מחיר** opens the canonical `PriceBuilderDialog`; the preview refetches on save. The Builder stays the only product/price writer. |
| D4 | Overpayment | A `conversion_overpayment` ReviewItem. No new money logic — `computeCollection` already reports `overpaid`, and the conversion writes to no accounting table at all. |

Also per the owner: **Open Tour → Open Tour is out of scope** — moving between
group slots is the existing "החלף סיור" action, and same-type conversion is
refused with `same_activity_type`.

### 10.2 The classification SSOT change (D1) — what the audit found

The rule "a linked organization means business" was **not** one rule. It was
re-derived by hand in **seven** places, and they did not agree: six read the org
link as an OVERRIDE, while `resolveActivityType` read it as a DEFAULT.

| Site | Was |
|---|---|
| `communication/conditions.js:76` | override — targeted business messages at a company's private booking |
| `communication/variables.js:107` | override |
| `confirmation/resolveTemplate.js:63` | override — **picked the BUSINESS confirmation email for a private tour** |
| `confirmation/variables.js:117` | override |
| `ingress/records.js:140` | override (deal create) |
| `ingress/records.js:521` | override (Woo order update) |
| `deals/resolveActivityType.js:56` | default (the correct reading) |
| `client DealDetail.jsx:2080,2159` | override — disabled the buttons |

The cleanest canonical solution, and what shipped: **one resolver,
`shared/dealActivity.mjs → effectiveActivityType()`**, used by all of them.

> An explicit activity type is authoritative.
> An organization supplies one only when the deal has none.

The same single line now governs the write side (`normalizeClassification`), so
reader and writer cannot drift. **The ORGANIZATION TYPE half of the SSOT is
untouched** — the org's own type is still effective, the deal-level copy is
still force-cleared, and a foreign subtype is still dropped. That rule was always
about *type*, never about *activity*.

An intermediate design made the write rule transition-aware ("attaching
classifies it, later saves preserve it"). It was **rejected during
implementation**: it left a back door where attaching an organization to an
already-booked, already-classified deal would silently reclassify it — changing
what the deal IS outside the conversion flow that owns that change. The shipped
rule has no transition state and no exception.

Visible consequence, intended: attaching an organization to a deal that already
says `private` or `group` leaves it saying that. The operator sets business from
the activity badge (now unlocked) if that is what they mean.

`collection.js:523`'s `customerKind` deliberately keeps its own
`organizationId || activityType === 'business'` reading — it asks a third
question ("is there a company to invoice?") which the org link really does answer
alone. It is not a copy of this rule, and is documented as such.

### 10.3 Files

**New**
- `shared/dealActivity.mjs` — the ONE activity resolver + the activity⇄tour-kind mapping
- `server/src/deals/activityConversion.js` — preview / confirm / post-commit effects
- `server/src/deals/conversionReview.js` — the two operator-facing outcomes
- `server/src/communication/reconcileDealTour.js` — park + finalize pending deliveries
- `server/src/routes/dealConversion.js` — the three endpoints
- `server/src/control/detectors/activityMismatch.js` — the backstop detector
- `server/src/reviewItems/kinds/conversionOverpayment.js`, `conversionRecovery.js`
- `client/src/admin/deals/ActivityConversionDialog.jsx`
- `server/prisma/migrations/20261010090000_deal_activity_conversion/` — `Deal.conversionOpId` + UNIQUE
- Tests: `activityConversion.test.js` (26), `activityConversion.prismaShape.test.js` (4),
  `activityMismatch.test.js` (7), `shared-tests/dealActivity.test.js` (7)

**Changed**
- `server/src/deals/classification.js` — the activity rule is now one line
- `server/src/deals/resolveActivityType.js` — delegates to the shared ladder
- the five override readers listed in §10.2
- `server/src/routes/deals.js` — `409 conversion_required` on PUT and on
  confirm-classification; `organization_forces_business` removed
- `server/src/control/detectors/index.js`, `server/src/index.js`,
  `server/src/reviewItems/kinds/index.js` — registration
- `client/src/admin/deals/DealDetail.jsx` — kebab entry, 409 route-through,
  unlocked activity badge; `config.js` — `ACTIVITY_OPTION_ON` moved in
- `client/src/lib/api.js` — `conversionPreview` / `convert` / `retryConversionEffects`

**Deliberately unchanged** — reused as-is: `tourFromDeal.js`, `registrations.js`,
`occupancy.js`, `collection.js`, `changeImpact.js`, `woo/service.js`,
`calendar/service.js`, `confirmation/*`, `payroll/*`, `replaceTour.js`.

### 10.4 Test results at ship time

- server `npm test` — **3980 pass / 0 fail**
- client `npm test` — **971 pass / 0 fail**
- client `npm run build` — clean
- `npm run validate:migrations` — clean

Spec §17's numbered cases map to named tests in `activityConversion.test.js`
(the case number is cited in each test title where it applies). Three of the
listed cases are deliberately **not** covered by the fake-db suite because a
fake cannot prove them — Guide Portal content (§17.21), Woo stock (§17.22) and
calendar contents (§17.23) are verified live in §11 instead. The fake proves the
LOGIC, the DMMF walk proves the FIELD NAMES, and live verification proves the
whole thing; none of the three is sufficient alone.

### 10.5 Known residual risk

`finalizeDealTourDeliveries` runs POST-COMMIT, so applicability re-evaluation
has a bounded window (`PARK_GRACE_MS`, 2 minutes) during which the parked
deliveries are held. If that step never runs, the worker's own anchor
re-resolution takes over against the NEW tour — correct behaviour, minus the
applicability re-check — and a `conversion_recovery` card is raised. Degraded,
never wrong.
