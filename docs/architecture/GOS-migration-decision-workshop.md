# GOS Migration — Product-Owner Decision Workshop

**Status:** Decision session document. No technical work in this phase. Each decision below has an
empty **DECISION:** line — the owner's answers get recorded here and become binding for the
mapping package (`GOS-migration-mapping-package.md`), which then updates automatically.
**Consolidation:** D-1…D-14 → **7 business decisions** (D-3 pricing already decided by the owner;
purely inferable items moved to "already decided" below).
**Last updated:** 2026-07-14

---

## Already decided — no discussion needed

These follow from your earlier instructions or directly from the audited data:

- **Historical pricing lines** — preserved read-only: original wording (verbatim), the math,
  totals, tax; never forced into the live Pricing Builder. (Your instruction; verified feasible.)
- **"New Contact" spam (3,193)** — excluded; verified none has an open/won deal.
- **Phone handling** — original numbers never altered; normalized copies used only for matching;
  foreign numbers never auto-"repaired"; unclear cases go to review.
- **Google Drive** — links preserved on the records; file contents stay in Drive.
- **Old Airtable base** — archived as-is (no live records); the passwords table is never copied.
- **Archived Pipedrive deals** — included in extraction (no restore needed).
- **Cutover model** — practice import first, keep working in the old systems, final top-up of
  changes, verification, then switch.
- **Snapshot storage** — a new private storage bucket, separate from anything public.

---

## Decision 1 — Which deals are "live work" on day one? 🔴 most important

**Question:** When we switch to GOS, which old deals should appear as live, workable deals
(rather than history)?
**Why it matters:** This defines what your team sees in the pipeline on the first morning.
**Recommendation:** The measured "Tier 2" set — every open deal, every deal with a future tour,
every deal with an upcoming or open to-do (**699 deals**). Also: quickly glance at the **8 open
deals that sit inside the archive** — likely archived on purpose; if so they stay history.
**Why:** It captures everything with real future work without dragging in thousands of cold
leads.
**Impact:** ~700 of 24,356 deals · Goal A.
**Tradeoffs:** Complete working picture; the price is some stale to-dos come along (they can be
bulk-closed later).
**Alternatives:** Tighter (~150–180: only open/future-dated — risks losing follow-up work) ·
Wider (~1,200–1,400: adds recently-touched lost deals — more noise).

**DECISION 1:** _________

## Decision 2 — Where does each deal land in the GOS pipeline?

**Question:** Approve the translation table from the 25 old Pipedrive stages to your 6 GOS
stages, and choose what stage closed historical deals get.
**Why it matters:** Every imported deal must sit in some stage; this shapes your pipeline view.
**Recommendation:** The table in the mapping package (intake→ליד חדש, proposal-sent→הצעת מחיר,
follow-ups→פולואפ/מו"מ, awaiting-our-approval→הסכמה לסגירה, confirmed→סגירה; the old collection
pipeline just becomes "won" — GOS's own collection module owns payment state). Historical closed
deals: mapped stage where obvious, otherwise סגירה — their original stage is always kept in the
attached legacy record.
**Impact:** All 24,356 deals (699 visibly; the rest as history) · Goals A+B.
**Tradeoffs:** No new stage clutter; you lose a dedicated "imported" stage marker (origin is
still always visible on the deal).
**Alternative:** Create one hidden "ארכיון-ייבוא" stage for all historical deals.

**DECISION 2:** _________

## Decision 3 — How much of the past becomes real records? (three toggles)

**Question:** For old contacts, old tours, and old files — real GOS records, or archive-only?
**Why it matters:** This sets how rich the customer history is when your team opens a customer.

| Toggle | Recommendation | Why |
|---|---|---|
| **3a. Contacts** — all 29,277 (after spam removal) vs only those attached to deals | **All** | WhatsApp/email auto-matching works against the full phone book; a returning customer from 2019 is recognized |
| **3b. Historical tours** (~2,000+) | **Real tour records** | "This school did 4 tours with us" becomes visible on the customer page |
| **3c. Old deal files** (≥ ~7,000 deals have files; total size measured before running) | **Copy into GOS storage** | Pipedrive disappears at the end — un-copied files are gone forever |

**Impact:** Mostly Goal B (history) · 3a slightly affects Goal A matching quality.
**Tradeoffs:** Rich, searchable history and safe files; the cost is a bigger database/storage
bill (measured and reported before anything runs).
**Alternatives:** Any toggle can be flipped to "archive-only/leaner"; 3c can be "list files
without copying" (cheaper, but files die with Pipedrive).

**DECISION 3a/3b/3c:** _________

## Decision 4 — Duplicate cleanup: approve the auto-merges and staff the review

**Question:** Confirm the safe automatic merges, and decide who reviews the rest.
**Why it matters:** This is what makes GOS start with ONE record per real customer/organization.
**Recommendation:**
- Auto-merge the **647 contact pairs** with identical phone + matching name/email, and the **2
  organization pairs** with identical tax id (every merge is logged and reversible pre-cutover).
- You personally work the **top-25 organization clusters** (banks, health funds, universities →
  one organization + branches as Units) — about 1–2 hours, before any deals load.
- Office staff work the contact review queue (**363 probable + 141 ambiguous**) during the
  import phase.
**Impact:** ~2,400 contacts + 384 organizations · both goals (this is the identity foundation).
**Tradeoffs:** A few hours of human review buys a permanently clean customer base; skipping it
means duplicate customers forever.
**Alternative:** Defer everything to review (no auto-merges) — safer-feeling but adds ~650
unnecessary manual confirmations of obvious duplicates.
**Depends on:** Decision 3a (importing all contacts is what makes the queue this size).

**DECISION 4:** _________

## Decision 5 — Two leftover contact edge cases

**Question (5a):** Contacts with no first name (~1,177, usually a single name in the wrong box) —
approve moving their only name into the first-name field (display unchanged; nothing invented)?
**Question (5b):** The single exceptional "New Contact" spam record that has one old closed deal —
stays excluded (the deal itself migrates regardless)?
**Recommendation:** Yes to both.
**Impact:** ~1,200 records · Goal B.
**Tradeoffs:** None material; the alternative (routing 1,177 records to manual review) costs
hours for no business value.

**DECISION 5:** _________

## Decision 6 — Deal numbers for imported deals

**Question:** What "מספר הזמנה" do imported deals carry?
**Why it matters:** GOS deal numbers are customer-facing and start at 27,000; the number is also
the deal's link/URL.
**Recommendation:** **Imported deals keep their original Pipedrive number as their GOS deal
number.** The old numbers run 8–26,306 and GOS starts at 27,000 — the ranges can never collide.
Old deals stay recognizable ("deal 21,455" means the same thing it always did), new deals
continue from 27,000+ untouched.
**Impact:** All 24,356 imported deals · both goals.
**Tradeoffs:** Clean continuity, zero collisions; no real downside identified.
**Alternative:** Let imports consume new numbers (burns ~24k numbers, breaks continuity) — not
recommended.

**DECISION 6:** _________

## Decision 7 — Small cleanups bundle (rubber-stamp)

| Item | Recommendation |
|---|---|
| **7a.** Old open to-dos on deals NOT in the live set | Don't create live tasks — keep as a history line on the deal |
| **7b.** Google Photos album links (hundreds of deals/tours) | Keep as clickable links on the deal/tour (tour photos context); contents not copied |
| **7c.** Old message templates (ניסוחים, ~230 texts in the old base) | Archive only — GOS's own content/templates are already rebuilt; revisit only if something is missed |

**Impact:** Small · Goal B.
**Depends on:** 7a follows Decision 1's cut line.

**DECISION 7:** _________

---

## After this workshop

With these 7 answers recorded, implementation becomes mechanical: legacy-record foundation →
Snapshot #1 → rehearsal import → your two review queues (org top-25, contact duplicates) →
verification → freeze/top-up → cutover → history backfill. Remaining owner touchpoints: the two
review queues and the final go/no-go.
