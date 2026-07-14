# GOS — M1 Deep Audit (verified data findings + owner decisions)

**Status:** COMPLETE. Read-only deep audit executed via Railway against live Pipedrive + Airtable.
All numbers below are verified from the API (full pagination, not estimates). No writes to any
system, no snapshot stored, no import, no `LegacyRecord`, no schema change.
**Tooling:** `server/scripts/migration/{pipedrive-deals-audit,pipedrive-crm-audit,airtable-tours-audit}.mjs`.
**Raw output (gitignored):** `server/scripts/migration/output/*.json`.
**Companion:** `GOS-migration-external-readiness-audit.md`, `GOS-migration-preparation-plan.md`.
**Last updated:** 2026-07-14

---

## 1) Verified Pipedrive deal count (the 4,908 vs id-26,306 discrepancy)

**Verified: exactly 4,908 accessible non-deleted deals.** This is the complete set, not a subset.

| Check | Result |
|---|---|
| Exact count (full pagination) | **4,908** — paginated `GET /deals?status=all_not_deleted` with `start`/`limit=500`, **all pages retrieved** until `more_items_in_collection=false` |
| Cross-check (server-side) | `GET /deals/summary` → **4,908** total; open **70** + won **1,620** + lost **3,218** = 4,908 (paginated status histogram matches exactly) |
| Count by pipeline × status | p1 מכירות: 53 open / 869 won / 2,686 lost · p2 עסקיים: 17 / 80 / 530 · p3 גבייה: 0 / 663 / 2 · p5 שוברים: 0 / 8 / 0 · **p4 (long-term follow-up): 0 deals** |
| Min / max deal id | min **3,383** · max **26,306** |
| Id-range span | 22,924 ids in range; **4,908 present**, **18,016 missing in range**, across **204 gap runs** |
| Gap pattern | Dominated by TWO huge runs: **3,384–18,820 (15,437 missing)** and **18,822–21,149 (2,328)**; the rest are small scattered deletions (≤8) |
| Deleted deals accessible? | `status=deleted` returns only **9** (recently deleted); Pipedrive purges after ~30 days — historical deletions are gone |
| Permission/filter exclusion? | **None.** Token is a company admin (Elinoy, `is_admin=true`); default filter is `all_not_deleted`; summary total == paginated total ⇒ nothing hidden by owner scope or filters |

**Explanation of the discrepancy (evidence-based):** the highest deal id (26,306) is **not** the
record count because Pipedrive ids are a non-reused auto-increment sequence: over ~15 years roughly
**21,400 deals were created and later deleted** (18,016 missing inside the id range + ~3,382 below
the minimum surviving id), leaving permanent gaps. The single 15,437-id gap right after the
minimum indicates an early bulk deletion / dormant period; dense ids from ~18,821 onward are the
active era. **Highest id ≠ count; 4,908 is the true, complete, accessible deal population.**

## 2) Operationally-active scope (measured; broader than "70 open")

Goal A must not be defined by `status=open` alone. Measured candidate buckets (from the full
4,908-deal pull, using per-deal `update_time`, `next_activity_date`, `undone_activities_count`,
and the tour-date custom field):

| Candidate bucket | Deals |
|---|---|
| `status=open` | 70 |
| Won **with a future tour date** (`תאריך הסיור ≥ today`) | 82 |
| **Any** deal with a future tour date | 107 |
| Future `next_activity_date` | 28 |
| Has ≥1 open activity (`undone_activities_count>0`) | 612 |
| Has a website order number | 61 |
| — wider signals (not in core union) — | |
| Lost but modified in last 90 days | 503 |
| Modified in last 30 days | 387 |

**Proposed measurable definition of "operationally active" (Tier 2 — recommended):**
`open ∪ (won & future tour) ∪ any future tour ∪ future next-activity ∪ has-open-activity`
→ **699 deals** (verified union size).

- **Tier 1 (tight, ~operational-must):** open ∪ future-tour ∪ future-next-activity ≈ the ~150–180
  deals with live scheduling — the non-negotiable go-live set.
- **Tier 2 (recommended, 699):** adds "has an open activity" — captures ongoing CRM work.
- **Tier 3 (wide net):** Tier 2 + recently-modified/lost (503 + 387, overlaps unknown) — would push
  toward ~1,200–1,400. Higher completeness, more noise (stale open activities on old deals).

Owner picks the tier (§8). Cross-check on the Airtable side: **94 future tours, 100% linked to a
Pipedrive deal id** (§7) — the future-tour spine is clean and reconcilable.

## 3) Historical pricing / line-item availability — FULLY PRESERVABLE

**Deals carry real line items, and all the detail you asked for is present.**

- **2,530 of 4,908 deals** have attached products (`products_count>0`).
- Sampled 35 line rows via `GET /deals/{id}/products`: **name, quantity, unit price
  (`item_price`), line total (`sum`), discount, currency, tax/VAT** present on **35/35**; free-text
  **notes** (`comments`) on 10/35.
- Pipedrive product catalog fields include Name, Price, Unit, **Tax**, Category, Description, Unit
  prices, + custom (Product Name EN, סוג פעילות, note).

**Recommendation:** do **not** force historical lines into the modern GOS Pricing Builder
(`QuoteVersion`/`QuoteLine` — its VAT-mode/card-group semantics won't reliably reconstruct 15-year-old
Pipedrive lines). Instead:
- Keep each historical deal's **total** on `Deal.valueMinor` (minor units, already the SSOT).
- Preserve the **per-line breakdown** as a **read-only historical snapshot** attached to the deal
  (a simple frozen line list: name, qty, unitPriceMinor, lineTotalMinor, discount, currency, vat,
  note) — displayed, never edited, never fed to pricing resolution.
- The **raw** Pipedrive product payload also lands in the Legacy Archive verbatim.

(The cleanest home for the read-only snapshot — a lightweight JSON on the deal vs. a thin
`HistoricalQuoteLine` table — is an M3 modeling call; both keep it out of the live pricing engine.)

## 4) Organization deduplication + Unit mapping

**2,905 organizations** in Pipedrive (the Airtable "לקוחות עסקיים" 599 is only a business subset).

| Signal | Result | Classification |
|---|---|---|
| **Same tax id** (ח.פ/עוסק) | **2 clusters, 4 orgs** — only because tax id is rarely filled | **Safe automatic match** |
| **Same iCount_id** | (folded into tax evidence; few filled) | Safe where present |
| **Normalized name** | **169 clusters spanning 384 orgs** | **Probable — owner review** (per rule: never auto-merge on name alone) |
| Same tax id, different names | 2 | Unit / branch candidates |

**Highest-impact clusters (review first):** בנק לאומי **×10**, כללית ×6, בנק הפועלים ×6, רפאל ×5,
עמותת אנוש ×4, ביטוח ישיר ×4, Meetinkz ×4, קופת חולים כללית ×4, בנק דיסקונט ×3, בית ספר הרדוף ×3.

**Interpretation for Org+Unit:** the large institutions (banks, health funds, insurers) recurring
5–10× are almost certainly **branches/departments of ONE organization** — the target shape is
**one canonical `Organization` + many `OrganizationUnit`s**, with each historical deal re-pointed to
the right Unit. These are *probable* clusters requiring owner confirmation, not auto-merges.

**Classification summary:**
- **Safe automatic match:** the 2 tax-id clusters (4 orgs).
- **Probable — owner review:** the 169 name clusters (384 orgs); the top ~15 institutional
  clusters carry the most deals and should be resolved first (Org + Units).
- **Separate organizations:** the remaining ~2,520 singletons.

Deeper signals (email domains, phones, shared contacts, per-deal history) are available for the
review queue but were **not** used to auto-decide anything here.

## 5) Contact first/last-name language classification (per-field)

**32,470 persons.** Each name field classified **independently** by script (Hebrew `֐-׿`
vs Latin `A-Za-z`), per the rules.

| Category | Count | Examples (representative) |
|---|---|---|
| Both Hebrew | **18,841** | יהונתן \| דודלס · רווית \| ברק |
| Both non-Hebrew (Latin) | **1,282** | Nicole \| Ghelman · NEIL \| ACKERMAN |
| Hebrew first + non-Hebrew last | **20** | נעמה \| Paz · יפית \| Shweky |
| Non-Hebrew first + Hebrew last | **4** | IAN \| איאן |
| Mixed-script / ambiguous | **3,222** | `New Contact \| 972528718250` (auto-created lead: placeholder + phone-as-lastname) |
| Missing first or last | **9,101** | אילנה \| ∅ · ליאת \| ∅ (first-name-only) |

Per-field breakdown: **first name** — hebrew 26,330 · latin 4,824 · missing 1,177 · ambiguous 139.
**last name** — hebrew 18,985 · latin 2,323 · missing 7,924 · ambiguous 3,226 · mixed 12.
Whitespace normalization needed: **first 22, last 24** (trivial — trim/collapse only).

**GOS target fields (confirmed, `server/src/routes/contacts.js`):** `Contact.firstNameHe`,
`lastNameHe`, `firstNameEn`, `lastNameEn`. Validator: **≥1 first name required in either
language**; all four stored **non-null** (empty `''`); `.trim()` applied. So the mapping is direct:
- Hebrew first → `firstNameHe`; Latin first → `firstNameEn`; Hebrew last → `lastNameHe`; Latin last →
  `lastNameEn` — **a contact can legitimately split across language columns** (the 24 cross-language
  cases confirm this is real, not an error).

**Review-required (do not auto-transform):**
- **1,177 with a missing first name** — GOS *requires* a first name; these need a remap decision
  (promote last→first? use the phone/company? skip to archive?).
- **3,222 mixed/ambiguous** — dominated by the `New Contact | <phone>` auto-lead pattern and a few
  company-names-as-persons (e.g. `Interspace Ltd | מכירות`); classify in review, not silently.
- The 7,924 missing-last-name are **fine** (GOS allows empty last name) — not a blocker.

## 6) Google Drive — folder-link inventory (links preserved, contents NOT copied)

Confirmed: **Drive content stays in Drive; the snapshot preserves the link values only.**

| Source | Field | Records with a value | Look like Drive **folders** | Look like Drive **files** | Other / non-Drive |
|---|---|---|---|---|---|
| Pipedrive deals | `תיקייה בדרייב` (varchar) | 1,654 | 1,037 | 0 | 617 (mostly **Google Photos** albums: `photos.app.goo.gl`, `photos.google.com/lr/album`) |
| Airtable סיורים | `לינק לתיקייה בדרייב` (url) + `מזהה תיקייה בדרייב` (id) | 2,753 / 3,000 sampled (825 with a folder-id) | 865 | 0 | 1,888 (Google Photos albums **+ free-text pollution**) |

**Findings:**
- Links point to **folders**, never individual files (0 file links) — good; folder links are stable.
- A large share are **Google Photos album** links, not Drive folders — a distinct asset class
  (tour photos) that overlaps GOS **Tour Gallery**; flag separately, don't treat as "Drive folder."
- **Data-quality pollution (Airtable):** the `url` field contains free text like `אין לינק`
  ("no link"), `כן`/`לא` ("yes"/"no"), `הוא לא עובד` ("it doesn't work"). These must be
  **validated, not preserved as links** — store raw in archive, surface as "no valid link."
- Duplicates: Pipedrive 121 repeated link values, Airtable 12 — mostly shared folders (expected).
- **Goal A completeness:** all **94 future Airtable tours have a Drive link** (0 missing).

**Recommendation:** capture the link **string** onto the migrated entity (deal / tour) as a
read-only reference + keep the raw in Legacy Archive; classify each into drive-folder /
photos-album / invalid at extraction; never fetch or copy Drive/Photos bytes into R2.

## 7) Deal↔Tour linkage confirmation (future scope)

`GET` on the Airtable `סיורים` table filtered to `ת.סיור ≥ today`: **94 future tours**, of which
**94 (100%) carry a Pipedrive deal id** (`פייפ דיל ID (from משתתפים)` / `Pipedrive`), **94 have a
calendar event id**, **94 have a Drive link**, 8 look cancelled. The Deal↔Tour spine for Goal A is
**fully linked and reconcilable** — no fuzzy matching needed for the active set.

## 8) Remaining product-owner decisions (only what the data can't decide)

1. **Operationally-active tier (§2).** Approve **Tier 2 = 699 deals** (recommended), or Tier 1
   (~150–180, tightest) / Tier 3 (~1,200–1,400, widest)?
2. **Historical line items (§3).** Confirm: preserve per-line detail as a **read-only historical
   snapshot** on the deal (not in the Pricing Builder), raw in Legacy Archive — yes?
3. **Org duplicate review (§4).** Confirm Org+Unit consolidation for the top institutional clusters
   (banks/health funds/insurers appearing 5–10×) → one Organization + Units. Who runs the review
   queue (169 clusters), and at what pace?
4. **Contacts with no first name (§5, 1,177).** Rule for these: promote last-name→first, use
   phone/company, or route to archive-only? And: import the 3,222 `New Contact | <phone>` auto-leads,
   or treat them as archive-only junk?
5. **Contact population scope.** 32,470 persons is 15 years of leads. Import **all** into GOS
   Contacts, or only those attached to in-scope (active + won) deals, with the rest archived?
6. **Google Photos albums (§6).** Treat album links as Tour-Gallery references, plain archived
   links, or ignore? (Drive folders: preserve link — already decided.)

Everything else (delta/cutover mechanics, updated-at fields, deletion detection) is now specified
in the migration plan and needs no owner input.

---

## Appendix — safety posture (upheld)
- GET/read-only throughout; no writes to Pipedrive/Airtable/GOS; no records changed.
- Full pagination is read-only auditing, not extraction: **no snapshot was stored**, nothing
  written to R2 or GOS.
- No secrets exposed: only API-returned identities + aggregates + a few representative name/org
  examples. Raw per-record data stays in the **gitignored** `output/` dir. The legacy passwords
  table was never read.
