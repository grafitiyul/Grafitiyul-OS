# GOS — Make.com Read-Only Integration Audit

**Status:** COMPLETE. Executed against the live Make organization via the Railway-stored
`MAKE_API_TOKEN`. **GET requests only.** No scenario was modified, enabled, disabled, run, cloned
or reconnected. No token was rotated. No secret value is printed in this document.
**Date:** 2026-07-29
**Method:** Make API v2, zone `us1.make.com`. 233 scenarios + 233 blueprints + 45 connections +
166 hooks + 4 data stores + 23 folders read.
**Raw payloads:** session scratchpad only (`make-raw/`), **not committed** — blueprints contain
plaintext credentials (see §9.4).

---

## 0) Credential verification (the pre-check)

| # | Question | Answer |
|---|---|---|
| 1 | `MAKE_API_TOKEN` exists in Railway? | **YES** |
| 2 | Which service / environment? | Project **Grafitiyul-OS** → service **Grafitiyul-OS** → environment **production**. Also present: `MAKE_API_BASE_URL` = `https://us1.make.com/api/v2`. Not present on `gos-whatsapp-main`, `gos-whatsapp-office`, or `Postgres`. |
| 3 | Can the running service access it? | **YES** — both variables are in that service's variable set (55 vars total), so the deployed container receives them at boot. Verified by executing the probe through `railway run --service Grafitiyul-OS --environment production`, which injects the identical set. |
| 4 | Is the token valid? | **YES** — `GET /users/me` → `200`. Token is 36 chars, UUID-shaped (standard Make API token format). |
| 5 | Scopes? | Make API v2 exposes no token-introspection endpoint, so scopes were determined **empirically** by probing. Confirmed working: `user:read`, `organizations:read`, `teams:read`, `scenarios:read`, `connections:read`, `hooks:read`, `datastores:read`. **All required read scopes are present. Nothing is missing.** |
| 6 | Correct organization? | **YES** — user **Grafitiyul** (`info@grafitiyul.co.il`, id 323232); organization **Grafitiyul** id **305576**, zone `us1.make.com`; single team **"My Team"** id **120547**. |
| 7 | Read access confirmed | scenarios **233** ✓ · blueprints **233/233, zero failures** ✓ · connections **45** ✓ · hooks **166** ✓ · data stores **4** ✓ · folders **23** ✓ · teams/orgs ✓ |

Rate limiting: HTTP 429 encountered roughly every 50 blueprint reads; handled with exponential
backoff. 261 requests total.

**Conclusion: the existing Railway credential is fully sufficient. No new Make token is needed and
no manual blueprint export is required.**

---

## 1) Connection inventory — 45 connections

**The single most important finding for migration planning: every Make Connection stores its
secret internally. The Make API returns connection *metadata* only — name, type, scope count,
expiry, account identity — and never the token, key, or password itself. Not one of these 45
secrets is extractable through the API, and Make's UI does not display them either.**

| Platform (`accountName`) | # | Auth type | Secret extractable? | Owner | GOS can reuse directly? |
|---|---|---|---|---|---|
| `google-restricted` | 6 | OAuth | No — Make-internal | Grafitiyul Google accounts | No (GOS has its own OAuth app) |
| `airtable3` | 6 | OAuth | No | Grafitiyul (`usrWAx2ZpWjmhM5me`) | No (GOS uses its own PAT) |
| `google` | 5 | OAuth | No | Grafitiyul Google accounts | No |
| `app#icount-vyi3kf` (custom) | 3 | Basic | No — and `editable=false` | Grafitiyul | No (GOS has `ICOUNT_*`) |
| `facebook` | 2 | OAuth | No | **Personal account "Anat Hemell"** | **No — see §3** |
| `pipedrive-apikey` | 2 | Basic (API token) | No | Grafitiyul | No |
| `pipedrive-auth` | 2 | OAuth | No | Elinoy (`manager@grafitiyul.co.il`) | No |
| `app#bulldogwp-6wcm2v` (custom) | 2 | Basic | No — `editable=false` | Grafitiyul (Wassenger wrapper) | Not needed |
| `icount` | 2 | Basic | No | Grafitiyul | No |
| `oauth2` (generic HTTP) | 2 | OAuth | No | — | No |
| `app#googleserviceaccount-iqmsnt` | 2 | OAuth (service acct) | No | Grafitiyul | No |
| `airtable2` | 1 | Basic (API key) | No | Grafitiyul | No |
| `woocommerce2` | 1 | Basic (consumer key/secret) | No | Grafitiyul store | **No — must regenerate, see §4** |
| `app#wassenger-0waevn` | 1 | Basic | No — `editable=false` | Grafitiyul | Not needed |
| `bitly2` · `cognitoforms` · `fillout` · `flickr` · `make` · `prospero` · `short-cm` · `smoove2` | 1 each | mixed | No | Grafitiyul | Not needed |

Notable connection-level facts:

- **`pipedrive-apikey` 456551 is used by 110 scenarios and 456555 by 96** — these two API tokens
  carry nearly the whole estate.
- **`airtable3` connection 2070140 is used by 102 scenarios**; the other five Airtable OAuth
  connections are used by 0–2 each (stale duplicates).
- **`app#bulldogwp-6wcm2v` connection 456545 ("Wassanger") is used by 52 scenarios** — the busiest
  single connection after Pipedrive.
- **`google-restricted` 456539 (`info@grafitiyul.co.il`) is used by 75 scenarios.**
- Several blueprints reference connection IDs **456538** and **4631565** that no longer exist in
  the connection list — deleted connections still referenced by inactive scenarios.

---

## 2) Scenario inventory — 233 scenarios

**142 active · 91 inactive.** Organised into 23 folders:

| Folder | Total | Active |
|---|---|---|
| *(no folder)* | 74 | 31 |
| ארכיון (archive) | 26 | 0 |
| wassenger | 16 | 10 |
| לידים לפייפדרייב (leads → Pipedrive) | 15 | 15 |
| דיל עבר לוון (deal → won) | 13 | 12 |
| עסקיים (business customers) | 13 | 13 |
| לאנדוליני: אוטומציות חדשות | 12 | 12 |
| מדריכים (guides) | 11 | 10 |
| לוסטים ודחייה (lost/rejection) | 8 | 7 |
| להדליק אחרי המלחמה (re-enable after the war) | 6 | 4 |
| הכנסת תוכן וואצאפ לדיל | 5 | 5 |
| חשיפה · הצעת מחיר · סוכנים ומפיקים · סליקה | 5 each | 4–5 |
| עסקיים לפני המכירה | 4 | 2 |
| טריגרים לאוטומציה | 3 | 0 |
| היסטוריה · שעות עבודה · כללי · מנגנון בקרה · AI · One click | 1–2 each | 0–1 |

App usage across all 233 (count = scenarios touching that app):

```
pipedrive 167 · airtable 118 · google-email 77 · http 66 · app#testing-g3yhep 50
app#bulldogwp-6wcm2v 46 · app#wassenger-0waevn 20 · google-calendar 16 · google-sheets 15
google-drive 14 · app#icount-vyi3kf 13 · woocommerce 12 · bitly 10 · icount 9
cognitoforms 7 · short-cm 7 · facebook-lead-ads 4 · smoove 2 · prospero 2 · fillout 1
```

**Trigger distribution:** 125 `gateway-webhook` hooks (instant, URL-triggered) + scheduled
scenarios (daily at fixed times, `indefinitely` with 900s interval, weekly). 33 scenarios call
other Make webhooks over HTTP — scenarios chain into each other, so **retiring one scenario can
silently break another**.

**Health signals (read from scenario metadata, not execution logs):**
- 7 active scenarios carry incomplete executions (DLQ). Highest: `430274` (WhatsApp follow-up,
  allDlq=5), `1830861` (participant-count updates, dlq=3), `1889926` (post-close invoicing, dlq=3).
- 4 scenarios are flagged `isinvalid` — all already inactive.

### The canonical lead → Pipedrive data flow

Every website/campaign lead follows the same shape:

```
external source
  → Make gateway webhook (hook.us1.make.com/<32-char udid>)
  → util:SetVariables (normalise fields)
  → http:ActionSendData → POST to the "Find/Create UTM" scenario (id 3897811, hook 2209678)
  → app#testing-g3yhep:formatIsrNumber (Israeli phone normalisation)
  → pipedrive:SearchOrganizations  ─┐
  → builtin:BasicRouter             ├─ THE DEDUPE STEP
  → pipedrive:GetPerson / UpdatePerson / CreatePerson ─┘
  → pipedrive:CreateObject (deal, stage_id=1)
  → pipedrive:CreateNote
  → app#bulldogwp-6wcm2v:SendMessage (WhatsApp notify)
  → pipedrive:CreateActivity (follow-up task)
  → smoove:UpdateOrCreateContact (marketing list, some forms only)
  → google-email:ActionSendEmail (office notification)
```

`Find/Create UTM` (3897811) is the shared router — the closest thing the estate has to a canonical
ingress. **This is precisely the role GOS's Ingress Platform now occupies.**

---

## 3) Meta / Facebook Lead Ads

**4 scenarios use `facebook-lead-ads`. Exactly one is active.**

| Item | Value | Classification |
|---|---|---|
| **Page ID** | `557050430995914` | **VISIBLE** |
| **Page name** | not returned by the API | **UNKNOWN** |
| **Form ID** | `3851739504971671` | **VISIBLE** (appears in all 3 inactive scenarios) |
| **Form name** | not stored in blueprints | **UNKNOWN** |
| **Connection (active)** | id 4677839 "ANAT 23/02/2026 Facebook connection", OAuth, 9 scopes, uid `10155222057116129`, identity **"Anat Hemell"** | **VISIBLE (metadata)** |
| **Trigger type** | `facebook-lead-ads:NewLeadMultiple` v2 — instant, via Make-managed hook `2624111` | **VISIBLE** |
| **App ID** | — | **MANAGED BY MAKE** |
| **App Secret** | — | **MANAGED BY MAKE** |
| **Verify Token** | — | **MANAGED BY MAKE** |
| **Page Access Token** | — | **MANAGED BY MAKE** |
| **Webhook URL** | Make-internal (`__IMTHOOK__: 2624111`), no public URL exposed | **MANAGED BY MAKE** |

**Active scenario `430352` — "לידים מטופס פייסבוק קמפיין גרפיטי רימרקטינג > פייפדרייב":**

```
facebook-lead-ads:NewLeadMultiple (instant hook 2624111)
  → facebook-lead-ads:GetLeadDetails  (pageId 557050430995914, formId/leadgenId from trigger)
  → app#testing-g3yhep:formatIsrNumber
  → util:SetVariables
  → http:ActionSendData     → into the Find/Create UTM router → Pipedrive
  → google-email:ActionSendEmail
```

Note the mapping into Pipedrive is **indirect** — this scenario does not write to Pipedrive itself;
it posts into the shared UTM router, which performs the person/deal creation described in §2.

**Custom fields / lead source / campaign / UTM:** the inactive scenario `4509524` requests the full
Meta field set (`ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name, platform,
is_organic, field_data, …`), but **the active scenario requests `fields: []`** — it takes only the
default trigger payload and resolves details via `GetLeadDetails`. Campaign/UTM attribution is
therefore handled downstream in the UTM router, not at the Meta boundary.

**⚠ Two things the owner must know:**

1. **The Meta connection belongs to a personal Facebook account ("Anat Hemell"), not to a
   Grafitiyul-owned Meta app.** Whoever that account belongs to personally controls the Page
   access. This is a business-continuity risk independent of the migration.
2. **Both Facebook connections show `expire` dates in the past** (4677839 → 2026-04-24;
   4637440 → 2026-03-23), yet scenario 430352 shows **0 failed executions** and was edited
   2026-07-26. Make refreshes OAuth tokens internally, so a past `expire` does not prove the
   connection is broken — but I cannot confirm from the API that leads are currently flowing.
   **Verify in the Make UI before relying on it.** I did not open or test the connection.

**There is nothing to copy from Meta.** Make uses *its own* Meta application, so no App ID, App
Secret, Verify Token or Page Access Token exists anywhere in this estate. GOS needs its own Meta
app regardless of what the audit found. The genuinely reusable items are the **Page ID** and
**Form ID** above, which is exactly what `META_PAGE_ID` and `META_ALLOWED_FORM_IDS` expect.

---

## 4) WooCommerce

| Item | Finding |
|---|---|
| **Store URL** | `https://grafitiyul.co.il` (single store; no second store in Make) |
| **Connection** | id 456550 "My WooCommerce connection", `woocommerce2`, **Basic** (consumer key + secret) |
| **API keys** | **NOT VISIBLE** — held inside the Make connection |
| **Webhook secret** | **NONE EXISTS.** Woo posts to Make gateway webhooks, which perform no signature validation. The 32-character URL *is* the only secret. |
| **Scenarios** | 12 (5 active) |

**Webhook endpoint (visible):** hook `361454` "רכישה באתר" →
`https://hook.us1.make.com/bnpdlb34o6ryov1v1utl817q693jw98y` → scenario **440477**
"רכישה מהאתר > מייל אישור > עדכון ליומן > הוצאת קבלה > עדכון לפייפדרייב".

**Order flow:**
```
WooCommerce order placed
  → POST to Make webhook (URL above)
  → woocommerce:GetOrder
  → confirmation email (Gmail)
  → Google Calendar event
  → iCount receipt (app#icount-vyi3kf:createDocument)
  → Pipedrive deal update
```

**Other Woo integrations:**
- **Cart abandonment** (`430271`, active): nightly 00:30 `woocommerce:SearchOrders status=pending`
  → Pipedrive. Runs on a 900s indefinite schedule restricted to a one-minute window.
- **Coupon generation** (`430261` active, plus 4 inactive): `woocommerce:CreateCoupon`, 10% off,
  30-day expiry, restricted to product IDs **7993, 3114, 2448, 6041, 6021**.
- **Gift vouchers** (`430322`, active): order → coupon → email + Pipedrive.
- **Product creation** (`430347`, active): new Woo product → Pipedrive + Airtable.
- **Re-send orders** (`3648282`, active).

**Consumer key/secret cannot be recovered.** WooCommerce shows the consumer secret exactly once at
creation. A new key pair must be generated in WP Admin → WooCommerce → Settings → Advanced → REST
API — *unless* GOS's existing `WOOCOMMERCE_*` credentials (already working for the Woo sync module)
are reused, which is what `server/.env.example` explicitly instructs.

---

## 5) Website forms

All website forms are **Elementor forms POSTing to Make gateway webhooks**. **Authentication: none
whatsoever** — no signature, no shared secret, no token. Anyone who learns a URL can inject leads.

| Form | Webhook URL | Scenario | Active |
|---|---|---|---|
| Contact page (`טופס עמוד צור קשר`) | `hook.us1.make.com/6ky8ly1bjwhut47v2tgxglbxfrdu549r` | 430331 → Pipedrive + Smoove | ✓ |
| Footer (`טופס פוטר`) | `…/bckioo3ys2n3rqmgyzvjdz9matnql5s2` | 430321 → Pipedrive + Smoove | ✓ |
| Product pages (`טופס בעמודי מוצר`) | `…/zm8pt41206bf79xvovaip2gktqhiqyf3` | 430315 → Pipedrive | ✓ |
| Contact popup (`פופאפ צור קשר`) | `…/sudj8rnaszii2rhlkhnzljxcysm99kcm` | 430346 → Pipedrive | ✓ |
| Elementor landing page (`דף נחיתה אלמנטור`) | `…/2katu8xl75ru2m19ig68wrp8nl2lucf5` | 430307 → Pipedrive | ✓ |
| Bat-mitzvah landing page | `…/d715242bd6xza9e5zyrxkee7hzgsg1gt` | 430320 → Pipedrive + Smoove | ✓ |
| Travel-agent order form | `…/8t8g5xlhmct7mfos0q5jdbb6jqiminng` | 430xxx → deal + document + office notice | ✓ |
| Business-customer order form | `…/pl4uo8hgj14etbekc772x5mbvbku7ljy` | → deal update + document | ✓ |
| Pre-activity questionnaire | `…/u2uv8vxgop6h6x3ee222je4qo6ddwgis` | → Sheets + Pipedrive | ✓ |
| Google Forms (leads) | `…/j7roubmgao3p7t6upwwk9cfnn6lp0oia` | 430317 → Pipedrive | ✓ |
| Google Forms (sales-call script) | `…/urq6uc93iuvpukoquw3g82hxgmp5gtxn` | 430334 → Pipedrive | ✓ |
| Google Forms (feedback call) | `…/1f8wqqqrxx8l9p1qxse46mbc7ua6iksv` | 430330 → Airtable + Pipedrive | ✓ |

125 gateway webhooks exist in total; the above are the lead-bearing ones. Additional form sources:
**Cognito Forms** (6 scenarios), **Fillout** (1), **Smoove** subscriber webhooks (2).

Lead creation flow is identical to §2 — normalise → UTM router → dedupe → Pipedrive person + deal
at `stage_id: 1` → note → WhatsApp notify → activity.

**Migration note:** GOS's equivalent endpoint is
`POST /api/ingress/website-form/<WEBSITE_FORM_SECRET>/<formKey>` — which *does* authenticate. Each
row above maps to one `formKey`, and the mapping is 1:1 with the `formKey` examples already in
`server/.env.example` (`contact_page`, `footer`, `popup`, `product_page`, `elementor_lp`).

---

## 6) Pipedrive

**167 of 233 scenarios touch Pipedrive** — it is the spine of the estate.

**Connections:** two API-token connections (456551 → 110 scenarios; 456555 → 96 scenarios) plus
OAuth "V2 Pipedrive" (4660733 → 5 scenarios, identity *Elinoy manager@grafitiyul.co.il*). Tokens
not extractable. Direct HTTP calls also go to `grafitiyul.pipedrive.com` and `api.pipedrive.com`.

**Deal creation** (sample: website contact form 430331):
```json
{ "title": "{{full name}}", "status": "open", "stage_id": 1, "person_id": "{{…}}",
  "35a2565c8f374bbb994cd97accedaff2db273aba": "טופס צור קשר באתר",   // lead source (text)
  "7009bcae297bf081809040430cd3cc3dc4588ed5": "{{now}}",              // timestamp
  "b5fbb89a2499268c9bdc95b4bb34dda000a8f172": 114,                    // source enum (114 / 118 per branch)
  "d5f68c10cf1908ec676f963b1a3d9965b63cac08": "{{group type}} … תאריך מבוקש: {{…}}" }
```
Custom-field hashes and enum option IDs are **VISIBLE** across blueprints and are directly reusable
as a mapping key when interpreting the migrated Pipedrive data.

**Dedupe logic** — consistent across the estate, and notably weak:
`pipedrive:SearchOrganizations` → `BasicRouter` → `GetPerson` (match) → `UpdatePerson`, else
`CreatePerson`. Matching is by **organization name and phone** (after `formatIsrNumber`
normalisation), not by a stable identifier. Usage counts: `ListDeals` 83, `ListProductsInDeal` 81,
`GetDeal` 70, `GetPerson` 60, `GetOrganization` 49, `SearchOrganizations` 30.

**Also written by Make:** notes (`CreateNote`), activities (`CreateActivity`, with 24 activity
types), organizations, products, and stage transitions (won/lost pipelines — see the 13-scenario
"דיל עבר לוון" folder and the 8-scenario "לוסטים ודחייה" folder).

Pipeline/stage structure was already documented in `GOS-migration-external-readiness-audit.md` §3a
(5 pipelines, 25 stages) — unchanged by this audit.

---

## 7) Airtable

**118 scenarios touch Airtable.** 7 connections (6 OAuth `airtable3` + 1 API-key `airtable2`,
the latter used by 24 scenarios).

**⚠ NEW FINDING — five bases are referenced, not two.** The earlier readiness audit reported the
GOS PAT could see 2 bases. Make blueprints reference **5**:

| Base ID | Status | Tables referenced |
|---|---|---|
| `apprCVcUYhZeIYRJB` | **known** — main "גרפיטיול" | 16 |
| `appCouDLeNLtFcpFp` | **known** — legacy "מוצרים ושירותים" | 20 (incl. מוצרים, מדריכות, ניסוחים למייל/לוואטסאפ, סוגי לקוחות עסקיים) |
| `appoGAPsgocFPL3nq` | **NOT in the prior audit** | 2 (`tblNDuN5AN7H9wiHX`, `tblWv2KpzXrOt0Fhu`) |
| `appTmfCn5ipIcQc1V` | **NOT in the prior audit** | 2 (`פרטי לקוחות לשיחות משוב`, `tbl0NBDtoGEY0oXSX`) |
| `appAKinKJeQbirytW` | **NOT in the prior audit** | 1 (`tblBpUnJjkqMOAaBc`) |

These three bases are outside the GOS PAT's visibility and outside every migration snapshot taken
so far. **They must be assessed before cutover** — they may be trivial (a feedback-call helper
base) or may hold data assumed to be captured. This is the single most actionable discovery in
this audit.

**Automations:** Airtable **buttons** are a major trigger class — button → Make webhook → action.
Examples: `430344` (add WhatsApp message), `445168` (add email message), `254426` (create new
guide), `2906484` (guide approves payroll record), `3190154` (management approves guide notes).
Airtable is also written *from* Pipedrive (`1830861`, `3121861`) and drives daily jobs (Drive
folder creation `4131369`, tour-summary chasing `3956203`).

**Mapping into GOS:** none. Every Make↔Airtable path is legacy; GOS already owns payroll, tours,
guides, products, and message templates.

---

## 8) Google

11 Google connections across three app types, spanning 5 mailboxes: `info@`, `booking@`, `sales@`,
`manager@` (labelled "גרפיטיול"), `reservation@`.

| Service | Scenarios (active) | Usage |
|---|---|---|
| **Gmail** (`google-email:ActionSendEmail`) | 87 (54) | **The dominant integration.** Customer confirmations, quotes, payment reminders, office digests, guide notifications. |
| **Calendar** | 16 | `createAnEvent` 8, `updateAnEvent` 10, `deleteAnEvent` 6, `getAnEvent` 9, `searchEvents` 6, plus `createACalendar` + `createAnAccessControlRule` (per-guide calendars) |
| **Sheets** | 15 | Daily reporting: `addRow` 11, `filterRows` 11, `updateRow` 6, `createSpreadsheet` 2 |
| **Drive** | 14 | Per-tour folders: `createAFolder` 5, `shareAFileFolder` 5, `deleteAFile` 5, `uploadAFile` 2 |
| **Docs / Slides** | 3 | `createADocumentFromTemplate` 2, `createPresentation` 1 |
| **Photos** | 2 | Via a **service-account** connection + direct `photoslibrary.googleapis.com` calls — tour album creation and sharing |

All OAuth, all Make-internal, none extractable. GOS already holds its own
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and implements Gmail + Calendar natively.

---

## 9) WhatsApp

**The estate runs three different WhatsApp providers simultaneously.**

### 9.1 Wassenger via custom app `app#bulldogwp-6wcm2v` — the primary path
Connection 456545 ("Wassanger"), Basic auth, `editable=false`, **used by 52 scenarios**. Modules:
`SendMessage` (53 scenarios), `getmessages`, `deletemessages`, `assignchat`, `apicall`.

### 9.2 Wassenger via the official app `app#wassenger-0waevn`
Connection 1293341, Basic, 19 scenarios. Modules: `sendGroupMessage` (18), `watchEvents`,
`sendMediaFile`, `searchContacts`, `createContact`, `updateContact`.

### 9.3 Wassenger via direct HTTP
```
POST https://api.wassenger.com/v1/messages          → 19 scenarios
GET  https://api.wassenger.com/v1/messages/{id}     → 1
GET  https://api.wassenger.com/v1/devices/{id}/health → 1 (daily connection check, 08:00)
```

### 9.4 WATI — a second provider
```
POST https://live-server-11433.wati.io/api/v1/sendTemplateMessage?whatsappNumber={VAR}
```
8 scenarios (3 active). **Template-based sending** — this is the only WhatsApp path in the estate
that uses approved templates; Wassenger sends free-form text.

### ⚠ 9.5 Plaintext credentials inside blueprints — 30 locations

Unlike Connections, **HTTP-module headers store secrets in plaintext inside the scenario
blueprint**, and they are readable through the API. I located them but **deliberately did not print
any value**:

| Secret | Shape | Where |
|---|---|---|
| **Wassenger API token** | 80-char `Token` header | 20 scenarios (incl. active `2607384`, `439285`, `430274`, `430262`, `440482`, `1126045`) |
| **WATI bearer token** | 532-char JWT `Authorization` header | 9 scenarios (incl. active `430291`, `430292`, `439285`) |
| **Bitly token** | 40-char `Authorization` header | scenario `2066050` |

**These are the only three credentials in the entire estate that are genuinely extractable.** They
are also the three that GOS least needs — see §10.D.

**Outgoing flow:** Pipedrive/Airtable trigger → template assembly (`הרכבת מסר` scenario 2125961,
which composes content from Airtable ניסוחים tables + short.io link shortening) → Wassenger send.
**Incoming flow:** minimal — `app#wassenger-0waevn:watchEvents` in a single scenario. There is no
real inbound mirror, which is exactly the gap GOS's Baileys bridge closes.
**Media:** `sendMediaFile`, one scenario.

---

## 10) Reusable credentials — the four-section answer

### A. Visible and copyable into Railway today

| Item | Value / location | GOS destination |
|---|---|---|
| Meta **Page ID** | `557050430995914` | `META_PAGE_ID` |
| Meta **Form ID** | `3851739504971671` | `META_ALLOWED_FORM_IDS` |
| Wassenger API token | plaintext, 20 blueprints | *(none — GOS uses Baileys)* |
| WATI bearer JWT | plaintext, 9 blueprints | *(none)* |
| Bitly token | plaintext, scenario 2066050 | *(none)* |
| Woo product IDs (coupons) | `7993, 3114, 2448, 6041, 6021` | reference only |
| Pipedrive custom-field hashes + stage/enum IDs | §6 | migration mapping |
| Airtable base + table IDs | §7 (**incl. 3 unknown bases**) | migration scope |
| All 125 Make webhook URLs | §5 | decommission checklist |

**Only two rows here are credentials GOS actually wants, and neither is secret.**

### B. Exists but hidden inside Make — not extractable

Every one of the 45 Connections: **Pipedrive API tokens ×2 + OAuth**, **Airtable OAuth ×6 + API key**,
**WooCommerce consumer key/secret**, **all 11 Google OAuth grants**, **Facebook OAuth**, **iCount ×5**,
Wassenger connection secrets, Smoove, Cognito Forms, Fillout, Short.io, Prospero, Flickr, Bitly OAuth,
Google service account.

Make returns metadata only. **Do not plan any migration step that depends on recovering these.**

### C. Must be generated again at the provider

| Credential | Where to create | Who owns it | Railway var |
|---|---|---|---|
| Meta **App Secret** | developers.facebook.com → new/existing Grafitiyul app → Settings → Basic | Grafitiyul (Meta Business Manager admin) | `META_APP_SECRET` |
| Meta **Verify Token** | invented by you; pasted into Meta webhook config | Grafitiyul | `META_VERIFY_TOKEN` |
| Meta **Page Access Token** | Graph API Explorer / app → Page token for Page `557050430995914` | **Page admin — currently the "Anat Hemell" account** | `META_PAGE_ACCESS_TOKEN` |
| Woo **webhook secret** | WP Admin → WooCommerce → Settings → Advanced → Webhooks | Grafitiyul (WP admin) | `WOO_PRIMARY_WEBHOOK_SECRET` |
| Woo consumer key/secret *(only if not reusing existing)* | WP Admin → WooCommerce → Advanced → REST API | Grafitiyul (WP admin) | already set as `WOOCOMMERCE_*` |
| **Website form secret** | generate a random string yourself | Grafitiyul | `WEBSITE_FORM_SECRET` |

### D. No longer needed — GOS replaces the integration

Wassenger (all three paths) · WATI · `app#bulldogwp-6wcm2v` custom app · Bitly · Short.io ·
Prospero · Flickr · Fillout · Cognito Forms · the Make connection itself · Airtable connections
(GOS owns tours/payroll/guides/products/templates) · Pipedrive connections (GOS owns CRM) ·
Google Sheets/Drive/Docs/Slides/Photos automation (GOS owns Documents, Tour Gallery, Files) ·
iCount Make connections (GOS has `ICOUNT_*` natively) · Smoove *(unless marketing email is still
wanted — no GOS replacement exists yet)*.

---

## 11) Migration recommendation per platform

| Platform | Reuse Make setup? | Migrate without new credentials? | Credentials required | Owner | Create at | Railway destination |
|---|---|---|---|---|---|---|
| **Meta** | **No.** Make uses its *own* Meta app; nothing is transferable. | **No.** | App Secret, Verify Token, Page Access Token | Meta Business Manager admin — **currently a personal account, resolve ownership first** | developers.facebook.com | `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_PAGE_ACCESS_TOKEN`, `META_PAGE_ID`, `META_ALLOWED_FORM_IDS` |
| **WooCommerce** | Config yes (product IDs, order flow); credentials no. | **Yes, mostly** — GOS's existing `WOOCOMMERCE_*` already authenticates to the same store. | Webhook secret only | Grafitiyul WP admin | WP Admin → WooCommerce → Webhooks | `WOO_PRIMARY_WEBHOOK_SECRET` |
| **Website** | Mapping yes; auth no (there is none today). | **Yes** — you generate the secret. | `WEBSITE_FORM_SECRET` | Grafitiyul | self-generated | `WEBSITE_FORM_SECRET`; repoint 12 Elementor forms |
| **Pipedrive** | Field/stage mapping is **highly reusable**; tokens are not. | **Yes** — GOS already has read access and the migration snapshot. | none new | Grafitiyul | — | already configured |
| **Airtable** | Structure yes; **3 unknown bases must be assessed first**. | **Yes** — GOS PAT exists, but may need widening to see the 3 new bases. | possibly a widened PAT scope | Grafitiyul Airtable admin | airtable.com/create/tokens | existing Airtable var |
| **Google** | **No** — Make's OAuth grants are Make-internal. | **Yes** — GOS has its own OAuth app and working Gmail + Calendar. | none new (one Gmail reconnect for `calendar.events` scope already tracked separately) | Grafitiyul Google Workspace admin | — | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `EMAIL_TOKEN_KEY` |
| **WhatsApp** | **No — and no reuse is wanted.** GOS's Baileys bridge replaces Wassenger + WATI entirely. | **Yes** | none from Make | Grafitiyul | — | `WHATSAPP_BRIDGE_URLS`, `WHATSAPP_BRIDGE_SECRET` |

---

## 12) Risks surfaced by this audit

1. **Three unaudited Airtable bases** (`appoGAPsgocFPL3nq`, `appTmfCn5ipIcQc1V`, `appAKinKJeQbirytW`)
   are referenced by Make but were never in any migration snapshot. **Assess before cutover.**
2. **The Meta Page connection rides a personal Facebook account.** Business-continuity risk
   regardless of migration; resolve Page ownership in Meta Business Manager.
3. **Website forms have zero authentication.** Any Make webhook URL in §5 accepts anonymous lead
   injection today. GOS's authenticated endpoint is a security improvement, not just a migration.
4. **33 scenarios chain into other scenarios over HTTP.** Retiring scenarios one at a time will
   break callers unless the dependency order is respected. The `Find/Create UTM` router (3897811)
   is the highest-fan-in node — retire it **last**.
5. **Live plaintext credentials sit in 30 blueprint locations.** Anyone with Make access can read
   the Wassenger and WATI tokens. Rotate them when those services are decommissioned.
6. **7 active scenarios carry failed executions** — some automations are already partially broken.
7. **Two Pipedrive API tokens carry 206 scenario usages between them.** Revoking either during
   cutover halts most of the estate instantly — which is desirable *at* cutover, and catastrophic
   before it.

---

## Appendix — safety posture upheld

- **GET requests only.** 261 requests, all read.
- No scenario modified, enabled, disabled, run, cloned, or reconnected.
- No token rotated or replaced.
- No secret value printed, logged, or written to this document — only location, key name, and length.
- Raw blueprints retained in the session scratchpad only; **not committed** (they contain the §9.5
  plaintext credentials).
- No Railway variable read aloud; presence and length only.
