# Tours Migration — Architecture Audit (2026-07-16)

Read-only audit. No importer, no production writes, no Airtable repair.
Every number below is measured from Snapshot #1 + the live GOS database.

## 1. The dependency graph

```
AIRTABLE (legacy operations)                GOS (canonical, live since 2026-07)
─────────────────────────────               ───────────────────────────────────
סיורים master  tblTI7iaGm6qsQA4a (3,508)    TourEvent (49 native, earliest 2026-07-12)
  Tour_ID · DATE · times · status             ├─ Booking → Deal        (18)
  capacity · guide counts · tour-end ops      ├─ TicketRegistration    (19)
  ▲ 'שם סיור' link                            ├─ TourAssignment        (20)  ← PersonRef | externalPersonId+displayName
תיאום coordination tbl1JaGS5oKRIkJ9z (4,413)  ├─ TourEventActivityComponent
  deal↔tour rows = Booking equivalent         ├─ PayrollActivity (1:1) → PayrollEntry
  פייפ דיל ID (4,399) · guide email           ├─ TourGallery
  legacy gcal event id (3,685)                ├─ gcal* mirror fields (dirty-flag sync TARGET)
גבייה collection tblQIivZgMbF6J68i (1,702)    ├─ woo* mirror fields + WooVariationLink
  Deal_id (1,553) · סיור link (1,569)         └─ OpenTourTemplate / OpenTourScheduleRule /
שכר payroll tbli0eBDJ6CgCj4iJ (2,559)              ScheduleException (CONFIG, not data)
טפסי מדריך tbl2F0UFzrddKPXzz (294)           Deal.tourDate/tourTime/participants (10,876 imported
תזכורות WhatsApp tbll83BjS4kLMRNuh (5,041)     deals carry a tour date — deal-side planning fields)
סטטיסטיקה tblaxH2LJYhYJWnIN (199)            Guide Portal / questionnaires / summaries → read TourEvent
```

Link structure (measured): coordination→master linked **3,717/4,413**; distinct
master tours referenced **2,378**; deals-per-tour: 1,923 single-deal (private/
business), 455 multi-deal open tours (up to 43 deals on one tour). Master tours
with **no** deal link: 1,130 (913 cancelled, 54 future open slots, 163 other).

**Trustworthy identifiers:** master `recid`/`Tour_ID` (sequential, 100% fill),
`DATE` (100% fill), coordination `פייפ דיל ID` (numeric Pipedrive id → the deal
crosswalk). **Historical-only / untrustworthy:** Airtable `סטטוס` is STALE
(1,174 rows say "עתידי" but only 134 are date-future — dates are the truth,
statuses are not), legacy gcal event ids (owned by Airtable automations),
guide emails (identity hint only). **Website/Woo identifiers: none exist in the
Airtable tour tables** (measured) — website bookings entered as Pipedrive deals
(already imported); Woo lives GOS-side only (WooVariationLink, sync gated OFF).

## 2. Canonical post-migration model (the SSOT answer)

**TourEvent is the single source of truth for every tour — historical, future,
open, private, business, cancelled.** It already models all of them (`kind`,
`status` incl. cancelled/postponed, capacity, completion semantics) and every
GOS consumer (portal, payroll, gallery, questionnaires, calendar, Woo) reads it.
Two sources of tour truth is the exact disease this migration cures.

| Entity | Post-migration role |
|---|---|
| TourEvent | **canonical** — every tour |
| Booking | **canonical** — deal↔tour participation (from coordination rows) |
| TicketRegistration | **canonical** for FUTURE/operational tours; historical seats live on Booking.seats (registrations are capacity machinery, not history) |
| TourAssignment | **canonical** — guide per tour (PersonRef when resolvable, else externalPersonId+displayName) |
| Deal.tourDate/…​ | **derived/planning** — deal-side desired state (already imported) |
| OpenTourTemplate/Rules/Exceptions | **config** — untouched by migration; imported future slots are manual (template null) unless the owner adopts them into templates |
| PayrollActivity/Entries | **canonical from the GOS epoch only** — historical Airtable payroll (2,559 rows) is legacy-only (already-paid history) |
| gcal mirror fields | **derived** — sync target, never truth |
| Airtable: master/coordination/collection/forms/reminders/stats | **legacy-only** — archived via LegacyRecord (cardData), never operational again |

## 3. Airtable reconciliation

Tours↔Deals: coordination rows via `פייפ דיל ID` → the deal crosswalk (24,358
rows, complete). Participants↔Deals: a "participant" in Airtable IS a
coordination row (a deal on a tour); people come from DealContacts (imported).
Participants↔Tours: coordination `שם סיור` → master recid.

**The 52 broken links, categorized (repair deferred):**
- **38 coordination→deal `deal_missing`** — deals deleted from Pipedrive before
  the snapshot (ids 14609–26129, tours 2023–2025, mostly historical). Category:
  *history of deleted deals* → tour imports; the booking slot becomes a
  no-deal legacy note on the tour card. Not repairable — the deal is gone.
- **14 collection `no_deal_id`** — collection rows never linked to a deal.
  Category: *collection-slice concern*, not a tour blocker.

**New orphan populations found:** 696 coordination rows with NO master-tour
link (participation without a tour — legacy card on the deal, no Booking), and
1,130 master tours with no deal (import as tours without bookings; 913 are
cancelled history).

## 4. Historical vs operational rules

- **Past-dated, not cancelled** (3,374 incl. stale-"עתידי") → TourEvent
  `status='completed'`, `completedReason='migration'`, completedAt = tour end.
  NEVER imported as scheduled-in-the-past — the IL-midnight completion worker
  sweeps past scheduled tours and would mass-fire the completion transition.
- **Cancelled (916)** → `status='cancelled'` real rows (cancellation history is
  business data), no bookings needed (913 have none anyway).
- **נדחה (1)** → postponed.
- **Future (134)** → `status='scheduled'`, OPERATIONAL. **46 of the 134 share a
  date with an existing native GOS TourEvent** — the parallel-operation overlap;
  each needs dedup/adopt resolution (small enough to review).
- **Guide assignments** → TourAssignment from coordination guide emails: 53
  distinct guides, 18 resolve to live PersonRef emails; the rest import with
  externalPersonId (email) + displayName — the model was built for exactly this.
- **Seats/participant counts** → Booking.seats (historical); future open tours
  additionally get TicketRegistration rows (source 'migration') so capacity math
  works after cutover.
- **Legacy gcal event ids (3,685)** → legacy card ONLY for historical tours
  (`gcalSyncStatus=null` = "never considered", per the schema contract).
  Future tours: adopt-vs-recreate is an owner decision (adoption requires the
  legacy events to live on the same org account the GOS syncer owns).
- **Website booking ids / Woo refs** → nothing to migrate (none exist in
  Airtable; deals carry the website history; Woo is GOS-native and gated).

## 5. Side-effect audit (code-verified)

| Surface | Trigger | Import posture |
|---|---|---|
| gcal sync worker | `gcalSyncStatus='pending'` only (dirty flag) | import with null → inert ✓ |
| Woo sync worker | dirty flag + first-publication gate + `WOO_SYNC_ENABLED` off | null → inert ✓ |
| Completion transition (summaries/questionnaires) | `tours/completion.js` route path + IL-midnight worker on past *scheduled* tours | import past tours DIRECTLY as completed — never scheduled-in-past ⚠ rule |
| Payroll | lazy-ensure creates PayrollActivity for completed tours when payroll screens touch them | ⚠ REQUIRED GUARD: exclude pre-epoch (< 2026-07 GOS payroll start) imported tours from lazy-ensure |
| deal_tour_out_of_sync detector | iterates ACTIVE bookings on live tours, diffs deal vs tour | future imported tours must be field-consistent with their deals at import (diff-zero) or they'll raise issues ⚠ rule |
| overCapacity detector | scheduled tours' registrations vs capacity | import real capacity ✓ |
| Guide notifications / WhatsApp / participant messages | none are DB-triggered; all route/worker flows | direct createMany → inert ✓ |
| No prisma middleware, no DB triggers | — | proven again ✓ |

## 6. Exceptional populations (the owner queue — small)

1. **46 future-tour overlaps** with native GOS tours (dedup/adopt) — mandatory.
2. **88 remaining future tours** (no overlap) — verify operational correctness
   (mostly deterministic; spot-review only).
3. **38 deleted-deal tour links** — auto: tour imports, note on card.
4. **696 orphan coordination rows** — auto: legacy card on the deal.
5. **Calendar adoption decision** for future tours — ONE policy decision.
6. **Template adoption** for future open slots — ONE policy decision (default:
   manual slots, adopt later).

Everything else (≈3,300 historical tours) is deterministic — no review rows.

## 7. Importer design (not built)

Identity-import pattern exactly: pure planner (snapshot + ledger + crosswalk →
payloads + deterministic hash) / hard gates / 500-row transactional chunks /
`LegacyRecord (airtable, tour, recid)` crosswalk / MigrationRun batch /
side-effect baseline proof / idempotent re-run = 0. Payload: TourEvent
(+Booking per coordination row via deal crosswalk, +TourAssignment per guide,
+TicketRegistration for future open tours) + legacy card (Tour_ID, original
status, legacy gcal id, tour-end form data, drive links). Kind mapping:
multi-deal → group_slot; single-deal → private/business from the deal's
activityType.

## 8. Rehearsal plan (read-only, ×2 deterministic)

Report: 3,508 master tours (134 future / 3,374 historical / 916 cancelled) ·
4,413 coordination rows (3,717 linked · 696 orphan · 38 broken-deal · 14 no-id)
· 1,130 tours without deals · 46 GOS overlaps · guide resolution 53 emails
(18 PersonRef / 35 external) · 3,685 legacy calendar ids → cards · seats
reconciliation vs deal participants · payload hash for the production gate.
Reconcile exactly to 3,508 + 4,413.

## 9. Owner decisions required before the importer

1. Calendar: adopt legacy Google events for the 134 future tours, or let GOS
   re-create on first edit? (historical = card-only either way)
2. The 46 overlaps: prefer GOS-native row and archive the Airtable twin, or
   merge fields into the native row?
3. Future open slots: manual TourEvents now + template adoption later (default)?
4. Payroll epoch guard: confirm 2026-07 as the lazy-ensure cutoff.
5. Historical seats: Booking.seats only (default), or full TicketRegistration
   history?
