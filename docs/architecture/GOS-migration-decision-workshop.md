# GOS Migration — Product-Owner Decision Workshop (RESOLVED)

**Status:** Decisions recorded 2026-07-14 from the product owner, with adjustments. This document
is the binding record; the mapping package (`GOS-migration-mapping-package.md`) reflects it.
**Remaining open items:** exactly two — see the end of this document.

---

## Already decided (unchanged)

Historical pricing read-only (wording + math) · "New Contact" spam excluded · phone originals
never altered, matching via safe copies, foreign never auto-repaired · Drive links kept, contents
stay in Drive · legacy Airtable base archived (passwords never copied) · archived deals included
in extraction · rehearsal → delta → cutover · private snapshot bucket.

---

## Decision 1 — Active operational scope ✅ APPROVED (with adjustment)

**DECISION:** Tier 2 (699 deals) defines the **day-one active view**. Adjustments:
- **ALL 24,356 accessible deals migrate eventually** — Tier 2 is a visibility/priority cut, not
  a migration cut.
- **Override rule:** any deal with genuine future operational relevance belongs to Goal A even
  if its Pipedrive status would exclude it. Applied so far: the 5 open gift-voucher deals
  (purchased, awaiting redemption) are already inside the active set; the 8 archived-open deals
  go to the Exceptional-records review queue for a per-deal call.

## Decision 2 — Pipeline/stage mapping ⏳ NOT YET APPROVED — table now complete

**Owner rulings recorded:**
- Pipelines "מכירות גרפיטיול" + "לקוחות עסקיים" merge into the **single GOS sales pipeline**
  (deliberate GOS improvement).
- "לקוחות עסקיים - גבייה" is **NOT a sales pipeline** — it is unpaid customers. Every imported
  deal in it **below the final stage (יצאה קבלה = fully paid)** must appear in the **GOS
  Collection module as unpaid**. Never recreated as a pipeline.
- Gift Cards / Long-term Follow-up: decide after seeing volumes.

**Volumes (now measured, full population incl. archived):**
- Collection pipeline: **יצאה קבלה 2,521** (fully paid — nothing owed) vs **ממתין לתשלום 24**
  (all won, none archived — live unpaid customers → Collection module). All other collection
  stages: empty. Oddities: 2 open + 6 lost rows → Exceptional-records queue.
- **Long-term Follow-up: 341 deals — 100% lost, 100% archived.** Pure history.
- **Gift Cards: 49 deals — 5 open (awaiting redemption → Goal A), 14 won, 30 lost.**

The complete stage-by-stage table with these volumes is in the mapping package §3a —
**awaiting the owner's approval** (remaining item #1).

## Decision 3 — Historical records ✅ APPROVED

**DECISION:** 3a import **all contacts** · 3b import **all historical tours** · 3c import **all
files** — with a mandatory **pre-copy file report** (total size, unusually large files, broken
files, inaccessible files) before any copying runs.

## Decision 4 — Organization cleanup ✅ APPROVED (method changed)

**DECISION:** No spreadsheets/CSV. A **temporary review experience inside GOS** presents each
proposed organization merge with: candidate organizations, proposed canonical organization,
proposed Units/Departments, linked deals, linked contacts, confidence score. Actions: Approve /
Reject / Edit / Merge into another organization / Create additional Unit. Migration-only tooling,
not a permanent feature. → Implemented as a tab of the **Migration Review Center** (see below).

## Decision 5 — Contacts without names ✅ APPROVED (Option C)

**DECISION:** No silent name moves. A temporary review queue shows original data, the proposed
split (first name / last name / language fields); owner approves, edits, or rejects each.
→ A tab of the Migration Review Center.

## Decision 6 — Legacy IDs ✅ APPROVED (extended)

**DECISION:** Imported deals keep their original Pipedrive numbers (8–26,306; no collision with
the GOS sequence at 27,000+). **Extended:** Organizations and Contacts also keep their Pipedrive
IDs as first-class, visible, searchable references (GOS orgs/contacts have no numeric public id,
so the legacy id is displayed on the record and searchable; legacy-id lookup URLs supported).
New GOS-created entities continue the new numbering untouched.

## Decision 7 — Historical cleanup ✅ APPROVED (7a modified)

- **7a:** Tasks on **LOST deals → Timeline history only** (127 deals measured). Tasks on **active
  operational deals stay real Tasks**. Refinement adopted (same spirit): open tasks on
  **archived** deals (deliberately shelved) also become history — archived work is not active
  work. Non-archived open/won deals with open tasks keep real Tasks.
- **7b:** Approved — Drive + Google Photos links only; contents never copied.
- **7c:** Archive-only approved, **with accessible presentation** (not hidden JSON). Proposal in
  the mapping package §10: a permanent per-record "מידע ממערכת קודמת" panel (rendered
  label→value) + a small read-only legacy-archive browser for non-entity material (templates
  etc.). — awaiting approval as part of remaining item #2.

## Decision 8 — Historical Timeline ✅ APPROVED (new)

**DECISION:** History must feel native. A 2019 deal opened in GOS should read as if it always
lived there: notes, activities, **stage changes** (Pipedrive keeps per-deal change history —
extractable), files, historical documents, relevant events — all as natural Timeline entries
with their original timestamps and the standard import provenance.

## Architectural request — ONE Migration Review Center ✅ EVALUATED, RECOMMENDED

Honest evaluation in the mapping package §9. Verdict: **a single temporary Migration Review
Center is architecturally cleaner** than separate modules — with two consolidations to the
proposed tab list and clear caveats. Awaiting owner sign-off (remaining item #2).

---

## Remaining product-owner decisions (only these)

1. ~~Stage-mapping table~~ — ✅ **APPROVED 2026-07-14** (final 25-row table, one row per legacy
   stage, presented and accepted). **THE MIGRATION SPECIFICATION IS NOW FROZEN.**
2. ~~Migration Review Center + archive access~~ — ✅ **APPROVED 2026-07-14**, with a binding UX
   refinement: the primary experience is a normal **"מידע ממערכת קודמת" card** on every migrated
   entity (clean label→value: Pipedrive owner, legacy stage, meaningful custom fields, pricing
   notes, Drive links — no JSON, no raw payloads, no ids), plus a **"View complete legacy
   archive"** action for the full preserved record. The generic browser is secondary (Center tab
   during migration; small read-only screen for non-entity material afterward).

Later checkpoints (not decisions now): the file-size report go/no-go before copying (3c), the
review-queue items themselves (inside the Center), and the final cutover go/no-go.

**Upon approval of item 1, the migration specification is FROZEN and implementation begins.**
