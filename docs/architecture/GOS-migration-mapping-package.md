# GOS — Migration Mapping Package (v2 — owner decisions incorporated)

**Status:** Mapping specification updated with the recorded owner decisions
(`GOS-migration-decision-workshop.md`). Nothing implemented: no schema change, no `LegacyRecord`,
no extraction, no destination writes, no rehearsal import, no Review Center code.
**Open items:** §3a stage table approval + §9/§10 Review Center & archive-access approval.
**Last updated:** 2026-07-14

---

## 0) Populations & scope (final)

- **Everything accessible migrates: all 24,356 deals** (4,908 non-archived + 19,448 archived;
  extraction always `archived_status=all`), all 29,277 non-spam contacts, all 2,905 orgs
  (pre-dedup), all historical tours, **all files** (after the pre-copy report), all notes/
  activities/documents.
- **Tier 2 (699 deals) is only the day-one ACTIVE view** — which deals appear as live work at
  cutover. It is a visibility cut, not a migration cut.
- **Future-relevance override:** any deal with genuine future operational relevance joins Goal A
  regardless of Pipedrive status. Applied: the 5 open gift-voucher deals (in the active set);
  the 8 archived-open deals → Exceptional-records queue for a per-deal call.

## 1) Identity spine — Organizations & Units

Field mapping unchanged (name/address/taxId/type/finance → GOS fields; plumbing → archive), plus:

- **Legacy ID continuity (Decision 6):** every migrated Organization carries its Pipedrive org id
  as a first-class visible, searchable reference (displayed on the record; legacy-id lookup
  supported). Internal PKs remain GOS-native.
- **Dedup runs through the Migration Review Center → Organizations tab** (§9): per cluster —
  candidates, proposed canonical, proposed Units, linked deals, linked contacts, confidence;
  actions Approve / Reject / Edit / Merge-into-other / Create-Unit. The 2 tax-id clusters arrive
  pre-marked "safe" but flow through the same queue (one approval flow, no side channel).
- `סוג העסק` enum → the 7 live `OrganizationType` rows: proposed table appears in the Stage-
  mapping/config tab for one-click approval.

## 2) Identity spine — Contacts

Field mapping unchanged (per-field He/Latin name classification; phones raw + compare-only
normalization R0–R8; emails; national id; org links; spam excluded), plus:

- **Legacy ID continuity (Decision 6):** Pipedrive person id displayed + searchable on every
  migrated contact.
- **Name cleanup is Option C (Decision 5):** no silent moves. Contacts whose names need
  restructuring (~1,177 missing-first + the small mixed/ambiguous remainder) go to the Review
  Center → Name-cleanup tab: original values, proposed first/last/language split; owner
  approves / edits / rejects per record (batch approve available for identical patterns).
- **Duplicates (Decision 4 method):** Review Center → Contact-duplicates tab. The 647 safe pairs
  arrive pre-marked with high confidence (bulk-approvable in one action), 363 probable + 141
  ambiguous follow with full evidence (phones masked-unmasked toggle, emails, orgs, deal history,
  WhatsApp presence). Live-GOS contacts always win on conflict.

## 3) Deals

Field mapping unchanged (title, money→minor units, status, won/lost times, source, working
fields, crosswalk fields, Drive link reference, owner labels, plumbing→archive), plus:

- **orderNo (Decision 6, APPROVED):** imported deals keep their Pipedrive id as `orderNo`
  (8–26,306 < 27,000 — collision-free; URLs and business continuity preserved). New deals
  continue the 27000+ sequence.

### 3a) Stage mapping — COMPLETE table with measured volumes (⏳ awaiting approval)

Target: the **single merged GOS sales pipeline** (the deliberate GOS improvement) — stages:
`lead` ליד חדש · `contacted` שיחה מרכזית · `quote` הצעת מחיר · `negotiation` פולואפ/מו"מ ·
`stage_a88c9186` הסכמה לסגירה · `closing` סגירה.

| Pipedrive stage (pipeline) | Volume (open/won/lost) | → GOS stage |
|---|---|---|
| ליד נכנס (מכירות) | 8,212 (37/1,195/6,980) | `lead` |
| התקבלה פנייה (עסקיים) | 241 (12/4/225) | `lead` |
| התקיימה שיחה משמעותית (מכירות) | 1,140 (0/149/991) | `contacted` |
| נשלח מידע נוסף (מכירות) | 509 (0/124/385) | `quote` |
| נשלחה הצעה (עסקיים) | 227 (3/1/223) | `quote` |
| פולואפ 1 / פולואפ 2 (מכירות) | 2,503 + 5,469 | `negotiation` |
| נשלח פולואפ 1 / 2 (עסקיים) | 124 + 808 | `negotiation` |
| בהמתנה (מכירות) / לא לשלוח פולואפים (עסקיים) | 851 + 438 | `negotiation` |
| שינוי תאריך - לאישור לקוח (עסקיים) | 4 (0/4/0) | `negotiation` |
| ממתין לאישור שלנו (עסקיים) | 36 (1/0/35) | `stage_a88c9186` הסכמה לסגירה |
| הזמנה מאושרת (עסקיים) | 857 (0/91/766) | `closing` |

**Collection pipeline (לקוחות עסקיים - גבייה) — per the owner's rule, NOT a sales pipeline:**

| Collection stage | Volume | Treatment |
|---|---|---|
| יצאה קבלה (final = fully paid) | 2,521 (2 open / 2,513 won / 6 lost) | deal → `closing`, **fully paid — nothing owed**; the 2 open + 6 lost oddities → Exceptional-records queue |
| ממתין לתשלום (below final) | **24 (all won, none archived)** | deal → `closing` + **flagged UNPAID in the GOS Collection module** |
| all other collection stages | 0 | — |

*Design note (mechanical, presented at implementation): GOS Collection derives from iCount
documents; the 24 unpaid imports surface via an imported outstanding-balance marker so the
Collection screen lists them without faking iCount documents.*

**Gift Cards (שוברי מתנה) — 49 deals (5 open / 14 won / 30 lost):** all → `closing`, voucher
context preserved (label + archive). The 5 open = purchased-awaiting-redemption → remain open
deals in the active view (Goal A override).

**Long-term Follow-up (לפלואפ רחוק) — 341 deals, 100% lost + archived:** pure history →
status `lost`, stage `negotiation` (they died in follow-up limbo), original stage always in the
legacy record.

**Historical closed deals in general:** mapped stage per this table; original pipeline+stage
always preserved on the deal's legacy record.

### 3b) Historical pricing lines (final, unchanged)

Read-only snapshot per deal (15,639 deals): structured values (name/qty/unit/total/discount/
currency/tax/ordering) + **verbatim line comments** (HTML preserved raw, sanitized for display,
rendered beneath the line). Never in the live Pricing Builder. Raw payload in Legacy Archive.

## 4) Activities, tasks & the native Timeline (Decisions 7a + 8)

- **Open tasks:** on **lost** deals (127) → Timeline history only. On **archived** deals
  (deliberately shelved) → Timeline history. On non-archived open/won deals → **real Tasks**
  (mapped onto the 5 live TaskTypes, default `follow_up`). Active work is never converted to
  history.
- **Native-history contract (Decision 8):** a migrated deal's Timeline reads as if GOS always
  existed — done activities (typed events), notes (rich HTML), **stage-change history**
  (Pipedrive per-deal change log is extractable → `kind='change'` entries matching the GOS
  changelog convention), file-attach events, document events (iCount references), won/lost
  transitions — all with original timestamps, `actorType='import'` provenance, original actor
  names as labels.
- Pipedrive email threads: archive-only (Gmail in GOS is the mail record).
- Spam-linked auto-activities: excluded with their spam persons.

## 5) Airtable operational data (final)

- **All historical tours become real `TourEvent`s** (Decision 3b) + Bookings/TicketRegistrations
  via the verified `פייפ דיל ID` spine; guides → TourAssignments via staff SSOT; 94 future tours
  = Goal A.
- מעקב תשלומים / שכר / סיכומי סיור / מסרים / catalogs → Legacy Archive (GOS owns those domains).
- Drive/Photos links: validated references on the records (Decision 7b), contents never copied.
- Legacy base: archive-only; ניסוחים templates NOT seeded (Decision 7c) — browsable via §10.

## 6) Files (Decision 3c — approved with gate)

All Pipedrive deal files copy into GOS storage (private R2, DealFile contract) — **after** a
mandatory pre-copy report: total size, unusually large files, broken/zero-byte files,
inaccessible files. The report is a go/no-go checkpoint, not a formality.

## 7) Verification contract (unchanged)

Counts + sums + spot samples per entity; dedup ledger; exclusion ledger; timestamp fidelity;
full future-tour reconciliation; per-phase reports.

## 8) Execution order (updated)

1. Owner approves §3a + §9/§10 (the two open items). 2. `LegacyRecord` + migration-decision
schema slice (additive). 3. **Build the Migration Review Center** (temporary module). 4.
Snapshot #1 → rehearsal import into review state. 5. Owner + staff resolve the Center's queues
(gate: required queues resolved before loads finalize). 6. Verification reports. 7. Freeze →
delta → final reconciliation → cutover. 8. Goal B backfill completes (it's the same import —
history loads with the rehearsal). 9. Center deleted; archive browser + legacy panels remain.
10. Decommission per plan.

## 9) Migration Review Center — evaluation & recommendation (⏳ awaiting approval)

**Owner's question:** one temporary Review Center vs several isolated review tools — evaluated
honestly:

**Recommendation: ONE Migration Review Center.** Reasons (genuine, not deference):
1. **The shared plumbing IS most of the work.** Queue lists, evidence panels, decision actions,
   a persisted decision ledger, progress tracking, batch operations — identical needs across
   every review type. Separate modules build this 4-6×; one center builds it once.
2. **One temporary boundary.** "Temporary" is only credible if deletion is trivial: one route,
   one client area, one server namespace — deleted wholesale after cutover. Five scattered
   modules = five removal risks.
3. **The gating rule needs a single authority.** "Migration proceeds only when every required
   queue is resolved" is one progress computation in one place; spreading it across modules
   invites inconsistency.

**Two honest consolidations to the proposed tab list:**
- **"Contacts" + "Phone duplicates" = one tab.** Phone evidence IS the contact-duplicate signal —
  two tabs would show the same records twice.
- **"Units" folds into the Organizations tab.** Creating a Unit is an *action inside* an
  organization-merge decision (that's where the context lives); a standalone Units tab would
  strip it of the cluster context.

**Resulting tabs (6):** ① Organizations (merges + canonical + Units) · ② Contact duplicates ·
③ Name cleanup · ④ Stage & config mapping (the §3a table + org-type enum table as approvable
config, not per-record) · ⑤ Exceptional records (8 archived-open, person 23960, 2 open+6 lost
collection rows, unresolvable phones/links) · ⑥ Legacy archive browser (§10).

**Caveats (the honest cost):**
- Scope discipline: tabs are hardcoded for THIS migration — no generic "review platform"
  configurability. Any temptation to generalize is a violation of the one-time rule.
- Each tab needs its own evidence renderer (different data shapes) — the center shares the
  spine, not the panels; this is real per-tab work, just less than five full modules.
- Decisions persist in migration-scoped ledger tables (designed with the `LegacyRecord` slice),
  so deleting the Center's UI/routes later loses nothing — the decision audit survives.

## 10) Archive accessibility (Decision 7c — proposal, ⏳ awaiting approval)

Archived material must be reachable without reading JSON:

1. **Permanent per-record panel — "מידע ממערכת קודמת".** On every migrated Deal / Contact /
   Organization / Tour: a collapsed section rendering the entity's archived legacy fields as
   readable label → value pairs (Hebrew field names as they were), including original pipeline/
   stage, owner name, legacy ids, unmapped custom fields. Read-only, loaded on demand. This
   panel is small, permanent, and is the honest answer to "where did this deal come from".
2. **Read-only legacy-archive browser.** During migration: tab ⑥ of the Review Center. After
   cutover: a small read-only screen (admin settings area) for NON-entity material — the ניסוחים
   templates, legacy catalogs, obsolete-field reference — searchable by table/name. The Review
   Center is deleted; this browser (a thin read-only list+viewer) is retained.
3. Raw snapshots in R2 remain the deep-forensics layer (rarely needed once 1+2 exist).

## 11) Decision register (final state)

| Decision | Status |
|---|---|
| D1 active scope (Tier 2 = day-one view; all 24,356 migrate; future-relevance override) | ✅ approved |
| D2 stage mapping | ⏳ **table above awaits approval** |
| D3 pricing lines read-only | ✅ (owner rule) |
| D3a/b/c contacts / tours / files (files gated on pre-copy report) | ✅ approved |
| D4 org cleanup via in-GOS review | ✅ approved (Center tab ①) |
| D5 name cleanup Option C | ✅ approved (Center tab ③) |
| D6 legacy ids (deals orderNo + org/contact visible ids) | ✅ approved |
| D7a tasks (lost/archived → history; active → Tasks) | ✅ approved |
| D7b links only | ✅ approved |
| D7c archive-only + accessible presentation | ✅ approved; §10 presentation ⏳ |
| D8 native Timeline (incl. stage-change history) | ✅ approved |
| Review Center (single center) | ⏳ **recommended, awaits approval** |
