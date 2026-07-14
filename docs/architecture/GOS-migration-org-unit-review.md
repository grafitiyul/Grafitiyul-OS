# GOS — Organization Cleanup & Unit-Mapping Review Report

**Status:** Decision report for the product owner. Read-only findings — no merges performed.
**Source:** full Pipedrive organization pull (2,905 orgs) with per-org deal counts; clusters built
on normalized names (legal-suffix/punctuation-stripped), prioritized by total deal impact.
**Method guard:** name similarity alone NEVER auto-merges — every cluster below is a
*candidate* awaiting your confirmation, except the tax-id matches marked SAFE.
**Last updated:** 2026-07-14

---

## 1) Classification summary

| Class | Clusters | Orgs | Action |
|---|---|---|---|
| **Safe automatic match** (identical tax id) | 2 | 4 | merge automatically, logged (עמותת בינ"ה ↔ בינ"ה המרכז ליהדות חברתית; לנדולני ↔ לאנדוליני) |
| **Probable — owner review** (normalized-name clusters) | 169 | 384 | review queue, highest impact first (below) |
| **Separate organizations** | — | ~2,521 singletons | migrate as-is |

Tax id (ח.פ) is filled on very few orgs — name clusters are the real workload. Supporting
evidence available per cluster during review: shared contacts, deal history, addresses, email
domains (fetched on demand in the review tool; not used to auto-decide).

## 2) The desired end-state (per the finalized rule)

One canonical `Organization` per real-world organization; branches/departments/divisions become
`OrganizationUnit` rows under it; every historical deal re-points to the canonical Organization
and, where determinable (from the deal's contact or branch context), to the correct Unit.

**Unit-strong candidates** — clusters where members clearly represent branches of one
institution (banks, health funds, government, universities): the review decision is not merely
"same org?" but "which member becomes which Unit".

## 3) Prioritized review queue (top 25 by deal impact)

| # | Cluster | Members × deals | Proposed shape |
|---|---|---|---|
| 1 | Boker tours | ×2 — 14 deals (#272: 12d · #287: 2d) | one Org (travel agency), plain merge |
| 2 | בנק לאומי | ×10 — 12 deals (all 1-2d each) | **one Org + Units per branch** |
| 3 | משרד ראש הממשלה | ×3 — 12 deals (#1376: 9d) | one Org (+ Units if departments differ) |
| 4 | אשת תיירות | ×3 — 8 deals (#492: 5d/10 people) | one Org (agency), merge |
| 5 | רפאל | ×5 — 8 deals | **one Org + Units** (divisions) |
| 6 | תיכון רוטברג | ×2 — 8 deals | one Org, merge |
| 7 | אוניברסיטת תל אביב | ×2 — 7 deals | **one Org + Units** (faculties) |
| 8 | גוגל | ×2 — 7 deals | one Org, merge |
| 9 | אוניברסיטת בר אילן | ×2 — 7 deals | **one Org + Units** |
| 10 | כללית | ×6 — 7 deals | **one Org + Units** (districts/clinics) |
| 11 | מכבי שירותי בריאות | ×2 — 7 deals | **one Org + Units** |
| 12 | משטרת ישראל | ×2 — 6 deals | one Org (+ Units) |
| 13 | עיריית פתח תקווה | ×2 — 6 deals | one Org (+ Units per department) |
| 14 | Mejdi tours | ×2 — 6 deals | one Org, merge |
| 15 | בנק הפועלים | ×6 — 6 deals | **one Org + Units per branch** |
| 16 | עיריית ראשון לציון | ×3 — 6 deals | one Org (+ Units) |
| 17 | yes | ×3 — 5 deals | one Org, merge |
| 18 | ביטוח לאומי | ×3 — 5 deals | **one Org + Units** (branches) |
| 19 | כיוון אחר | ×3 — 5 deals | one Org, merge |
| 20 | ביטוח ישיר | ×4 — 5 deals | one Org (+ Units) |
| 21 | Meetinkz | ×4 — 5 deals | one Org, merge |
| 22 | ארגון גמלאי צה"ל רעננה | ×2 — 5 deals | one Org, merge |
| 23 | יונית שילר | ×2 — 5 deals | one Org (possibly a person-as-org; check) |
| 24 | אגדת עין כרם | ×2 — 4 deals | one Org, merge |
| 25 | הטכניון | ×2 — 4 deals | **one Org + Units** |

The remaining 144 clusters (mostly ×2, 1-3 deals each) follow in the same queue, descending by
deal count. Full cluster data (member ids, addresses, people counts) is in the gitignored audit
output (`pipedrive-contacts-quality-audit.json → orgClustersPrioritized`).

## 4) Review mechanics (proposed)

- Review happens **once, at the identity-spine phase (M4)** — before any deal loads, so every
  deal lands on a canonical Org the first time.
- Per cluster the owner chooses: **merge** (pick canonical name, others become Units or aliases) /
  **keep separate** / **defer** (defer = migrate separately + revisit; crosswalk makes later
  merges possible but more expensive — prefer deciding up front for the top 25).
- Every merge is logged in the dedup ledger (winner, losers, evidence, decider, timestamp).
- Airtable `לקוחות עסקיים` (599) reconciles against the post-merge canonical set via the deal
  linkage — it is a subset mirror, not a second source.

## 5) What the owner needs to answer here

1. Confirm the 2 safe tax-id merges.
2. Work the top-25 queue above (merge shape per cluster: Org-only vs Org+Units, canonical name).
3. Confirm the ×5-10 institutional clusters become Org+Units (recommended) rather than flat merges.
4. Pace: one sitting (~1-2h for top 25) before M4, remainder during M4 at leisure.
