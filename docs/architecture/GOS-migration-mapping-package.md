# GOS — Migration Mapping Package (M3 draft — owner-approval gate)

**Status:** Mapping specification DRAFT built from verified audit data (M1 + M1b). Nothing here is
implemented: no schema change, no `LegacyRecord`, no extraction, no destination writes, no
rehearsal import. This document is the approval gate before any of those.
**Inputs:** `GOS-migration-M1-deep-audit.md` (+ M1b corrections), `GOS-migration-external-readiness-audit.md`,
`GOS-migration-readiness-audit.md`, `GOS-legacy-migration-preparation-plan.md` (rehearsal→delta→cutover model §1.7).
**Finalized owner rules honored:** no new business entities; one-time project (no import
framework); Audit → Mapping → Snapshot → Dry Run → Validation → Production.
**Last updated:** 2026-07-14

---

## 0) Populations (verified)

| Source population | Count | Migration goal |
|---|---|---|
| Pipedrive deals — accessible total | **24,356** (4,908 non-archived + 19,448 archived; extract with `archived_status=all`) | A (active subset) + B |
| — operationally active (Tier 2, pending owner) | 699 (+ 8 archived-open pending review) | **A** |
| — with product lines | 15,639 | line-snapshot preservation |
| Pipedrive persons | 32,470 − 3,193 New-Contact spam = **29,277** | A (linked) + B |
| Pipedrive organizations | 2,905 (169 dup clusters → Org+Unit review) | A + B |
| Airtable main base — סיורים / משתתפים | 2000+ each; **94 future tours (100% deal-linked)** | A (future) + B (history) |
| Airtable legacy base | 16 tables | archive-only (passwords table excluded) |
| Genuinely unrecoverable deals | ~1,945 (verified id holes) | honestly out of scope |

## 1) Identity spine — Organizations & Units

| Source (Pipedrive Organization) | GOS target | Disposition |
|---|---|---|
| `name` | `Organization.name` | map (trim only) |
| `address` | `Organization.address` | map |
| `ח.פ/עוסק מורשה` (custom) | `Organization.taxId` | map |
| `iCount_id` (custom) | crosswalk/archive (GOS derives iCount customers; never dual-write) | archive |
| `סוג העסק` (custom enum) | `Organization.organizationTypeId` via mapping table onto the 7 live `OrganizationType` rows (חברות וארגונים / בתי ספר / חברות הפקה / עמותות / קיבוצים / סוכנויות תיירות / אוניברסיטאות) | map (owner confirms the enum→type table in review) |
| `איש כספים`, `למי לשלוח חשבוניות`, payment terms/method (custom) | `Organization.financeContactName/…` + note | map where clean, else archive |
| everything else (owner, visibility, counts, automation plumbing) | Legacy Archive | archive |

**Dedup flow (per the Org+Unit review report):** tax-id clusters auto-merge (2); the 169
name clusters go through the owner review queue **highest-deal-count first**; confirmed
institutional clusters (בנק לאומי ×10 …) collapse to **one `Organization` + one
`OrganizationUnit` per branch/department**, and each deal re-points to the right Org (+Unit where
determinable from the deal's contact/branch context; else Org only). Never auto-merge on name.

## 2) Identity spine — Contacts

| Source (Pipedrive Person) | GOS target | Rule |
|---|---|---|
| `first_name` / `last_name` | `firstNameHe`/`firstNameEn` + `lastNameHe`/`lastNameEn` | **per-field script classification** (Hebrew→He, Latin→En; fields may split across languages; whitespace trim only). Mixed/ambiguous (small, post-spam) + missing-first (≤1,177) → review queue, never silent transformation |
| `phone[]` | `ContactPhone` rows — **raw value stored verbatim**, label preserved | normalization is compare-only (rules R0–R8, M1b §2b). Same-person duplicate formats (+972…/05…) collapse to one row keeping the raw primary + archiving the variant |
| `email[]` | `ContactEmail` rows | verbatim, lowercased for compare only |
| `תעודת זהות` (custom) | `Contact.taxId` | map |
| org membership | `ContactOrganization` | map via resolved (deduped) Organization |
| **New Contact spam (3,193)** | **EXCLUDED** — no Contact rows, no placeholders | rule `/^new contact\b/i`; aggregate count preserved in the migration report; 1 exceptional record (person 23960) → owner |
| owner, marketing fields, WhatsApp-link plumbing | Legacy Archive | archive |

**Dedup groups (M1b §2c, measured):** 647 safe-auto (merge, logged) · 363 strong-probable (owner
confirms in queue) · 141 ambiguous (owner decides) · shared numbers >2 contacts never auto-merge.
Email is the secondary signal (used as support/conflict evidence). Existing **live GOS contacts
always win**; legacy values that differ attach as archive.

## 3) Deals

| Source (Pipedrive Deal — BOTH populations) | GOS target | Rule |
|---|---|---|
| `title` | `Deal.title` | map |
| `value`, `currency` | `Deal.valueMinor` (BigInt agorot) + `currency` | map (float→minor units) |
| `status` open/won/lost | `Deal.status` | map |
| `won_time` / `lost_time` | `wonAt` / `lostAt` | map |
| `lost_reason` | `lostReasonId` via mapping onto the 14 live `LostReason` rows (+`lostNotes` for unmapped text) | map |
| `stage_id` | `dealStageId` via the stage-mapping table (§3a) | map |
| `add_time`/`update_time` | `createdAt`/`updatedAt` (explicit) | map — timestamps preserved |
| person/org links | `DealContact` (roles default) + `organizationId` (deduped) | map |
| `מקור-רשימה סגורה` / `מקור` (custom) | `dealSourceId` (18 live `DealSource` rows overlap heavily) + free-text `source` | map |
| `תאריך הסיור`/`שעת הסיור`/`כמות משתתפים`/`שפת…` (custom) | `tourDate`/`tourTime`/`participants`/language fields | map (working fields) |
| `מס הזמנה מהאתר`, `cal_event_id`, `last_doc_id` | crosswalk keys (reconciliation to Booking/GCal/IcountDocument) | crosswalk + archive |
| `תיקייה בדרייב` | read-only Drive-folder link on the deal (validated: folder / Photos album / invalid) | map-as-reference; **contents never copied** |
| owner (`user_id`) | `ownerUserId` label mapping (historical users → name labels; current admins → their ids) | map-lite + archive |
| ~45 automation-plumbing custom fields | Legacy Archive | archive |
| `orderNo` | **auto-assigned by GOS sequence is WRONG for imports** — historical deals must not consume the @27000 customer-facing sequence | owner decision D-4 (recommend: no orderNo for pure-history; display legacy Pipedrive id from crosswalk) |

### 3a) Stage mapping proposal (Pipedrive → live GOS `DealStage`)

GOS live stages: `lead` ליד חדש · `contacted` שיחה מרכזית · `quote` הצעת מחיר · `negotiation`
פולואפ/מו"מ · `stage_a88c9186` הסכמה לסגירה · `closing` סגירה.

| Pipedrive stage | → GOS stage |
|---|---|
| p1 ליד נכנס / p2 התקבלה פנייה | `lead` |
| p1 התקיימה שיחה משמעותית | `contacted` |
| p1 נשלח מידע נוסף / p2 נשלחה הצעה | `quote` |
| p1+p2 פולואפ 1/2, בהמתנה, p2 שינוי תאריך | `negotiation` |
| p2 ממתין לאישור שלנו | `stage_a88c9186` (הסכמה לסגירה) |
| p2 הזמנה מאושרת | `closing` |
| p3 גבייה (663 won / 2 lost) | terminal `won`/`lost` + last stage archived; collection state belongs to GOS Collection (derived from iCount), never re-modeled |
| p5 שוברי מתנה (8 won) | `closing` + archive label (voucher context in archive) |
| **Historical (won/lost, incl. all archived)** | status carries the truth; recommend stage = mapped-where-clean else `closing`, with the original pipeline+stage always in the Legacy Archive. Alternative (owner call): one seeded inactive "ארכיון-ייבוא" stage |

### 3b) Historical pricing lines (per finalized owner rule)

For all **15,639** deals with product lines, preserve BOTH layers as a **read-only historical
snapshot attached to the deal** (never the live Pricing Builder):

- **Structured:** line name, quantity, unit price, line total, discount, currency, tax +
  tax_method, original line ordering — all verified 100%-present.
- **Verbatim text:** the line `comments` HTML **exactly as stored** (raw in archive; sanitized
  via the standard sanitize-html path for display), rendered beneath its line.
- Display contract: original wording → qty × unit-price math → line total → discount/tax → note.
- The raw `/deals/{id}/products` payload additionally lands in the Legacy Archive.
- Exact storage shape (JSON-on-deal vs thin read-only table) = the ONE remaining modeling choice,
  decided with `LegacyRecord` design (both satisfy the contract; neither touches pricing logic).

## 4) Activities, notes, files, emails

| Source | GOS target | Rule |
|---|---|---|
| Open activities on Goal-A deals | `Task` (dueDate from activity; type via the 24 activity-types → 5 live `TaskType` mapping, default `follow_up`) | map |
| Open activities NOT on a deal / outside Goal A | `TimelineEntry` on contact/org, or drop-to-archive | owner decision D-6 |
| Done activities (historical) | `TimelineEntry` (kind per type, `actorType='import'`, original timestamps) | map (Goal B) |
| Notes (deal/person/org) | `TimelineEntry` kind `note` (rich HTML body, sanitized; raw in archive) | map |
| Files | Goal A deals → `DealFile` (R2, private); Goal B → owner decision D-7 (import-all vs list-only) | partial |
| Pipedrive email threads | archive-only (Gmail via GOS Email module is the canonical mail archive) | archive |
| New-Contact spam auto-activities (535 open + 3,049 done) | excluded with their spam persons | drop (counted) |

## 5) Airtable operational data (main base)

| Source | GOS target | Rule |
|---|---|---|
| `סיורים` future rows (94) | `TourEvent` (kind by סוג לקוח/פעילות; date/time; language; `Location` via city mapping onto the 7 live locations) | map — **Goal A** |
| `סיורים` historical rows (2000+) | `TourEvent` status `completed`/`cancelled` (Goal B) or archive-only | owner decision D-8 |
| `משתתפים` rows with `פייפ דיל ID` | `Booking` (Deal↔TourEvent) + `TicketRegistration` (seats) + contact linkage | map (the verified spine) |
| Guide assignment columns (`מדריך ששובץ` …) | `TourAssignment` via PersonRef resolution (staff SSOT incl. former staff) | map |
| `מעקב תשלומים`, `שכר`, `סיכומי סיור`, `רשימת מסרים` | Legacy Archive (GOS already owns collection/payroll/questionnaires/messaging) | archive |
| Products/pricing/quote-section/guide tables | Legacy Archive (GOS catalogs are SSOT) | archive |
| Drive/Photos link fields | validated link references on the TourEvent (folder / photos-album / invalid classes); contents never copied | map-as-reference |
| Formula/rollup/lookup fields (214) | never migrated (derived) | drop (raw stays in snapshot) |

**Legacy base:** archive-only; `גישה, סיסמאות` excluded from extraction entirely; `ניסוחים`
templates optionally seeded into Shared Content (owner decision D-9).

## 6) Mechanics (already locked; restated for approval completeness)

Snapshot-first into the private `gos-migration-snapshots` bucket (extraction always
`archived_status=all`); crosswalk keys on every migrated row via the central `LegacyRecord`
(sourceSystem/sourceType/sourceId unique, batch-id rollback until cutover); idempotent out-of-band
load scripts; rehearsal → live-operation → delta (`update_time` / `/recents` on Pipedrive incl.
archived; id-diff re-snapshot on Airtable) → reconciliation → cutover; `TimelineEntry.actorType='import'`
provenance; original timestamps preserved; Make.com scenario inventory before cutover.

## 7) Verification contract (per phase)

Counts per entity type source↔GOS; value sums (deal totals, line sums) source↔GOS; spot samples
(N=50/entity) field-by-field; dedup ledger (every merge logged: winner, loser, evidence); exclusion
ledger (spam count, review outcomes); timestamp fidelity assertions; 94-future-tour full
reconciliation (deal↔booking↔tour↔assignment). No phase is "done" without its report.

## 8) Execution order (unchanged from the plan, now concrete)

1. Owner approves this package (decisions §9). 2. `LegacyRecord` schema slice (additive). 3.
Snapshot #1 → rehearsal import of the identity spine + Goal A (dry-run DB or tagged batches). 4.
Review queues (org clusters, contact dedup, name-language exceptions). 5. Verification reports.
6. Freeze → delta → final reconciliation → cutover. 7. Goal B historical backfill (24,356 deals,
15,639 line snapshots, notes/activities, historical tours). 8. Decommission per plan M9.

## 9) Product-owner decisions required (complete consolidated list)

| # | Decision | Recommendation |
|---|---|---|
| D-1 | Operationally-active tier | **Tier 2 = 699** + glance at the 8 archived-open deals |
| D-2 | Stage-mapping table §3a | approve as proposed; pick the historical-stage option (mapped-stage vs seeded ארכיון stage) |
| D-3 | Historical amounts | already resolved: line-snapshot preservation per §3b |
| D-4 | `orderNo` for imported deals | **no orderNo for historical**; display legacy id; Goal A actives MAY receive orderNo at cutover |
| D-5 | Contact scope | import all 29,277 non-spam contacts (history hangs off them) vs only deal-linked; **recommend all** |
| D-6 | Open activities not on Goal-A deals | recommend: contact/org timeline entry |
| D-7 | Goal B files | import-all to R2 (bytes unknown until extractor measures) vs metadata-only |
| D-8 | Historical Airtable tours | structured `TourEvent`s (recommended — enables tour history per customer) vs archive-only |
| D-9 | Legacy-base `ניסוחים` templates | seed into Shared Content? y/n |
| D-10 | Google Photos album links | keep as read-only links on deals/tours (recommended) vs ignore |
| D-11 | Dedup queues | confirm the 647 safe-auto merges run automatically; who works the 363+141 review queue |
| D-12 | Exceptional New Contact person 23960 | keep excluded (deal migrates anyway)? |
| D-13 | No-first-name contacts (≤1,177 after spam overlap) | rule: promote last→first / phone-as-display / archive-only |
| D-14 | Org enum→OrganizationType mapping + top org clusters | worked through the Org+Unit review report |
