# Pipedrive + Make.com Shutdown-Readiness Audit

**Date:** 2026-08-03
**Posture:** **READ-ONLY.** GET requests only against the Make API v2 and the Pipedrive API v1;
SELECT-only against the production GOS database. **Nothing was paused, disabled, edited, renamed,
deleted, rescheduled, migrated or triggered.** No token was rotated. No test deal was created. No
customer message was sent. No GOS runtime behaviour was altered. No secret value is printed below —
only names, presence and lengths.

**Method / evidence base**

| Source | What was read |
|---|---|
| Make API v2 (`us1.make.com`) | 233 scenarios · 233 blueprints · 233 execution-log sets (50 most recent runs each) · 166 hooks · 45 connections · 23 folders · 4 data stores |
| Pipedrive API v1 (`grafitiyul`) | 40 webhooks · 5 pipelines · 25 stages · 108 deal fields · 320 filters · 24 activity types · 14 users · recent deals/activities/notes |
| GOS production DB | IngressEvent · MirrorEvent · LegacyRecord · Deal · DealMarketing · CommunicationEvent/Delivery · AdminReportDelivery |
| GOS production env | Operational switch values (booleans/URLs); credentials as presence-only |
| GOS source | `server/src/ingress/`, `server/src/mirror/`, `server/src/adminReports/`, `server/src/automations/` |
| Prior audits | `GOS-make-com-audit-2026-07-29.md` · `GOS-lead-ingestion-audit-2026-07-30.md` · `GOS-cutover-final-2026-07-31.md` |

Raw payloads live in the session scratchpad only and are **not committed** — blueprints contain
plaintext Wassenger/WATI/Bitly credentials (see the 2026-07-29 audit §9.5).

---

## ⛔ READ THIS FIRST — the audit found an active production incident

**This is not a tidy "everything is ready to switch off" picture. Something is already broken, and
it is breaking in a way that looks like progress.**

### Finding P0-1 — The Pipedrive daily API budget has been exhausted every day since 2026-07-30

**Proven.** 103 executions across **29 different Make scenarios** failed with:

```
pipedrive | DataError | 429: daily request budget exceeded (Please check developers.pipedrive.com)
```

| Day | ok | err | of which 429 | Make ops |
|---|---|---|---|---|
| 2026-07-29 | 144 | 0 | 0 | 891 |
| **2026-07-30** | 133 | 16 | **9** | 1074 |
| **2026-07-31** | 116 | 40 | **15** | 1364 |
| **2026-08-01** | 35 | 75 | **44** | 387 |
| **2026-08-02** | 37 | 17 | **13** | 174 |
| 2026-08-03 | 32 | 0 | 0 | 514 |

Zero 429s on every one of the 20 days before 2026-07-30. The failure begins exactly on the cutover date.

### Finding P0-2 — It broke the lead router, and leads were lost

`Find/Create UTM` (**3897811**) is the shared router every website and campaign lead passes through.
Its last 50 executions:

| Day | ok | err |
|---|---|---|
| 2026-08-01 | **0** | **39** |
| 2026-08-02 | 1 | 9 |
| 2026-08-03 | 1 | 0 |

**Every single attempt to route a lead into Pipedrive failed between 2026-08-01T09:05 and
2026-08-01T13:23**, and there was no successful run at all between 2026-07-31 and 2026-08-02T01:23.
The upstream caller `pipe4u` (**1069253**) recorded the mirror image: 27 × `500 Internal Server Error`
on the same day.

Corroborated GOS-side: **zero** Pipedrive-bridge deals were created on 2026-08-01 (bridge deals run
26617 on 07-31 → 26619 on 08-02 → 26620 on 08-03; nothing on 08-01).

Elementor form webhooks are fire-and-forget with no retry and no DLQ (`dlqCount = 0` on 3897811).
**Leads submitted in that window are gone. They are not queued anywhere.**

### Finding P0-3 — Make auto-deactivated 22 scenarios as a side-effect

27 scenarios are now flagged `isinvalid` and inactive. **22 of them hit the Pipedrive 429 error**, and
their last-run dates cluster tightly on 2026-07-30 → 2026-08-02. Only **3** scenarios in the entire
estate were edited by a human since 2026-07-25.

**Nobody turned these off deliberately.** Make deactivates a scenario after consecutive failures.
Among the 22 are **customer-facing and money-facing** automations:

| ID | Auto-disabled scenario | What stopped |
|---|---|---|
| 430267 / 430273 | לקוחות עסקיים - הוצאת קבלות פעם ביום (08:00 / 16:00) | **Business receipts stopped being issued** |
| 430295 | תזכורת לתשלום ביום הפעילות עבור הלקוח + המדריך | Payment reminder on activity day |
| 430291 | תזכורת לקראת פעילות + תזכורות לתשלום (שבת-ערב) | Pre-activity + payment reminders |
| 430262 / 430274 | לקוחות פרטיים - פולואפ 1 (10:00 / 16:00) | Private-customer follow-up 1 |
| 430266 | לקוחות פרטיים - פולואפ 2 | Private-customer follow-up 2 |
| 430292 | מייל+וואטסאפ חודש אחרי פעילות | One-month-after follow-up |
| 430261 | יום אחרי פעילות → פייפליין גבייה + מייל סיכום | **Collection pipeline transition** |
| 430265 / 430300 | מייל למשרד: תזכורות תשלום / פולואפים למחר | Office daily digests |
| 430238 | דו״ח יומי לגיליון + וואטסאפ "המצב היום" | Daily management report |
| 1070979 / 1353334 | לוסט לדיל אחרי 30 / 60 יום | Automatic lost-marking |
| 1989068 | סיכום סיור - לקוח עיסקי | Business tour summary |
| 430297 | מיזוג אנשי קשר פעם ביום | Contact dedupe |
| 799554 | דיל פתוח ללא משימה מקבל משימה בחצות | Task safety net |
| 1052263 | מנגנון בקרה | The Make-side control mechanism |

**Consequence for this audit:** the current "active/inactive" state of the Make estate is **not a
record of decisions**. Roughly a fifth of it is collateral damage from an outage. Any "it's already
off, so it must be safe" reasoning is invalid until the owner reviews this list specifically.

### Root cause — UNKNOWN, and I will not guess

What is **proven**: the budget is exhausted, the date is 2026-07-30, the effects are as above.

What is **ruled out**: GOS's Pipedrive *file poller* is retired by `legacyPolicy` (`isRetired('pipedrive','file')`
→ `buildPollTargets` returns no Pipedrive target) and produced exactly **1** event in 45 days. GOS's
inbound webhook (1756503) consumes no Pipedrive API budget. GOS's remaining Pipedrive calls are
bootstrap fetches on uncrosswalked entities — ~70 in 45 days. **GOS's steady-state Pipedrive API usage
is too small to explain this.**

What is **inferred but unproven**: the 2026-07-30 GOS cutover import (299 `LegacyRecord` deal rows
that day, 403 mirror events) plausibly drained the budget once — but a one-off import does not explain
four consecutive days, because Pipedrive budgets reset daily.

**How to resolve it (owner action, 5 minutes):** Pipedrive → Settings → Company settings → **API usage**
(or `developers.pipedrive.com` → token budget) shows consumption per token and per day. There are two
Pipedrive API tokens in Make carrying 110 and 96 scenario usages respectively, plus GOS's token. That
screen names the culprit. **Do this before any shutdown decision** — if the estate is running at the
cap, disabling scenarios will *appear* to fix things for reasons unrelated to readiness.

---

## PART 1 — Make.com complete inventory

### 1.1 Headline counts

| Bucket | Count |
|---|---|
| **Total scenarios** | **233** |
| Active | 119 |
| — active **and** ran in the last 30 days ("live") | **73** |
| — active but **zero** runs in the last 30 days | **46** (6 of them are on the protected lead-intake list — see Part 8) |
| Inactive | 114 |
| — of which flagged `isinvalid` (broken config) | **27** |
| — of which 22 are the 2026-07-30 auto-deactivation casualties | 22 |
| Paused (`isPaused`) | 0 |
| Scenarios with incomplete executions (DLQ) | 7 |

> Comparison to the 2026-07-29 audit (142 active / 91 inactive): **23 scenarios left the active set in
> five days.** Per §P0-3 this was overwhelmingly automatic, not deliberate.

### 1.2 The 20-field per-scenario record

The full 233-row inventory is delivered in two machine-readable forms rather than inline prose,
because a 233 × 26 table is unusable in markdown:

- **`docs/architecture/GOS-shutdown-decisions-2026-08-03.csv`** — one row per scenario with all 26
  requested columns, including the two blank owner columns. Open in Excel/Sheets, fill in
  `OWNER_DECISION` and `OWNER_NOTES`, return it.
- **`docs/architecture/GOS-make-inventory-2026-08-03.md`** — the same data grouped by folder as
  readable tables (ID · status · trigger · systems · sends-comms · runs/errors · last run · name).

Fields captured per scenario: id · name · folder · active/inactive/invalid · trigger module ·
schedule JSON · webhook URL · systems touched · whether it sends customer/staff communication ·
write operations · runs sampled · errors · error rate · last run · last error + message · DLQ count ·
last edited · scenarios it calls.

**Coverage honesty:** Make's log endpoint caps at **50 executions per scenario**. For low-volume
scenarios that is months of history; for the busiest it is 2–3 days. Every "runs/errors" figure is
therefore *"within the last 50 executions"*, and the window is stated per scenario in the CSV
(`last_run`). Scenarios with **0 logs** genuinely have no retained execution history — that is
reported as unknown, not as "never ran".

### 1.3 Trigger and app distribution (all 233)

```
Triggers:   125 gateway webhooks (instant) · scheduled (daily/interval/weekly) · 1 Meta instant hook
Apps:       pipedrive 167 · airtable 118 · google-email 77 · http 66 · app#testing-g3yhep 50
            app#bulldogwp-6wcm2v 46 · app#wassenger-0waevn 20 · google-calendar 16 · sheets 15
            drive 14 · icount 13 · woocommerce 12 · bitly 10 · cognitoforms 7 · short-cm 7
            facebook-lead-ads 4 · smoove 2 · prospero 2 · fillout 1
```

### 1.4 Scenario chaining — the real topology

**56 HTTP edges from 41 distinct scenarios** call another Make scenario's webhook. Measured precisely
(only URLs used as an HTTP module's request target, not URLs that merely appear as data):

| Target | Fan-in | Role |
|---|---|---|
| **1069253 `pipe4u`** | **12 callers** | The real lead front door |
| **2125961 `הרכבת מסר / תוכן`** | 10 callers | Message/content assembly (4 callers still active) |
| 889158 | 3 | Tour-registration form handler |
| 1651940 | 2 | Post-WON message |
| **3897811 `Find/Create UTM`** | 1 (`pipe4u`) | Pipedrive person/deal dedupe + create |

**The lead chain is two hops, not one:**

```
12 lead sources  →  1069253 pipe4u  →  3897811 Find/Create UTM  →  Pipedrive
```

Callers of `pipe4u`: 430307 (Elementor LP), 430320 (bat-mitzvah LP), 430315 (product pages),
430331 (contact page), 430321 (footer), 430346 (contact popup), 430271 (abandoned cart),
430352 (Meta — now inactive), 1449188, 3162997, 1711911, 4359629.

**Retirement order is forced by this graph: leaves first → `pipe4u` second-to-last → `Find/Create UTM`
last.** Reversing it breaks every caller silently.

4 outbound targets point at hooks **not owned by any scenario in this account** (`ghjtyty8vdyj`,
`69hxwe4kn3f3`, `g3eiqlxptri1`, `qr8bkssf9znw`, `q56scym49n8t`, `8temuau6685t`) — dead calls or a
second Make account. **Unknown; flagged for manual review.**

---

## PART 2 — Make scenarios grouped by business domain

Ownership legend: **M** = still owned by Make · **G** = now owned by GOS · **D** = duplicated ·
**⚠** = broken/auto-disabled.

| Domain | Live Make scenarios | Owned by Make | Owned by GOS | Verdict |
|---|---|---|---|---|
| **Lead intake** | 3897811, 1069253, 430307, 430331, 430315, 430321, 430346, 430320, 430271, 430317, 430335, 430343 | **M — the whole website-form path** | Meta Lead Ads only (direct, live) | **KEEP.** GOS `website_form` ingress is coded but **not credentialed** (`WEBSITE_FORM_SECRET` unset). No GOS path exists for 12 Elementor forms. |
| **CRM (deal/contact/org writes)** | 698867, 1830861, 4359629, 430353, 1411537 | M (writes into Pipedrive) | **G** — GOS is the CRM SoT since 2026-07-31 | Make still *writes to Pipedrive*, GOS mirrors create-only. Not duplicated into GOS, but Pipedrive is being maintained for no consumer beyond the bridge. |
| **Payments / clearing** | 835533, 835854, 1711911, 3934706 | M (payment links) | **G** — Cardcom + iCount native, `DealPaymentLink` live | **D — duplicated.** GOS issues payment links today (4 in 60d). |
| **Accounting (iCount)** | 1889926, 4602660, 4549250, ⚠430267, ⚠430273 | M | **G** — native `ICOUNT_*` | **D + ⚠.** Receipt scenarios are auto-disabled right now. |
| **Tour scheduling / calendar** | 4095754, 2600471, 430351 | M (Google Calendar via Airtable) | **G** — Tour Calendar sync worker, TourEvent SSOT | **D — duplicated.** |
| **Open tours / exposure** | 3252574, 3106389, 3314785, 3162997 | M (Cognito) | **G** — Open Tours module, all 7 slices shipped | Mostly idle; GOS owns it. |
| **Customer confirmations** | 430326, 440477, 965408, 889158 | M | **G** — Confirmation Email module (dedicated) | **D — duplicated.** |
| **Guide communications** | 4749928, 1126290, 1051602, 4452993, 3956203, 1126045, 430349 | **M — actively running daily** | **G** — Guide Portal + reports #11–#16 | **D — duplicated and both firing.** See Part 7. |
| **Manager reports** | ⚠430238, ⚠430265, ⚠430300, 1052263⚠ | ⚠ auto-disabled | **G** — Admin Reports #1–#26, verified sending | GOS has taken over; Make's died by accident, not decision. |
| **WhatsApp** | 2125961, 3121861, 440474, 2607384, 3734669, 1015939, 440482 | M (Wassenger/WATI) | **G** — Baileys bridge: 80,701 messages in 30d | **D.** GOS is overwhelmingly the larger channel already. |
| **Email** | 1443901, 1817282, 2725066, 1564301, 964304, 4447721, 4345044 | M (Gmail) | **G** — Email module, 7,546 msgs/30d | **D.** |
| **WooCommerce** | 430271, 440477, 430347, 3648282, 430322 | M | **G** — Woo sync live (`WOO_SYNC_BULK_ENABLED=true`, 252 variation links) | Split: GOS owns *publishing*, Make owns *order ingestion*. |
| **Recruitment / training** | 704964, 430349 | M | **G** — Staff module SSOT | Idle. |
| **File handling** | 889252, 4131369, 1978153 | M (Drive/Photos folders) | **G** — Files + Tour Gallery | **D.** |
| **Payroll** | 2693681, 2906484, 3190154, 2883326, 2844878, 4207107 | **M — actively running** | **G** — Payroll module, all 6 slices shipped | **D — duplicated, both live.** |
| **Quotes / proposals** | 1443901, 1817282 | M (Prospero) | **G** — Quote module | **D.** |
| **Legacy migration** | 4548217, 4357153, 430254, 1899057 | M (Airtable housekeeping) | — | Airtable retired 2026-07-31; these maintain a dead system. |
| **Internal admin** | 1213773, 4459424, 430341, 601178 | M | — | Utility/helper scenarios. |
| **Unknown / unclear** | 1445570 (77% error rate), 3018034, 1914956, 430314, 430339, 4698828 | ? | ? | **NEEDS MANUAL REVIEW.** |

---

## PART 3 — Make shutdown recommendation

### 3.1 Counts

| Bucket | Count |
|---|---|
| **Safe to disable now** (no GOS gap, no lead dependency, verified replaced) | **0** |
| **Keep active** (protected lead-intake chain) | **12** |
| **Keep temporarily** (live, duplicated by GOS, parity unverified) | **67** |
| **Needs manual review** | **67** — of which **22** auto-disabled by the incident, **40** active with no execution history, **5** other `isinvalid` |
| **Already obsolete** (inactive ≥30 days, incl. 26 in ארכיון) | **87** |
| **Total** | **233** |
| *Of the above, unclear ownership* | **6** unresolved outbound hook targets + 1445570 |

**Why "safe to disable now" is zero, and I want to be direct about it:** the question is not whether
GOS *has* the capability — it mostly does. It is whether GOS is *carrying the traffic*. Three
independent measurements say it is not yet:

1. `WEBSITE_FORM_SECRET` is **unset** → the GOS website-form endpoint returns "not configured". All 12
   Elementor forms have exactly one path, and it runs through Make.
2. `WOO_PRIMARY_WEBHOOK_SECRET` is **unset** → the GOS Woo ingress cannot run. Woo orders reach GOS
   only via Make → Pipedrive → mirror.
3. `CommunicationEvent` holds **4 rows, all `archived`**, and `CommunicationDelivery` shows **2 sends
   in 30 days**. The Communication Center is not yet carrying customer-facing content.

Disabling anything today removes a working path and puts nothing in its place. That is a business
decision the owner may still make — but it should be made knowing this, not on a "GOS replaces it"
assumption.

### 3.2 Decision table

The full per-scenario decision table with the requested columns (Scenario · Keep/Disable/Review · Why ·
GOS replacement · Prerequisite before disable · Risk level · **Owner decision** left blank) is the CSV:

**`docs/architecture/GOS-shutdown-decisions-2026-08-03.csv`**

Summary of the recommendation column across all 233:

| Recommendation | Count | Rationale |
|---|---|---|
| KEEP ACTIVE | 12 | Lead-intake chain + the two routers. See Part 5. |
| KEEP TEMPORARILY | 67 | Live, duplicated by GOS, but GOS parity not yet verified in production. |
| NEEDS MANUAL REVIEW | 67 | Auto-disabled by the incident (22), active with no execution history (40), or otherwise `isinvalid` (5). |
| ALREADY OBSOLETE | 87 | Inactive ≥30 days, Airtable-only, or in ארכיון. |
| SAFE TO DISABLE | 0 | — |

**Companion sheets delivered:**

| File | Rows | Owner columns |
|---|---|---|
| `GOS-shutdown-decisions-2026-08-03.csv` | 233 Make scenarios | `OWNER_DECISION`, `OWNER_NOTES` |
| `GOS-pipedrive-webhook-decisions-2026-08-03.csv` | 40 Pipedrive webhooks | `OWNER_DECISION`, `OWNER_NOTES` |
| `GOS-pipedrive-automation-decisions-TEMPLATE.csv` | header only — **cannot be auto-populated** (Part 4.1) | to be filled after the UI export |

---

## PART 4 — Pipedrive automations inventory

### 4.1 A hard limitation, stated plainly

**Pipedrive Workflow Automations cannot be listed through the API.** Verified empirically — all
returned `404`:

```
GET /v1/automations          → 404   GET /v1/workflows            → 404
GET /v2/automations          → 404   GET /v1/workflowAutomations  → 404
GET /v1/automations/list     → 404   GET /v1/legacyAutomations    → 404
```

There is no read endpoint, in any API version, with any scope. **A complete inventory of Pipedrive
Workflow Automations is impossible from here and must be exported by hand.**

> **Owner action required:** Pipedrive → **Tools and apps → Workflow automations**. Filter to *All*
> (not just *My* automations) and include inactive ones. Export or screenshot: name, status, trigger,
> conditions, actions. Roughly 20 minutes. Until then Part 4 is **structurally incomplete**, and I am
> not going to fill the gap by guessing from names.

### 4.2 What *is* machine-readable: 40 webhooks, all active

This is the outbound automation surface, and it is complete and proven.

| Destination | Count |
|---|---|
| `hook.us1.make.com` | 36 |
| `hook.integromat.com` (legacy domain, still working) | 2 |
| `hook.eu1.make.com` | 1 |
| **`app.grafitiyul.co.il` (GOS)** | **1** |

**The single GOS bridge:**

| Field | Value |
|---|---|
| Webhook id | **1756503** |
| Events | `*.*` — **every object, every action** |
| Destination | `app.grafitiyul.co.il` → `POST /api/mirror/pipedrive` |
| Added | **2026-07-30** |
| Last delivery | **2026-08-03T17:06** |
| Last HTTP status | **200** |
| Auth | HTTP Basic; `MIRROR_PIPEDRIVE_WEBHOOK_SECRET` **is configured** |

**This one row is the entire lead-intake bridge. It is P0-protected — see Part 5.**

**Never-delivered webhooks (8)** — `last_delivery_time` is null despite being active:
124385 (`added.user`), 660914 (רדיפה לקבוע סיור), 660915 (לינק צ'אט ווסנג'ר), 660918 (שינוי שלב →
איירטייבל), 661063 (אקטיביטי לשיבוץ מדריך — name says *"נסגר לבקשת אלינוי - 14.2.24"*),
661090 (קבוצתי - רדיפה), 661093 (לקוח עסקי - גאנט), 1085997 (נוצר פתק ידני).
These are the strongest *safe-to-remove* candidates in the entire Pipedrive estate — but they are
webhooks, not automations, and removing them is still a write. **Recommendation: NEEDS MANUAL REVIEW,
then delete as a group.**

The other 31 Make-bound webhooks all have recent deliveries and `last_http_status = 200`; each is
named after the business behaviour it triggers (e.g. `דיל הפך לוון > מייק לשליחת תוכן`,
`סגירת משימות אוטומטיות אחרי וון - MAKE.COM`, `שליחת וואטסאפ מיידי`). Full rows are in the CSV
companion sheet. **Whether each is attached to a Pipedrive Workflow Automation or was created directly
by Make is NOT determinable from the API — inferred, not proven.**

### 4.3 Pipeline / stage structure (complete, proven)

| Pipeline | Stages |
|---|---|
| **1 מכירות גרפיטיול** | 1 ליד נכנס · 3 התקיימה שיחה משמעותית · 35 נשלח מידע נוסף · 20 פולואפ 1 · 21 פולואפ 2 · 2 בהמתנה |
| **2 לקוחות עסקיים** | 6 התקבלה פנייה · 7 נשלחה הצעה · 8 פולואפ 1 · 9 פולואפ 2 · 22 בהמתנה · 10 ממתין לאישור שלנו · 11 שינוי תאריך · 12 הזמנה מאושרת |
| **3 לקוחות עסקיים - גבייה** | 13 ממתין לתשלום · 14 תזכורת 1 · 15 תזכורת 2 · 31 יצאה חשבונית מס · 16 שולם · 23 יצאה קבלה |
| **4 לקוחות לפלואפ רחוק** | 24 בעתיד הרחוק · 25 קורונה · 29 פולואפים בהמתנה · 34 קורס גרפיטי |
| **5 שוברי מתנה** | 32 נרכש שובר-ממתין למימוש |

**`stage_id = 1` (ליד נכנס) is where every Make-created lead lands.** That is the stage the GOS bridge
depends on.

---

## PART 5 — Lead intake must survive

### 5.1 The complete live lead map

| # | Source | First system | Trigger | Pipedrive required? | Make required? | How GOS receives it | Status |
|---|---|---|---|---|---|---|---|
| 1 | **Meta Lead Ads** | **GOS** | Page 557050430995914 → `POST /api/ingress/meta` | **NO** | **NO** | Direct ingress | ✅ **Migrated.** 20 deals; live 2026-08-03T17:03. Make's 430352 is now inactive. |
| 2 | Contact page (L1) | WordPress | Elementor → Make hook `6ky8ly1b…` | **YES** | **YES** | Make → pipe4u → UTM → Pipedrive → webhook 1756503 → mirror | 🔴 **Make-only** |
| 3 | Footer HE/EN (L2/L3) | WordPress | hook `bckioo3y…` | **YES** | **YES** | same | 🔴 Make-only (127 + 97 pages) |
| 4 | Product pages (L7/L8) | WordPress | hook `zm8pt412…` | **YES** | **YES** | same | 🔴 Make-only |
| 5 | Contact popup (L4) | WordPress | hook `sudj8rna…` | **YES** | **YES** | same | 🔴 Make-only (263 pages) |
| 6 | Elementor LP (L14) | WordPress | hook `2katu8xl…` | **YES** | **YES** | same | 🔴 Make-only (42 runs — busiest form) |
| 7 | Bat-mitzvah LP (L13) | WordPress | hook `d715242b…` | **YES** | **YES** | same | 🔴 Make-only |
| 8 | Abandoned cart | WooCommerce | Make 430271 nightly 00:30 | **YES** | **YES** | same | 🔴 Make-only, 1,282-order pool |
| 9 | Woo checkout order | WooCommerce | Woo webhook → Make 440477 | **YES** | **YES** | same | 🔴 Make-only; GOS Woo ingress **not credentialed** |
| 10 | Travel-agent form | Cognito | Make 1993342 / 1993303 | **YES** | **YES** | same | 🔴 Make-only (GOS Agent Reservations exists but is a different flow) |
| 11 | Google Forms ×3 | Google | Make 430317 / 430334 / 430330 | **YES** | **YES** | same | ⚠️ 0 runs in 30d — verify still used |
| 12 | Smoove subscribers | Smoove | Make 430335 / 430343 | **YES** | **YES** | same | ⚠️ 0 runs in 30d |
| 13 | Manual Pipedrive lead | Pipedrive | human | **YES** | NO | webhook 1756503 → mirror | 🟡 Bridge-only |
| 14 | WhatsApp-created lead | **GOS** | Baileys bridge | **NO** | **NO** | native | ✅ Migrated |
| 15 | Email-created lead | **GOS** | Gmail sync | **NO** | **NO** | native | ✅ Migrated |

**Replay / idempotency:** GOS ingress keys on `(source, idempotencyKey)`; the mirror keys on
`(system, entity, externalId, idempotencyKey)`. Both persist the raw payload **before** processing, so
a GOS-side failure is replayable. **The Make hop is not** — an Elementor webhook that fails is gone
(P0-2). **Duplicate risk:** the mirror is `create`-only for deals/contacts/orgs; a repeat webhook for a
crosswalked deal resolves to `noop` (83 in 45d) or `legacy_retired` (76) and cannot double-create.
**Failure behaviour:** GOS answers 200 once the payload is durable and lets the retry worker own it;
Make has no retry. **Monitoring:** GOS has the בקרה detector sweep + `MirrorEvent` status; **Make has
no alerting at all** — which is precisely why the 2026-08-01 outage went unnoticed.

### 5.2 🔒 DO NOT DISABLE — LEAD INTAKE DEPENDENCIES

**Disabling, editing, renaming, or reconnecting anything on this list stops new leads reaching GOS.**

**Make scenarios (12):**

| ID | Name | Role |
|---|---|---|
| **3897811** | Find/Create UTM | **Terminal router** — creates the Pipedrive person + deal. Retire **last**. |
| **1069253** | pipe4u | **Front door** — 12 callers. Retire second-to-last. |
| 430307 | דף נחיתה אלמנטור > פייפדרייב | Elementor LP leads |
| 430331 | טופס עמוד צור קשר באתר | Contact page |
| 430321 | טופס פוטר באתר | Footer (127+97 pages) |
| 430346 | פופאפ צור קשר באתר | Popup (263 pages) |
| 430315 | טופס בעמודי מוצר באתר | Product pages |
| 430320 | דף נחיתה בת מצווה | Bat-mitzvah LP |
| 430271 | נטישות עגלה → פייפדרייב | Abandoned cart |
| 1449188 / 3162997 / 1711911 | pipe4u callers | Unverified purpose — protected until reviewed |

**Pipedrive dependencies:**

| Item | Why protected |
|---|---|
| **Webhook 1756503 → `app.grafitiyul.co.il`** | **THE bridge.** Delete it and Pipedrive leads stop reaching GOS entirely. |
| Pipedrive **API token(s)** used by Make connections 456551 + 456555 | 206 scenario usages. Revoking halts the estate instantly. |
| `PIPEDRIVE_API_TOKEN` + `PIPEDRIVE_COMPANY_DOMAIN` (GOS) | Mirror bootstrap fetches |
| `MIRROR_PIPEDRIVE_WEBHOOK_SECRET` (GOS) | Bridge auth — without it the route 503s |
| **Pipeline 1, `stage_id = 1` (ליד נכנס)** | Every Make-created lead lands here |
| Custom fields `35a2565c…` (מקור), `b5fbb89a…` (מקור-רשימה סגורה), `d5f68c10…` (תוכן הפנייה), `7009bcae…` (timestamp) | Written by the lead flow, read by the mirror |
| Pipedrive user **12059355 (Elinoy)** | Owner of all 40 webhooks; deactivating the user risks the subscriptions |

**Make infrastructure:**

| Item | Why protected |
|---|---|
| Connections **456551**, **456555** (`pipedrive-apikey`) | 110 + 96 scenario usages |
| Gateway hooks `6ky8ly1b…`, `bckioo3y…`, `zm8pt412…`, `sudj8rna…`, `2katu8xl…`, `d715242b…` | The 32-char URL **is** the only credential; regenerating breaks the WordPress form |
| Custom app `app#testing-g3yhep` (`formatIsrNumber`) | Israeli phone normalisation inside the router |

**GOS-side (must stay ON):**
`MIRROR_CAPTURE_ENABLED=true` · `MIRROR_APPLY_ENABLED=true` · `LEGACY_MIRROR_MODE` **unset** (cutover) ·
`INGRESS_DRY_RUN=false` · `legacyPolicy` `pipedrive.deal/contact/organization = PROPOSE_ONLY`.

---

## PART 6 — Pipedrive non-automation dependencies

What breaks if the Pipedrive account is disconnected or downgraded:

| Dependency | State | Breaks if Pipedrive goes away |
|---|---|---|
| **Webhook 1756503 → GOS** | Active, 200, delivering | 🔴 **P0 — all non-Meta lead intake** |
| API tokens (2 in Make + 1 in GOS) | Active | 🔴 206 Make scenarios + GOS bootstrap |
| **Custom fields read by GOS** | 60 custom deal fields | 🟠 Mirror field mapping; historical `LegacyRecord.payload` unaffected (already imported) |
| **Filters** | **320** | 🟠 Unknown operational use — **NEEDS MANUAL REVIEW**, none are readable as "used by X" |
| Pipelines / stages | 5 / 25 | 🔴 `stage_id=1` is the lead landing zone |
| User ownership mapping | 14 users, **only 2 active** (Elinoy `manager@`, `support@leandolini.com`) | 🟢 Low — GOS owns staff |
| Activity types | 24 (10 inactive) | 🟢 Activities retired by `legacyPolicy` (`task: NONE`) |
| **Legacy file links** | 8,570 `LegacyRecord` file rows | 🟠 Bodies already on R2 for active deals; **closed-deal files are metadata-only crosswalks** — the binary still lives in Pipedrive |
| Email sync | Pipedrive-side | 🟢 GOS Gmail integration is independent |
| Archived deal access | 24,661 deals imported to `LegacyRecord` | 🟢 Content preserved in GOS |
| Notes / activities | 74,516 / 127,036 imported | 🟢 Preserved |
| Scheduled import jobs | **None running** — Pipedrive file poller retired by `legacyPolicy` | 🟢 |
| Collection filter dependencies | GOS `collection.js` is server-side SSOT | 🟢 |

**The one genuinely unresolved item is legacy file bodies for closed deals.** Per Policy C
(2026-07-31), closed-deal files were crosswalked **metadata-only** — the actual file content was never
copied to R2. Downgrading Pipedrive to a tier without file storage, or closing the account, **destroys
those binaries.** This is not a lead-intake risk but it is a permanent data-loss risk, and it is not
on anyone's checklist. **P1.**

---

## PART 7 — Duplicate and double-send audit

| Process | Make (live?) | GOS (live?) | Both firing? | Should own | Evidence |
|---|---|---|---|---|---|
| **Confirmation emails** | ✅ 430326, 440477, 965408, 889158 | ✅ Confirmation Email module | **⚠️ LIKELY** | **GOS** | Both paths exist and both have recent runs. **Not proven double-sent** — no shared correlation id. **Verify before disabling either.** |
| **Payment notifications** | ⚠️ 430295, 430291 auto-disabled; 4549250 live | ✅ Cardcom + `DealPaymentLink` (4/60d) | No (Make side is broken) | **GOS** | Make's reminders are down since 2026-07-31 |
| **WON notifications** | ✅ 1015939, 1651940, 1411537 | ✅ Report #26 (1 sent 2026-08-03) | **YES — both fired on 08-03** | **GOS** | `transitionDealToWon` is the ONE writer; Make fires off the Pipedrive webhook |
| **Guide reminders** | ✅ 4452993, 3956203, 1126290, 1051602 (all ran 2026-08-02/03) | ✅ Reports #11–#16 (#12: 15 sent, #14/#15/#16: 6 each, newest 2026-08-03) | **YES — CONFIRMED BOTH LIVE** | **GOS** | **Highest double-send risk in the estate.** Guides are receiving two sets of WhatsApp messages. |
| **Coordination calls** | ✅ 4749928 | ✅ Reports #4, #5, #6, #21–#24 (#5 sent 2026-08-03T17:04, #6 sent 12:00) | **YES** | **GOS** | Both active |
| **Tour summaries** | ✅ 3956203, 1051602, 1989068⚠ | ✅ Reports #7, #8 (#7 sent 2026-08-03T03:00) | **YES** | **GOS** | Both ran the same morning |
| **Logistics messages** | ✅ 2125961 | ✅ Report #20 (sent 2026-08-03T15:01) | **YES** | **GOS** | |
| **Calendar events** | ✅ 4095754, 440477, 2600471 | ✅ Tour Calendar sync worker | **YES** | **GOS** | TourEvent is SSOT; Make writes from Airtable |
| **WooCommerce sync** | ✅ 430347, 3648282 | ✅ Woo sync (252 variation links, newest 2026-08-03T13:19) | Partially | **GOS** for publishing; Make for order ingest | Different directions — not a true duplicate |
| **iCount documents** | ⚠️ 430267/430273 auto-disabled; 1889926, 4602660 live | ✅ Native iCount module | **Partially** | **GOS** | |
| **WhatsApp messages** | ✅ Wassenger ×3 paths + WATI | ✅ Baileys: **33,091 outgoing / 30d** | **YES** | **GOS** | GOS is ~100× the volume already |
| **Lead alerts** | ✅ 1069253 (office notify) | ✅ Report #25 (**11 sent**, newest 2026-08-03T17:03) | **YES** | **GOS** | Report #25 replaced retired AUT-004 |
| **Task creation** | ✅ `pipedrive:CreateActivity` in the lead flow | ✅ CRM Tasks workspace | Partially | **GOS** | Mirror refuses Pipedrive tasks (`task: NONE`) — 27 skipped as `legacy_retired` in 45d |
| **Deal stage changes** | ✅ 13 WON + 8 lost scenarios | ✅ GOS deal status | Make writes Pipedrive only | **GOS** | Mirror refuses updates (76 `legacy_retired` in 45d) |

### The safe shutdown order for duplicates

Ordered by *risk of a customer or guide noticing*, lowest first:

1. **Guide communications** (4452993, 3956203, 1126290, 1051602) — confirmed double-send, internal
   audience, GOS side verified sending. **Disable Make's first.**
2. **Manager reports** — GOS #1–#26 verified; Make's already dead. Formalise the retirement.
3. **Lead alerts** — GOS #25 verified (11 sends). Disable Make's office-notify branch in `pipe4u`
   **without touching the routing branch**.
4. **WON notifications** — GOS #26 live but only 1 send observed; **watch for a week first**.
5. **Coordination / tour summaries** — GOS reports live; verify recipient parity first.
6. **Calendar** — verify GOS calendar sync covers every tour type before disabling Make's.
7. **Payments / accounting** — **last.** Money path, and Make's side is currently broken, so parity
   cannot be observed right now.

---

## PART 8 — Unknown / unused automations

Purpose **not** inferred from names. Each of these needs a human.

**46 active scenarios with zero execution history in the retained window** — cannot be called safe.
Highlights: 430317 (Google Forms leads), 430335/430343 (Smoove subscribers), 430320 (bat-mitzvah LP),
430321 (footer form), 430346 (contact popup) — **note that three of these are on the protected
lead-intake list**. An active lead form with no recent runs means either "this form gets no traffic"
or "this form is broken and we have been losing leads silently". **Those are opposite conclusions and
the logs cannot distinguish them.** Full list in the CSV (`last_run` empty).

**Explicitly unclear, flagged NEEDS MANUAL REVIEW:**

| ID | Name | Why unclear |
|---|---|---|
| 1445570 | טופס משוב - ניסיונות לשיחות | **77% error rate** (10/13). Fillout + Airtable. Broken or abandoned? |
| 1449188, 3162997, 1711911 | callers of `pipe4u` | Feed the lead router but have no run history — **protected by default** |
| 3018034 | טופס השתתפות | No history, no folder context |
| 1914956 | תשובות טופס עדכון איש כספים | No history |
| 430314 / 430339 | טופס איחוד אירועים (calendar merge) | Pair of scenarios, one calls an unowned hook |
| 4698828 | דחייה ללא תאריך | Duplicate name with 1652407 |
| 601178 | התראה לאלינוי על פעולות במייק | A Make-monitoring scenario that itself never ran |
| 6 unresolved outbound hooks | `ghjtyty8vdyj`, `69hxwe4kn3f3`, `g3eiqlxptri1`, `qr8bkssf9znw`, `q56scym49n8t`, `8temuau6685t` | Point at hooks owned by **no scenario in this account** — a second Make account, or deleted scenarios |

**Also unresolved from the 2026-07-29 audit and still open:** the three Airtable bases
`appoGAPsgocFPL3nq`, `appTmfCn5ipIcQc1V`, `appAKinKJeQbirytW` were never assessed. Airtable is now
retired operationally, so this is lower risk than it was — but if anything in them was never migrated,
it is now unreachable through GOS.

---

## PART 9 — Do not disable yet

### P0 — business or lead loss

| Item | Why | What breaks | Build/verify first | Ready when |
|---|---|---|---|---|
| **3897811 Find/Create UTM** | Terminal lead router | All non-Meta lead intake | GOS `website_form` ingress credentialed + all 12 forms repointed | 14 consecutive days with 0 Make lead runs and GOS receiving equivalent volume |
| **1069253 pipe4u** | 12-caller front door | Same | Same | Same |
| **Pipedrive webhook 1756503** | The GOS bridge | Every Pipedrive-origin lead | Never — this is the **last** thing to remove, after Pipedrive stops receiving leads at all | Pipedrive receives zero new leads for 30 days |
| **430307 / 430331 / 430321 / 430346 / 430315 / 430320** | The 6 Elementor lead forms | Those forms' leads | `WEBSITE_FORM_SECRET` set; alias table gaps G3 fixed | Per-form parity |
| **430271 abandoned cart** | 1,282-order lead pool | Cart-recovery leads | GOS abandoned-cart poller (**gap G7 — does not exist**) | Poller shipped + verified |
| **Pipedrive tokens / connections 456551, 456555** | 206 scenario usages | Instant estate-wide halt | — | At final cutover only |

### P1 — customer communication / payment / accounting risk

| Item | Why | Build/verify first |
|---|---|---|
| **440477 רכישה מהאתר** (email + calendar + iCount receipt + Pipedrive) | The Woo money path, 4 systems in one scenario | `WOO_PRIMARY_WEBHOOK_SECRET`; adapter gaps **G1** (reads wrong attribution keys) and **G2** (drops `_billing_tour_*`) fixed; **G4** store-key inversion resolved |
| **1889926 / 4602660** business invoices | Accounting | GOS invoice parity verified against iCount |
| **835533 / 835854** payment links | Money | GOS payment links verified at volume (only 4 in 60d so far) |
| **The 22 auto-disabled scenarios** | **They are already off and nobody decided that** | Owner reviews the P0-3 table and decides restore-vs-retire **per row** |
| **Legacy Pipedrive file bodies (closed deals)** | Metadata-only crosswalk; binaries live only in Pipedrive | Decide: copy to R2, or accept the loss — **before** any downgrade |

### P2 — operational inconvenience

Guide comms (4452993, 3956203, 1126290, 1051602) · payroll (2693681, 2906484, 3190154, 2883326) ·
Drive/Photos folders (889252, 4131369, 1978153) · calendar (4095754, 2600471) · quotes (1443901,
1817282). All duplicated by GOS; disabling stops a double-send rather than losing a capability.
**These are the best first candidates** — see Part 10 Phase 1.

### P3 — legacy / no urgency

87 inactive scenarios · 26 ארכיון · Airtable housekeeping (4548217, 4357153, 430254, 1899057) ·
8 never-delivered Pipedrive webhooks · Smoove/Cognito/Fillout/Prospero/Bitly/short.io connections.

### Missing GOS capabilities (must be built before full shutdown)

| # | Capability | Owner today | Status |
|---|---|---|---|
| 1 | **Website-form ingress credential** | Make | Code shipped; `WEBSITE_FORM_SECRET` **unset**. Nearest-term unlock. |
| 2 | **Woo order ingress credential** | Make | Code shipped; `WOO_PRIMARY_WEBHOOK_SECRET` **unset**; gaps G1/G2/G4 open |
| 3 | **Abandoned-cart poller** (G7) | Make 430271 | **Does not exist** |
| 4 | **Coupons / gift vouchers** (BL7) | Make 430261, 430322 | **Does not exist** |
| 5 | **Marketing list (Smoove)** (BL14) | Make | **No replacement, no decision** |
| 6 | **Ingress → follow-up task + office notify** (G9) | Make | Not wired |
| 7 | **Communication Center customer content** | Make (Gmail/Wassenger) | 0 active rules, 2 sends/30d |
| 8 | **Pipedrive Workflow Automations inventory** | — | **Cannot be read via API** |
| 9 | **Make-side alerting** | none | The 2026-08-01 outage was invisible |

---

## PART 10 — Safe shutdown plan

### Phase 0 — Stabilise and freeze *(prerequisite for everything; nothing else may start first)*

- **Prereq:** none.
- **Actions:** ① Resolve the Pipedrive API budget exhaustion (P0-1) — read the API-usage screen, identify
  the consumer, raise the budget or reduce usage. ② Review the 22 auto-disabled scenarios and record a
  deliberate restore-or-retire decision per row. ③ Export Pipedrive Workflow Automations from the UI
  (Part 4.1). ④ Freeze: no new Make scenarios, no new Pipedrive automations. ⑤ Add Make failure
  alerting — even a single scenario that watches for `429`.
- **Verify:** 7 consecutive days with **zero** 429 errors and no further auto-deactivations.
- **Rollback:** n/a (no changes to running automations).
- **Success:** the estate's active/inactive state reflects decisions, not damage.

### Phase 1 — Disable confirmed duplicates, one at a time

- **Prereq:** Phase 0 complete.
- **Actions:** disable **one** scenario per day, in Part 7's order (guide comms first). Record the
  timestamp.
- **Verify:** for 48h after each, confirm the GOS equivalent still fires (`AdminReportDelivery` /
  `CommunicationDelivery` / `WhatsAppMessage`) and no recipient complains.
- **Rollback:** re-activate the scenario in Make (single toggle, instant, no data loss).
- **Success:** double-sends eliminated; no GOS-side gap.

### Phase 2 — Keep the lead-ingress bridge only

- **Prereq:** Phase 1 clean for 2 weeks.
- **Actions:** disable every remaining non-lead scenario. **Touch nothing on the Part 5.2 protected
  list.**
- **Verify:** daily lead count in GOS unchanged; `MirrorEvent` deal-created still arriving.
- **Rollback:** re-activate.
- **Success:** Make runs the lead path and nothing else.

### Phase 3 — Migrate the remaining capabilities

- **Prereq:** Phase 2 stable.
- **Actions:** set `WEBSITE_FORM_SECRET`; fix G1/G2/G3/G4; repoint the 12 Elementor forms as a
  **second** webhook action (keep Make's); set `WOO_PRIMARY_WEBHOOK_SECRET` and add a second Woo
  webhook; build the abandoned-cart poller; decide coupons and Smoove.
- **Verify:** dual-run — every lead appears in **both** Pipedrive and GOS-direct, reconciled daily.
- **Rollback:** remove the GOS webhook action; Make's path never stopped.
- **Success:** 14 consecutive days of 100% parity.

### Phase 4 — Observation

- **Prereq:** Phase 3 parity proven.
- **Actions:** remove the Make webhook action per form, **lowest traffic first**
  (calendar → bat-mitzvah → grafoodiez → contact → product → popup → **footer last**). Duration:
  **minimum 30 days**, spanning a full monthly cycle.
- **Verify:** daily lead-count comparison; weekly reconciliation report; zero customer complaints.
- **Rollback:** re-add the Make webhook action.
- **Success:** GOS carries 100% of lead volume for 30 days with Make idle.

### Phase 5 — Disconnect

- **Prereq:** Phase 4 clean; owner sign-off per item.
- **Actions:** ① Copy closed-deal file bodies out of Pipedrive (Part 6) — **irreversible if skipped**.
  ② Retire `Find/Create UTM` **last**. ③ Delete the 4 legacy Woo webhooks. ④ Delete the 39 Make-bound
  Pipedrive webhooks; keep 1756503 until Pipedrive receives no leads for 30 days. ⑤ **Rotate the
  Wassenger / WATI / Bitly tokens** exposed in 30 blueprint locations. ⑥ Downgrade Pipedrive; cancel Make.
- **Verify:** 30 days post-cutover with zero lead loss.
- **Rollback:** **none past step ①.** This phase is one-way.
- **Success:** GOS is the only system.

---

## PART 11 — Manual approval workflow

**`docs/architecture/GOS-shutdown-decisions-2026-08-03.csv`** — 233 rows, one per Make scenario, with
every evidence column plus:

- `recommendation` · `reason` · `gos_replacement` · `prerequisite_before_disable` · `risk`
- **`OWNER_DECISION`** — blank, for you: `Keep` / `Disable` / `Rebuild in GOS` / `Need explanation`
- **`OWNER_NOTES`** — blank

The Pipedrive side has **two** sheets, because the two halves have very different evidential status:
the 40 webhooks are fully evidenced and included; the Workflow Automations sheet is a **template**
that cannot be populated until you export them from the UI (Part 4.1).

**Nothing will be disabled before you return the completed decisions.**

---

## PART 12 — Evidence classification

| Claim | Status | Basis |
|---|---|---|
| 233 scenarios, 119 active, 27 invalid | **PROVEN** | Make API scenario list |
| Pipedrive budget exhausted since 2026-07-30 | **PROVEN** | 103 × 429 across 29 scenarios in execution logs |
| Lead router failed all day 2026-08-01 | **PROVEN** | 39/39 failed executions + zero GOS bridge deals that day |
| 22 scenarios auto-deactivated by the incident | **PROVEN** | `isinvalid` + 429 history + only 3 human edits since 07-25 |
| **Root cause of the budget exhaustion** | **UNKNOWN** | No API exposes per-token usage |
| Lead chain topology (12 → pipe4u → UTM → Pipedrive) | **PROVEN** | Blueprint HTTP module URL targets |
| Pipedrive→GOS bridge is live | **PROVEN** | Webhook 1756503 last delivery 2026-08-03T17:06 = 200; deal 26620 created in GOS 3s after the Make run |
| Meta Lead Ads fully migrated | **PROVEN** | 20 `IngressEvent` rows, Make 430352 inactive |
| Website-form ingress not live | **PROVEN** | `WEBSITE_FORM_SECRET` unset; 1 test event only |
| Guide comms double-sending | **PROVEN** | Both Make (2026-08-02/03 runs) and GOS reports #11–#16 (2026-08-03 sends) |
| Confirmation-email double-send | **INFERRED** | Both paths live; no shared correlation id to prove a specific customer got two |
| The 39 Make-bound Pipedrive webhooks are driven by Workflow Automations | **INFERRED** | Naming convention only — API cannot confirm |
| Purpose of the 46 zero-history active scenarios | **UNKNOWN** | No retained logs |
| Pipedrive Workflow Automations inventory | **UNKNOWN — structurally unobtainable** | 6 endpoint variants all 404 |
| Contents of 3 unaudited Airtable bases | **UNKNOWN** | Outside the GOS PAT |

---

## PART 13 — Safety posture upheld

- **GET / SELECT only.** ~520 Make requests, ~25 Pipedrive requests, 25 read-only SQL queries.
- No scenario paused, disabled, enabled, edited, renamed, deleted, rescheduled, cloned, run or replayed.
- No Pipedrive workflow, webhook, field, filter or pipeline touched. **No write to Pipedrive.**
- No token rotated. No secret printed — presence and length only.
- No test deal created in production. No customer or staff message triggered.
- No GOS runtime behaviour altered; no env var changed; no deploy.
- Raw blueprints kept in the session scratchpad, **not committed** (they contain live credentials).

---

## EXECUTIVE SUMMARY

### What can be turned off now
**Nothing, with confidence — and that is a finding, not caution.** Zero scenarios meet the bar of
"GOS is demonstrably carrying this traffic". The nearest candidates are the **guide-communication
scenarios** (4452993, 3956203, 1126290, 1051602): confirmed double-sending, internal audience, GOS
side verified. Those are Phase 1, one per day, after Phase 0.

### What must stay
The **12-scenario lead chain**, **Pipedrive webhook 1756503**, both **Pipedrive API tokens**, the six
**Elementor gateway hooks**, **`stage_id=1`**, and the four **lead custom fields**. Full list: Part 5.2.

### What must be rebuilt
Nine gaps (Part 9). Only two are code — the abandoned-cart poller and the ingress→task/notify rule.
**Four are credentials that already have shipped code waiting behind them** — `WEBSITE_FORM_SECRET`
and `WOO_PRIMARY_WEBHOOK_SECRET` are the highest-leverage items in this entire audit. Two are product
decisions (coupons, Smoove). One is an owner export (Pipedrive automations).

### What blocks full shutdown
1. **The Pipedrive API budget incident** — the estate is currently degraded; readiness cannot be
   measured through it.
2. **The 22 auto-disabled scenarios** — decide restore-vs-retire before treating "off" as "replaced".
3. **`WEBSITE_FORM_SECRET` / `WOO_PRIMARY_WEBHOOK_SECRET` unset** — the two biggest lead paths have
   working GOS code and no credential.
4. **Pipedrive Workflow Automations are unreadable via API** — a whole category is unaudited.
5. **Closed-deal file bodies exist only in Pipedrive** — silent, permanent data loss on downgrade.
6. **Make has no alerting** — a full-day lead outage passed unnoticed.

### The one thing to do first
Open **Pipedrive → Settings → API usage**. Everything else in this audit is measured through a system
that is currently failing, and until that is fixed, "it stopped working" and "we replaced it" look
identical from the outside.

---

*Prepared read-only. No item disabled. Awaiting per-item owner approval.*
