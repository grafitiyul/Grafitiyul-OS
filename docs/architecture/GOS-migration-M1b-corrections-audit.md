# GOS — M1b Corrections Audit (archive population, contact quality, pricing text)

**Status:** COMPLETE. Read-only follow-up audit correcting the M1 conclusions per product-owner
clarifications. All numbers verified against the live APIs (full pagination). No writes, no
merges, no snapshot, no `LegacyRecord`, no schema change.
**Tooling:** `server/scripts/migration/{pipedrive-archive-audit,pipedrive-contacts-quality-audit,pipedrive-pricing-text-audit}.mjs`.
**Supersedes:** the deal-population conclusion in `GOS-migration-M1-deep-audit.md` §1.
**Last updated:** 2026-07-14

---

## 1) THE HEADLINE CORRECTION — the archive holds 19,448 deals

The owner was right: the id gap is **archived deals, not deletions**. The previous "4,908 total"
was the **non-archived population only**.

### 1a) The archive mechanism (verified)
- Pipedrive `GET /deals` accepts **`archived_status` = `archived` | `not_archived` | `all`**
  (works on both v1 and v2). The **default list excludes archived** — which is why the earlier
  audit saw only 4,908.
- Every deal object carries **`is_archived`** (bool) + **`archive_time`** (timestamp).
- The v2 `is_archived` / `archived` query params are **rejected** on this account
  (`ERR_SCHEMA_VALIDATION_FAILED`) — `archived_status` is the working filter.
- Archived deals are **id-addressable** (`GET /deals/{id}` returns them normally).

### 1b) Verified counts (full pagination, both populations)

| Population | Open | Won | Lost | Total |
|---|---|---|---|---|
| Non-archived | 70 | 1,620 | 3,218 | **4,908** |
| **Archived** | **8** | **6,622** | **12,818** | **19,448** |
| **Combined (true accessible population)** | **78** | **8,242** | **16,036** | **24,356** |
| Recently deleted (visible ≤ ~30 days) | | | | 9 |
| Genuinely deleted & unrecoverable (id-space holes) | | | | **~1,945** |

- **The entire archive was created in one event: 2026-03** (archive_time histogram = 100%
  March 2026) — exactly the mass-archiving the owner described.
- Id-space reconciliation: combined ids run **8 → 26,306**; of the previously-reported 18,016-id
  gap, **16,226 are archived deals**, plus 3,222 archived deals sit below the old minimum (3,383).
  Only **1,945 ids** in the combined range are truly absent = genuinely deleted over 15 years.
- **8 archived OPEN deals** exist — probably archived-by-mistake or intentionally shelved; owner
  should glance at them (they are inside the archive, not the active pipeline).

### 1c) Archived-deal extraction feasibility — FULL, without restoring

| Aspect | Verified result (n = 19,448) |
|---|---|
| `update_time` / `add_time` / `archive_time` | **100%** present → **delta extraction works for archived deals too** |
| Owner, stage, pipeline, value, currency | **100%** present |
| `won_time` / `lost_time` | present on all won/lost respectively |
| Person link | 19,194 (98.7%) |
| Organization link | 4,245 (21.8% — most retail deals have person only) |
| Product lines (`products_count>0`) | **13,109 (67%)** |
| Notes | 16,793 (86%) |
| Files | 6,976 (36%) |
| Tour-date custom field | 8,661 |
| By-id GET + `/products` + `/activities` + `/files` + `/notes` on archived deals | **all work — no restore needed** |
| Archived deals with a FUTURE tour date | **0** → **Goal A is unaffected by the archive** |

**Corrected conclusions:** Goal B's historical deal population is **24,356**, not 4,908.
Extraction must always pass `archived_status=all` (or run both populations). ~1,945 deals are
genuinely gone (pre-archive deletions) and cannot be recovered by anyone — that is the honest
floor, verified.

## 2) Contact phone-quality census (32,470 persons; 51,361 phone values)

25,409 persons have ≥1 phone; **21,147 carry multiple phone values** (largely the SAME number in
two formats — e.g. `+972…` and `05…` — which is itself a corruption artifact to collapse).

### 2a) Raw-format pattern counts

| Pattern | Count |
|---|---|
| `+972…` (clean) | 23,467 (+347 with separators) |
| Leading-0 Israeli shape (`05x…`, 9-10 digits) | 21,972 (+3,228 with separators) |
| Leading-0 but **>10 digits** (suspect foreign, `+`→`0`) | 735 (+8) |
| Bare international shape (no prefix) | 519 (+46) |
| **`972` then `0`** (`9720…` — classic corruption) | 421 |
| Bare `972…` (no `+`) | 408 |
| `+<other country>` | 145 |
| Too short (<8 digits) | 35 |
| `00` international prefix | 17 |
| Duplicated prefix (`972972…`) | 6 |

### 2b) Proposed normalization rules (comparison-only; **original never overwritten**)

Each stored `ContactPhone.value` keeps the **raw legacy string verbatim**; the normalized form is
a **comparison candidate** computed on the fly (extending the canonical
`normalizePhoneIntl` in `server/src/whatsapp/phone.js`, which already implements R1/R3/R4/R6):

| Rule | Input shape | Action | Confidence | Measured count |
|---|---|---|---|---|
| R0 | `972972…` | collapse duplicated prefix, re-classify | — | 6 |
| R1 | `+972`/`972` + 8-9 digits not starting 0 | Israeli: `972XXXXXXXX` | high | 23,385 |
| R2 | `9720` + 8-9 digits | drop the stray 0 → `972…` | high | 404 |
| R3 | `0` + 9-10 digits total | Israeli local → `972` + rest | high | 25,201 |
| R4 | `00` + valid intl | drop `00`, take as-is (no country repair) | medium | 1 |
| R5 | `+<CC>` valid foreign | as-is digits | high | 142 |
| R6 | bare 10-15 digits, not 0/972-leading | as-is (weaker) | medium | 241 |
| R7 | `0` + >10 digits | **suspect `+`→`0` foreign — NO candidate, review** | review | 744 |
| — | `972` + invalid IL length | **maybe foreign wrongly prefixed — NO candidate, review** | review | 843 |
| R8 | <8 usable digits / unusable | no candidate | review/none | 384 |

**95.4% of all phone values (48,990) normalize with high confidence**; the review pile is 1,971
values. Foreign numbers are never auto-"repaired" — rules R7 and the 972-invalid class go to
review, exactly per the owner's constraints.

### 2c) Duplicate analysis (after safe normalization; New Contact spam excluded)

| Measure | Count |
|---|---|
| Exact **raw** duplicate values (same string on ≥2 contacts) | 4,387 values / 9,143 occurrences |
| Clusters after normalization (≥2 contacts share a candidate) | **1,151** (1,064 pairs + **87 shared by >2 contacts**) |
| Contacts involved | 2,402 |
| Phone matches with **conflicting names** | 608 |
| Phone matches with **conflicting emails** (both sides have emails, disjoint) | 100 |
| Phone matches with **supporting shared email** | 342 |

**Proposed confidence groups (measured):** safe automatic **647** · strong probable (owner
confirms) **363** · ambiguous (owner decides) **141** · everything else = separate contacts.
Guards per the owner's rules: shared numbers (>2 contacts, 87 clusters) are **never** auto-merged
(office/switchboard/family risk); conflicting phone-vs-email evidence → review; name/org/WhatsApp
context is supporting evidence only. High-risk examples (masked) show the dominant real pattern
is the same person entered 2-5× with name variants (e.g. "ליאת" / "ליאת שפירא") — genuinely
mergeable, but through the review flow.

**No merges were performed.**

## 3) "New Contact" spam — exact rule and verified linkage

- **Rule:** `first_name` (or full name) matches `/^new contact\b/i`. No other automated
  placeholder pattern exists at scale (frequency scan found no second candidate ≥50).
- **Total: 3,193 records.** Linkage verified across ALL of them:
  - **0** with open deals · **0** with won deals · **1** with any deal at all (person `23960`,
    one closed/lost deal) · **0** email messages · **0** files · 32 with notes.
  - 535 carry **open activities** — all auto-created follow-ups (spam-generated noise), and
    3,049 have done activities (automation logs). None represents a customer relationship.
- **Disposition:** exclude all 3,193 from Contact creation — no placeholders, no review-queue
  seats, no blocking of related imports. Their auto-activities are excluded with them. **Exactly
  one exceptional record** (person 23960, one closed deal) is surfaced for owner review; the deal
  itself migrates regardless (its person link resolves to none/archive).
- These 3,193 were previously the bulk of M1's "mixed/ambiguous 3,222" bucket — the real
  ambiguous-name review queue is now tiny. The missing-first-name queue (1,177) also shrinks by
  every spam overlap at load time.

## 4) Pricing-line explanatory text — verified source locations

Sampled 180 deals with products, stratified across eras and BOTH populations (90 archived + 90
non-archived) → 226 line rows:

| Location | Verdict | Evidence |
|---|---|---|
| **Line `comments` field (deal-product row)** | **PRIMARY home of the wording** | 35/226 lines (15%) carry comments; **28/35 contain pricing wording** — exactly the owner's example style: *"3800 ש\"ח עד 30 ילדים, אם יש סבבים, כל סבב נוסף 2800 ש\"ח…"*, *"עלות בסיס לסדנת תקליטים… ל-10 משתתפים - 2500 ש\"ח + 150 ש\"ח לכל…"*. **Stored as HTML** (`<div>…</div>`) — must be preserved verbatim raw + sanitized at render |
| Line/product **name** | secondary, rare | 2/226 lines carry wording in the name |
| Deal notes | supplementary | 56/126 sampled notes contain pricing wording — notes migrate anyway (timeline), so this context is preserved by the normal note migration |
| Deal custom field `הערות להצעת מחיר` | negligible | 5 deals non-empty in the whole system |
| Product-catalog `description` | empty | 0/131 products have descriptions |

Structured completeness on the same sample: quantity / unit price / line total / currency / tax /
tax_method = **226/226**; name 213/226; discount used 0/226; **line ordering is returned by the
API** (preserved). **qty × unit price == sum on 100% of lines** — the package semantics ("עד 30
ילדים") live ONLY in the text, never as broken math. This confirms the owner's requirement: the
read-only historical display must show **original wording + the math + total + tax**, with the
comment rendered beneath its line; nothing is reconstructable from numbers alone.

Line-item population (corrected for archive): **15,639 deals with product lines**
(2,530 non-archived + 13,109 archived).

## 5) Updated Goal A / Goal B population estimates

| Scope | Before M1b | **Corrected** |
|---|---|---|
| Goal A operationally-active deals | Tier 2 = 699 | **Tier 2 = 699 (+ 8 archived-open pending owner glance)** — archive adds no future-dated work (0 future tour dates) |
| Goal B historical deals | 4,908 | **24,356** (all accessible, incl. 19,448 archived — extractable without restore) |
| Deals with preservable line items | 2,530 | **15,639** |
| Contacts (candidates after spam exclusion) | 32,470 | **29,277** (− 3,193 New Contact spam); ~2,402 in dedup clusters → est. ~28k canonical after merges |
| Organizations | 2,905 | 2,905 (169 review clusters / 384 orgs; see the Org+Unit review report) |
| Genuinely unrecoverable deals | "~21k deleted" (wrong) | **~1,945** (verified id-space holes) + deletions older than the id floor |

Snapshot-size implication: raw JSON estimate grows ~5× on the deal axis (24,356 deals, 15,639
with lines, 16.8k archived-with-notes) — still comfortably low-GB; Pipedrive files remain the
unmeasured ceiling (6,976 archived + non-archived deals have files; byte total = extractor task).

---

## Remaining product-owner decisions from this round

Consolidated into the mapping package (`GOS-migration-mapping-package.md` §9) — only items the
data cannot decide: the 8 archived-open deals, dedup group handling confirmation, the single
exceptional New Contact record, and the previously-open items (active tier, stage mapping
confirmation, org clusters, no-first-name rule, Photos albums).

## Safety posture (upheld)
GET-only throughout; no writes/merges/snapshots; committed report holds aggregates + masked
phones + a handful of org/person name examples needed for review; raw per-record data stays in
the gitignored `output/` dir; no secrets anywhere.
