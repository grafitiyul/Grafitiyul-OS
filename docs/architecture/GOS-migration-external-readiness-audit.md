# GOS — External Read-Only Readiness Audit (Pipedrive + Airtable)

**Status:** COMPLETE — both read-only audits executed successfully via Railway. Verified findings
below. No writes to Pipedrive, Airtable, or GOS. No full extraction. No `LegacyRecord`, no migrator.
**Companion to:** `GOS-migration-preparation-plan.md`, `GOS-migration-readiness-audit.md`.
**Tooling:** `server/scripts/migration/{lib,pipedrive-audit,airtable-audit}.mjs`.
**Raw inventory (gitignored, not committed):** `server/scripts/migration/output/{pipedrive,airtable}-audit.json`.
**Run:** `railway run --service Grafitiyul-OS node server/scripts/migration/pipedrive-audit.mjs`
and `… airtable-audit.mjs --counts`.
**Last updated:** 2026-07-14

---

## 0) Headline findings

- **Both systems connected read-only and were inventoried in full (schema level).**
- **The Deal↔Tour link is SOLVED and direct:** the Airtable `משתתפים` (Participants) table
  carries **`פייפ דיל ID`** (Pipedrive Deal ID, numeric) and links to `סיורים` (Tours). No fuzzy
  matching needed for the spine.
- **Go-live is small:** Pipedrive has **70 open deals** (out of 4,908 total). Goal A's active
  operational load is tiny; the bulk is historical (1,620 won + 3,218 lost).
- **The second Airtable base is NOT operational data.** It is an older **product/catalog +
  message-template ("ניסוחים") + config** base that overlaps systems GOS already owns
  (products, pricing, WooCommerce, locations, templates). Recommendation: **archive, do not
  structurally migrate** — with one hard exclusion (a passwords table) and a couple of optional
  reference-mapping candidates. Details in §4.
- **Attachment risk is LOW on Airtable** (3 attachment fields across both bases) and
  **UNMEASURED but present on Pipedrive** (files exist; count is an M1 task). A real dependency:
  many historical documents live in **Google Drive** (referenced by link, outside both APIs).
- **One security flag:** the legacy base has a `גישה, סיסמאות` (Access/Passwords) table (61
  rows) — **must be excluded from every snapshot**.

## 1) STEP 1 — Configuration (confirmed resolved)

All five variables are now reachable via `railway run` against **production / Grafitiyul-OS**
(verified by name + length only; no values printed). Env-var names remain appropriate (§ prior
revision). The audit ran as a **read-only one-off through Railway** — no deployment of app code
was needed or done.

## 2) STEP 2 — Connection-test results (VERIFIED)

| System | Result | Identity | API | Rate-limit (observed) |
|---|---|---|---|---|
| **Pipedrive** | ✅ connected | user **"Elinoy"**, company **Grafitiyul** (id 7873395), admin=true | REST **v1** | `x-ratelimit-limit: 80`, `remaining: 72`, `reset: 2s` (burst budget healthy) |
| **Airtable** | ✅ connected | PAT sees **2 bases** (both configured bases) | Meta API v0 | no explicit headers returned; 5 req/s/base assumed, paced at ~220ms |

Airtable base validation (both configured IDs valid + schema-readable):

| Role | Base id (non-secret) | Name | Tables | Permission |
|---|---|---|---|---|
| main | `apprCVcUYhZeIYRJB` | **גרפיטיול** | 24 | (read via PAT) |
| legacy | `appCouDLeNLtFcpFp` | **מוצרים ושירותים - גרפיטיול** | 16 | (read via PAT) |

## 3) STEP 3 — Structure inventory (VERIFIED)

### 3a) Pipedrive pipelines & stages (5 pipelines, 25 stages)

| # | Pipeline | Stages (in order) |
|---|---|---|
| 1 | מכירות גרפיטיול (retail sales) | ליד נכנס → שיחה משמעותית → נשלח מידע → פולואפ 1 → פולואפ 2 → בהמתנה |
| 2 | לקוחות עסקיים (business) | התקבלה פנייה → נשלחה הצעה → פולואפ 1 → פולואפ 2 → בהמתנה → ממתין לאישור שלנו → שינוי תאריך → **הזמנה מאושרת** |
| 3 | לקוחות עסקיים - גבייה (collection) | ממתין לתשלום → תזכורת 1 → תזכורת 2 → יצאה חשבונית → שולם → יצאה קבלה |
| 4 | לקוחות לפלואפ רחוק (long-term follow-up) | בעתיד הרחוק → קורונה בהמתנה → פולואפים בהמתנה → קורס גרפיטי |
| 5 | שוברי מתנה (gift vouchers) | נרכש שובר-ממתין למימוש |

**Stage-mapping implication:** these are Pipedrive-native and do **not** map 1:1 onto GOS
`DealStage`. Pipelines 3–5 are lifecycle/collection/voucher states, not sales stages. The M3
mapping must define how each legacy stage lands (live GOS stage vs. a terminal won/lost vs. an
archive marker). This is a required owner decision (§10).

### 3b) Pipedrive field definitions

| Entity | Total | Custom | Notable custom fields (for mapping) |
|---|---|---|---|
| Deal | 108 | 60 | `תאריך הסיור`(date), `שעת הסיור`(time), `כמות משתתפים`, `מיקום הסיור`, `סוג פעילות`, `מס הזמנה מהאתר`(website order#), `הסיור אליו נרשמו`, `cal_event_id`, `last_doc_id`(iCount), `מדריך/ה ששובץ/ה`(guide), `עודכן בגאנט סיורים`, `דילים מקושרים`, source/campaign/won fields |
| Person | 53 | 10 | `תעודת זהות`(national id), WhatsApp chat link, `סטטוס` |
| Organization | 47 | 9 | `סוג העסק`, `ח.פ/עוסק מורשה`(tax id), **`iCount_id`**, `איש כספים`, payment terms/method |
| Activity | 39 | 0 | (standard schema) — **24 activity types** incl. `tour`, `סיכום סיור`, `שיבוץ מדריך`, `גבייה`, `פולואפ`, `whatsapp` |

Full custom-field name/type lists (60 deal, 10 person, 9 org) are in the raw JSON. Many deal
custom fields are automation plumbing (links, buttons, "עודכן בגאנט" flags) → **archive, don't
model** candidates.

### 3c) Pipedrive entity counts & status distribution

| Entity | Count | Notes |
|---|---|---|
| **Deals** | **4,908** total | **open 70** · won 1,620 · lost 3,218 (exact, via `/deals/summary`) |
| Persons | present, multi-page | exact count = cheap M1 counting pass (not run — stay read-minimal) |
| Organizations | present, multi-page | same |
| Activities | present (done + undone) | same; likely tens of thousands over 15 yrs |
| Notes | present | available via API |
| Files | present | available via API — **volume unmeasured** (attachment risk, §9) |
| Products | present | Pipedrive product catalog in use |

### 3d) Airtable — MAIN base "גרפיטיול" (24 tables) — operational SSOT

Key operational tables (record counts; `2000+` = bounded-count cap hit, true count higher):

| Table | Records | Role |
|---|---|---|
| **סיורים** (Tours) | 2000+ | **THE operational tour record** (past + future). 136 fields, 12 links. Date = `ת.סיור`(dateTime). |
| **משתתפים** (Participants) | 2000+ | Participant manifest **+ the Deal↔Tour bridge** (`פייפ דיל ID`). 123 fields, 4 links. |
| מעקב תשלומים (Payment tracking) | 1,700 | Operational collection/payments. |
| שכר (Payroll) | 2000+ | Guide payroll (GOS now owns payroll → mostly historical/archive). |
| לקוחות עסקיים (Business customers) | 599 | Org/customer records. |
| סיכומי סיור (Tour summaries) | 294 | Tour debriefs (GOS now has questionnaire summaries). |
| כל המידע על המדריכים (Guides) | 77 | Guide directory (GOS PersonRef = SSOT). |
| רשימת מסרים מתוזמנים (Scheduled msgs) | 2000+ | Outbound message queue (automation). |
| מוצרים / מוצרים - סיורים (Products) | 21 / 22 | Product catalog (GOS Product = SSOT). |
| pricing/help/quote-section tables | 3–199 | Config/reference. |

The main base is **formula-heavy** (214 formula/rollup/lookup fields) — most are derived display
fields that must **not** be migrated (recomputed in GOS). Only **1 attachment field** in the
whole main base (on מוצרים).

### 3e) Airtable — LEGACY base "מוצרים ושירותים - גרפיטיול" (16 tables)

Catalog/template/config — **no operational transactions**. Tables: מוצרים(109), WooCommerce(100),
✨ניסוחים לקוחות עסקיים(169), ניסוחים(16), ניסוחים-מפיקים סוכנים(14), ניסוחים לוואטסאפ(30),
מחירון(38), מדריכות(77), יוזרים בפייפ(14), סוגי לקוחות עסקיים(6), מיקום(9), תנאי תשלום(11),
דאטה(15), **גישה, סיסמאות(61)**, + 2 small. 2 attachment fields total (a meeting-point image, a
template image).

## 4) STEP 4 — Discovery (linkage, future tours, overlap) — VERIFIED FROM DATA

### 4a) Deal↔Tour link — DIRECT shared identifier (primary), plus 2 fallbacks
- **PRIMARY:** `משתתפים.פייפ דיל ID` (numeric Pipedrive deal id) on the Participants table, which
  links to `סיורים` (Tours). The Tours table even rolls the value up (`Pipedrive`,
  `פייפ דיל ID (from משתתפים)`). Chain: **Pipedrive Deal.id → משתתפים.פייפ דיל ID → סיורים**.
  This maps cleanly onto GOS **Deal → Booking → TourEvent**.
- **SECONDARY:** Google Calendar event id — Pipedrive `cal_event_id` ↔ `סיורים.מזהה ארוע ביומן`
  / `link for calendar event`. A strong cross-check and a fallback where a participant row is
  missing.
- **TERTIARY:** website order number — Pipedrive `מס הזמנה מהאתר` ↔ legacy `WooCommerce.WooCommerce ID`
  (for online-sourced deals only).
- **Also present:** `משתתפים.Pip Person ID` links participants to Pipedrive persons.

### 4b) Tables containing FUTURE tours
`סיורים` (main base) — filter `ת.סיור >= today` and `סטטוס` not cancelled. `משתתפים` gives the
future-tour manifest (customers/seats). These two tables are Goal A's operational tour source.

### 4c) Duplication / overlap risks (real, quantified)
- **Guides in 3 places:** main `כל המידע על המדריכים` (77) = legacy `מדריכות` (77) = mirrored;
  GOS `PersonRef` is the SSOT. Import must resolve to PersonRef, not create.
- **Products:** legacy `מוצרים` (109, older/fuller) vs main `מוצרים` (21) vs `מוצרים - סיורים`
  (22); GOS `Product`/`ProductVariant` is SSOT (Woo sync already built). → archive legacy catalog.
- **WooCommerce mapping:** legacy `WooCommerce` (100) overlaps GOS `WooProductMapping`.
- **Locations / payment terms:** `מיקום` (9=9) and `תנאי תשלום` (11=11) mirrored across bases;
  GOS `Location` / `PaymentTerm` are SSOT.
- **Customer identity across systems:** Pipedrive persons/orgs are the CRM SSOT; Airtable
  `לקוחות עסקיים` / `משתתפים` hold denormalized copies. Dedup against **live GOS** contacts
  (WhatsApp/email-created) is still the key M4 risk — but the legacy copies help cross-validate.

### 4d) Make.com / automation fingerprints (visible in the data)
Both systems are saturated with automation plumbing: deal fields like `עודכן בגאנט סיורים`
("updated in tours gantt"), `נבדק על ידי האוטומציה` ("checked by automation"), button/URL fields,
and the legacy base's entire `ניסוחים` (message templates) + `יוזרים בפייפ` (Pipe users, with
`Device ID`) tables are the content/config layer that fed Pipedrive↔Airtable↔Make automations.
Confirms the prep-plan requirement: **inventory + retire Make scenarios before cutover** (they are
active writers on both sides).

### 4e) Legacy-base verdict (the question asked without asking the owner)
The legacy base holds **no data required for tomorrow's operations**. It is the historical
product/pricing catalog + email/WhatsApp templates + config that GOS has already re-implemented
(Products, Pricing, Woo sync, Email/WhatsApp modules, Shared Content). Recommendation:
- **Archive as raw snapshot** (reference only) — do NOT structurally migrate.
- **Exclude entirely from extraction:** `גישה, סיסמאות` (passwords/credentials, 61 rows) — a
  security liability, never snapshot it.
- **Optional selective reference-mapping (owner call, not go-live):** the `ניסוחים` message
  templates, IF the business still wants them as seed content for GOS Shared Content / email
  templates. Otherwise archive.

## 5) STEP 5 / snapshot storage — concrete proposal (approved in principle; not yet created)

- **Bucket name:** `gos-migration-snapshots` (dedicated, **private**).
- **Access config:** public access **DISABLED** — no `r2.dev` domain, no custom domain, no public
  base URL. Reachable only via the existing R2 S3 API credentials (ideally a **separate,
  read/write-scoped R2 API token** for the extractor, not the app's token). This is **not** the
  publicly-served application bucket.
- **Encryption:** R2 encrypts objects at rest by default (SSE, AES-256). Since secrets are
  excluded at the source (§4e), no app-layer encryption is required; if any PII-heavy payload
  worries the owner, we can add client-side AES before upload — decide in M1.
- **Retention:** immutable, write-once snapshots (time-stamped `snapshotId`, never overwritten);
  retain through cutover **+ 12 months** post-decommission, then delete. Optionally enable R2
  Object Lock for true immutability. No versioning needed (immutable ids do the job).
- **Prefix structure:**
  ```
  gos-migration-snapshots/
    pipedrive/<snapshotId>/{deals,persons,organizations,activities,notes,files,fields}.jsonl
    pipedrive/<snapshotId>/files/<fileId>-<name>          # binary attachments
    airtable/main/<snapshotId>/<tableId>.jsonl
    airtable/legacy/<snapshotId>/<tableId>.jsonl          # EXCLUDING the passwords table
    airtable/**/<snapshotId>/attachments/<recId>-<field>-<n>  # downloaded at pull time
    _manifests/<snapshotId>.json                          # counts, checksums, timing
  ```

### Estimated snapshot contents & size
- **Pipedrive JSON:** ~4,908 deals + persons + orgs + (tens of thousands of) activities + notes.
  At ~2–8 KB/record this is roughly **0.3–1.5 GB** of JSON (order-of-magnitude; exact after the
  M1 counting pass).
- **Airtable JSON:** main base ~"several × 2000+" rows across 24 tables + legacy 16 small tables
  ≈ **50–150 MB**.
- **Airtable attachments:** only 3 attachment fields, small tables → **tens of MB** (low).
- **Pipedrive files: the one real unknown** — count/size not yet measured; could range from tens
  of MB to several GB. **Plus a Google Drive dependency** (documents referenced by link, not in
  either API) — a separate extraction decision.
- **Working estimate:** low-single-digit GB total excluding Pipedrive files/Drive; those two set
  the ceiling and need the M1 file-count measurement before we size the bucket.

## 6) STEP 6 — remaining report items

- **Attachment risks (§9 detail):** Airtable = low (few fields, download-at-pull for URL expiry).
  Pipedrive files = unmeasured; **Google Drive-hosted documents** (folders referenced by
  `תיקייה בדרייב` / Drive links) are outside both APIs and would be lost on decommission if not
  separately captured — flag for the owner.
- **What runs next (no owner input needed):** M1 counting/measurement pass — exact
  person/org/activity/note counts + **Pipedrive file count & total bytes** (the sizing blocker),
  and a Make.com scenario inventory walkthrough.

## 7) Business mapping decisions genuinely required from the product owner (the smallest set)

1. **Stage mapping (blocking deal load).** How should the 5 Pipedrive pipelines / 25 stages land
   in GOS? Proposal to react to: pipeline 2 open stages → live GOS sales stages; `הזמנה מאושרת` +
   pipeline 3 → won/collection; lost → lost; pipelines 4–5 (long-term/vouchers) → archived or a
   dedicated stage. Owner confirms/edits.
2. **"Active" definition for Goal A.** Confirm active = the **70 open deals** + their future
   tours (`ת.סיור >= today`) + open activities. (Recommended; owner confirms the cut line.)
3. **Historical deals (1,620 won + 3,218 lost): structured or archived?** Do you need won/lost
   deal **amounts** queryable in GOS, or is archive-attached raw context enough? (Biggest Goal B
   modeling lever.)
4. **Legacy Airtable base: archive-only — confirm.** And a yes/no on whether the `ניסוחים`
   message templates should be seeded into GOS Shared Content / email templates, or left archived.
   (The passwords table is excluded regardless — no decision needed.)
5. **Google Drive documents.** Historical documents live in Drive (referenced by link). In scope
   to capture into the snapshot, or leave in Drive? (Affects extractor scope + decommission risk.)
6. **Pipedrive owners → GOS.** Map historical Pipedrive users (e.g. "Elinoy") to current GOS
   admins for attribution, or preserve as name-only labels? (There is no GOS `User` model.)

Everything else (identity dedup rules, orderNo policy, freeze window) is already captured in the
prep plan and does not block the next step.

---

## Appendix — safety posture (upheld)
- GET/read only; no writes to Pipedrive/Airtable/GOS; no records created/updated/merged/deleted.
- No full extraction (bounded counts capped at 2,000/table).
- No secrets exposed: only variable names/lengths + API-returned identities (company/user/base
  names) were printed. Raw inventory is gitignored. The passwords table's **contents were never
  read** — only its existence/field-count from schema metadata.
- No deployment triggered by this audit.
