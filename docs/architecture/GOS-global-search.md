# GOS Global Header Search — architecture

Status: implemented (branch `feat/global-search`).
One canonical server-side service; no page-level search logic.

---

## 1. What it is

A permanent search field in the centre of the admin header, between the
branding and the account controls. Default category is **Deals** on every
fresh admin session (never "All", and deliberately not persisted).

Categories: Deals · Contacts · Organizations · Tasks · Notes/Timeline · All.

---

## 2. Technology decision — PostgreSQL-native

**Decision: Postgres-native `ILIKE` + indexed identifier lookups. No external
search engine. No new indexes.**

Evidence gathered before choosing:

| Fact | Source |
|---|---|
| No search infrastructure exists | 0 `tsvector` / `@@fulltext` / `pg_trgm` / GIN in 152 models, 229 indexes |
| `postgresqlExtensions` preview feature is OFF | `schema.prisma` generator block has no `previewFeatures` |
| Postgres has no Hebrew text-search config | `to_tsvector('hebrew', …)` does not exist — FTS would not help the primary language |
| Existing server search is all Prisma `contains` | `routes/email.js`, `routes/whatsapp.js`, `sharedContent.js` |

Measured on a real Postgres seeded **above** plausible post-migration scale
(50,000 deals · 40,000 contacts · 40,000 phones · 150,000 timeline entries ·
30,000 tasks · 16,667 tours):

| Query | Median |
|---|---|
| Exact deal number | 163 ms |
| Exact phone (contacts) | 54–70 ms |
| Common Hebrew word (deals) | 199 ms |
| Note text (deals) | 213 ms |
| Timeline text | 83 ms |
| All categories, common word | 204 ms |
| **Worst case** | **213 ms** |

Query plans confirm sequential scans are cheap at this size — the unindexed
phone scan filters all 40,000 rows in **28 ms** (491 shared buffers).

**Conclusion:** Postgres is comfortably sufficient behind a 250 ms debounce.
Elasticsearch/Meilisearch/Algolia would add an index-sync failure mode and a
second source of truth to solve a problem that does not exist. **No indexes
were added** — the real query plans do not justify any.

**Revisit when** the worst-case median exceeds ~500 ms on production data. The
first move then is a `pg_trgm` GIN index on `Deal.title` and an expression
index on `regexp_replace(ContactPhone.value, '[^0-9]', '', 'g')` — *not* an
external engine.

---

## 3. The ranking formula

Every hit carries two independent dimensions:

- **`score`** (0–100) — how well the text matched (strongest reason wins).
- **`groupRank`** (0–3) — the deal's business importance.

### Business groups (deals)

| Rank | Meaning |
|---|---|
| 0 | Open deals |
| 1 | WON with a future TourEvent |
| 2 | WON whose latest tour ended within the last 2 months (62 days) |
| 3 | Everything else (older WON, lost, WON with no tour) |

Dates: `TourEvent.date` is a `String` `"YYYY-MM-DD"`, so comparisons are
lexicographic on zero-padded ISO — correct, and no timezone round-trip.
"Today" resolves in **Asia/Jerusalem**, so a tour cannot flip between future
and past at UTC midnight. `completedAt` is deliberately **not** used: a
past-dated tour never explicitly completed still has `completedAt = null`.
Deal→Tour goes only through `Booking` (schema forbids a direct `tourEventId`);
superseded tours are excluded.

### Two tiers — why business order does not corrupt relevance

Sorting by `groupRank` first would let a vague note match on an open deal
outrank an exact deal-number hit. Sorting by `score` first would discard the
business order. So hits split into two tiers and the dimensions swap priority:

- **Tier 0 — identifier hits** (`score >= 88`): deal number, phone, email,
  exact name, tax id. Intent is unambiguous → **relevance leads**, business
  order only breaks ties.
- **Tier 1 — text hits** (`score < 88`): the user is browsing by words →
  **business order leads**, score breaks ties.

```
tier 0 → [tier, -score, groupRank, -updatedAt]
tier 1 → [tier, groupRank, -score, -updatedAt]
```

An exact identifier match therefore **always** outranks any text match, and
ordinary text search respects the business order exactly.

### Scores

| Reason | Score | | Reason | Score |
|---|---|---|---|---|
| `deal_number_exact` | 100 | | `deal_number_partial` | 48 |
| `phone_exact` | 95 | | `org_name_partial` | 45 |
| `email_exact` | 92 | | `unit_name_partial` | 44 |
| `name_exact` | 90 | | `email_partial` | 42 |
| `tax_id_exact` | 88 | | `product_partial` | 40 |
| *— tier boundary —* | | | `variant_partial` | 39 |
| `name_prefix` | 70 | | `task_title_partial` | 38 |
| `title_prefix` | 65 | | `source_partial` | 35 |
| `name_partial` | 60 | | `status_partial` | 34 |
| `title_partial` | 55 | | `tour_date_partial` | 33 |
| `phone_partial` | 50 | | `note_partial` | 30 |
| | | | `timeline_partial` | 25 |
| | | | `legacy_partial` | 20 |

Source of truth: `server/src/search/ranking.js`. Each reason also carries the
Hebrew label shown as "why this matched".

---

## 4. Phone matching

Reuses the canonical `normalizePhoneIntl` (`server/src/whatsapp/phone.js`) —
**no second notion of "same number"**.

`ContactPhone.value` is stored raw with no normalized column, so:

1. **SQL narrows** by the significant digit-suffix (last 9 digits of the
   international form) against `regexp_replace(value, '[^0-9]', '', 'g')` —
   formatting-agnostic and cheap.
2. **The canonical normalizer decides** which candidates are genuinely the same
   number. A suffix hit that fails canonical equality is kept as a *partial*
   match, not dropped.

`050…` / `+97250…` / `97250…` / `0097250…` / spaces / dashes / brackets all
converge. Verified end-to-end against contacts stored in local, international
and compact spellings.

**Stored numbers are never repaired or rewritten.** Normalization is for
matching only.

---

## 5. Migration compatibility

Works before and after the legacy migration, through the same service.

- Reads **`LegacyRecord.cardData`** only — the curated label→value pairs that
  are safe to display.
- **Never reads `LegacyRecord.payload`** (the raw source record). Verified by
  test: a secret planted in `payload` is unfindable in every category.
- Joins via the loose `entityType` + `entityId` pair (no FK, already indexed),
  tolerating dangling links.

`LegacyRecord` is empty today, so the lookup returns `[]` at the cost of one
cheap indexed query. It begins contributing the moment the migration's import
slice writes rows — **no second architecture, no switch to flip**.

---

## 6. Avoiding N+1

Each provider runs a **fixed** number of queries regardless of result count:
bounded lookups Prisma cannot express (phone, timeline, legacy, orderNo cast)
run in parallel, their ids fold into **one** `findMany`, and scoring happens in
JS. Loose keys with no FK (`Task.ownerUserId`, `TimelineEntry.subjectId`) are
resolved with one batched query per type.

Verified: a search matching 5 deals and one matching 45 deals both cost
**14 queries**.

Results are bounded (20 per category; 5 per category in "All"), and a
`truncated` flag reports honestly when the candidate cap was reached rather
than implying completeness.

---

## 7. Security

- Admin-only: mounted `app.use('/api/search', requireAdminAuth, searchRouter)`
  per the project's mount-site convention.
- Providers `select` explicit fields only. No portal tokens, no
  `passwordHash`, no payment tokens, no raw legacy payloads.
- Timeline/note bodies are HTML-stripped before matching and snippeting, so
  markup is neither searchable nor renderable from a result.
- User-typed LIKE wildcards are escaped, so `%` cannot become "match all".

---

## 8. Known limitations (honest, not speculative)

1. **Very broad queries rank within a 300-row candidate window, not the whole
   match set.** Each lookup is capped at `CANDIDATE_CAP = 300` rows ordered by
   `updatedAt desc`. At scale a word like `ריסוס` matches ~11,000 deals, so the
   business-group ordering is applied to the 300 most recently updated of them
   — an old-but-open deal could be missed. The response sets `truncated: true`
   and the UI says results are partial, so this is never silently wrong. This
   is the correct trade for a header quick-search (the alternative is ranking
   11,000 rows per keystroke); users narrow the query or use the full list
   pages. Exact-identifier queries are unaffected — they match a handful of
   rows and never reach the cap.
2. **Text split across HTML tags in a note may not match.** Matching runs in
   SQL against raw HTML, then re-verifies against stripped text. A phrase
   interrupted by markup (`he<b>llo</b>`) is missed. Rare in practice; fixing
   it properly needs a stored stripped-text column.
3. **Substring matching cannot use a B-tree index.** Fine at measured scale;
   see the revisit trigger in §2.
4. **`Organization` has no email-domain field** — a domain query matches via
   `financeEmail`. No field was invented for this.
5. **Search is hidden below the `md` breakpoint** so the mobile header keeps
   its layout. Desktop admin is the stated design target.
