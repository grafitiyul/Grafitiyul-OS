# GOS Cutover — Final Report (pre-execution)

Status: **frozen, cutover-ready**. Companion documents:
`GOS-migration-cutover-runbook.md` (v2, policy) ·
`GOS-cutover-checklist.md` (line-by-line procedure).

## 1. What Wave 1 already completed

- Identity: 20,454 Contacts + 2,689 Organizations (+units), dedup-reviewed, crosswalked.
- Deals: 24,358 (Pipedrive id = GOS orderNo), stage-mapped, legacy cards, zero side effects.
- Tours: 2,473 completed historical TourEvents (Hash A `4bc3a2fa…`), with 3,561 bookings, 3,607 registrations (36,335 seats), 2,179 guide assignments, 1,295 payroll activities / 1,909 frozen entries, 646 exclusion-evidence rows. 916 cancelled tours excluded permanently (Law 2); 1 postponed and 118 future deferred.
- Hardening (this pass): payroll lazy-ensure suppression implemented and live-verified; calendar-sync hold switch; scoped snapshots (`--omit`); the full cutover importer + Hash B gates; one-command preflight.

## 2. What will happen during Cutover

One evening, in order: business stop → legacy automations off → Final Snapshot (scoped, ~600 Pipedrive requests) → identity delta → **one cutover plan** producing Hash B (owner approves populations) → execute: new deals, deal field merges (three-way; GOS edits sacred), conflict seeding, historical-delta tours, **future tours as genuine operational TourEvents** (no templates), duplicate open slots redirected into the native GOS slots, additive delta onto Wave-1 tours (new/changed payroll evidence, seats, bookings) → UI verification under the calendar hold → hold lifted: Google events + invitations created once → legacy read-only.

## 3. Expected downtime

**None for GOS.** The app stays up throughout. The "downtime" is business-process only: no writing into Airtable/Pipedrive from the freeze announcement onward (they never come back for writing).

## 4. Estimated execution time

- Final Snapshot: 15–30 min (resumable if the Pipedrive budget trips — the freeze then simply holds until reset).
- Identity delta + cutover plan + owner approval: 20–40 min.
- Cutover execute: < 5 min (Wave 1 wrote 2,473 tours in 19s; the delta is days-sized).
- Verification + calendar release + checks: 30–60 min.
- **Total: roughly 1.5–2.5 hours of focused evening**, dominated by human verification, not machines.

## 5. Success criteria

- Hash B identical across two plan runs; owner approved it; execute ran gated on it.
- Tour reconciliation exact: historical-delta + already-imported + cancelled + postponed + future = final-snapshot master count.
- Every future-at-freeze tour exists exactly once (created or redirected to a native slot); zero duplicate slots; zero deals with two active bookings.
- Calendar: every imported future tour has exactly one Google event, invitations sent once, correct guides.
- Payroll: no generated (non-frozen) lines on migration-owned tours; future operations generate naturally.
- Side-effect tables (tasks/quotes/payments/docs/email/WhatsApp) unchanged by the import itself.
- Conflicts (retro-cancellations, deal field conflicts) sit as pending `cutover:` rows in the exceptional queue — visible, not lost.

## 6. Rollback strategy

- **Before execute (3.1):** nothing written; walk away freely.
- **After execute, before calendar release (3.3):** everything is additive and batch-tagged (`cutover-<ts>` in `importBatchId`); legacy untouched and still authoritative. Stop-and-resume or batch-scoped removal both possible.
- **After calendar release:** invitations are irreversible (runbook). All data corrections are forward-only through the Review Center.
- **After legacy goes read-only (4.3):** rollback horizon ends at the first business write into GOS; from then on forward-correction only.

## 7. Final verification steps

Built into `run-cutover-import.mjs` (post-run block): scheduled migration-owned tour count, calendar hold state, crosswalk totals, active-booking invariant (0 duplicates), pending conflict count, side-effect baseline. Then the human pass (checklist 3.2): admin calendar, three sample tours, one guide portal, בקרה screen, exceptional queue. Then the first-week watch (checklist 4.4).

## 8. Manual actions — Owner

1. Decide the evening; announce the stop (1.1).
2. Turn off Airtable automations + Make.com scenarios (1.2).
3. Approve Hash B populations (2.3) — the sign-off moment.
4. Joint UI verification (3.2).
5. Approve lifting the calendar hold (3.3) — the irreversible line.
6. Generation-collision review: trim/adopt per template collision (4.1).
7. Set Pipedrive + Airtable to read-only; team announcement (4.3).
8. At leisure: resolve `cutover:` conflict rows in the exceptional queue.

## 9. Actions Claude performs (commands, with you watching)

Preflight · Final Snapshot + verify · identity delta (dry, then execute) · cutover plan ×2 (Hash B) · Railway env changes on request (Woo bulk off, calendar hold on/off) · cutover execute · post-run verification queries · any reconciliation queries you ask for during the first week.

## 10. GOS as the single source of truth

After 4.3, every business object lives exactly once: tours (past = frozen history with evidence, future = operational GOS rows), deals (24,358 legacy + native, one orderNo space), identity (crosswalked, deduplicated), payroll (frozen evidence for the past, GOS engine as sole generator going forward), calendar (GOS-owned events, dirty-flag reconciled), registrations/bookings (seat SSOT with the one-active-per-deal invariant enforced by the database). Airtable and Pipedrive remain read-only archives; Snapshot #1 + the Final Snapshot + LegacyRecord/MigrationDecision are the permanent audit trail. **GOS is the operating system of record.**

---

### Remaining work summary

- **Development: zero.** All cutover code paths exist, are tested (1,690+ suite green), and the preflight validates the live state end-to-end.
- **Operational:** the checklist itself, plus two Railway env toggles (Woo bulk off; calendar hold on→off) and the owner's manual steps in §8.
- **Business decisions: zero pending before cutover.** Decisions that arise DURING cutover by design: Hash B approval, calendar release, per-collision template review, and any seeded conflicts (never blocking).
- Post-cutover backlog (unchanged, not cutover-scoped): review-queue backlog, timeline slice, collection slice, gated files slice, Review Center retirement.
