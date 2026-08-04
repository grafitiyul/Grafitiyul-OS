# Make + Pipedrive + Airtable — Retirement Decision Package

**Date:** 2026-08-04
**Status:** DECISION PACKAGE. Nothing implemented, nothing disabled, nothing edited.
**Posture:** READ-ONLY. GET requests only against Make and Pipedrive; SELECT-only against the
production GOS database. No scenario paused/edited/replayed, no Pipedrive automation or webhook
touched, no token rotated, no customer contacted, no GOS runtime change.

**This is a one-pass audit.** Every question I could resolve, I resolved. The three items that
genuinely require you — and only those — are isolated in **§0.3**.

---

## §0 — Executive summary

### 0.1 The four answers

| Question | Answer |
|---|---|
| **Can we retire Make?** | Not yet — but the blocking path is **much smaller than expected**. See §4.1. |
| **Can we retire Pipedrive from lead intake?** | **YES — and it is roughly a one-hour change.** This is the headline finding. |
| **Can we retire Airtable?** | **YES, effectively now.** It holds no operational authority since 2026-07-31; 4 live scenarios only do housekeeping *on Airtable itself*. |
| **How many leads did we lose?** | **Exactly one.** Named, with full contact details, and **recoverable**. |

### 0.2 The 233 Make scenarios

| Recommendation | Count | Meaning |
|---|---|---|
| **Can shut down now** | **92** | Already inactive. Zero business risk. |
| **Replace inside GOS** | **50** | Live, GOS covers it **completely**. Disable after a 48h parity watch. |
| **Keep temporarily** | **28** | Live, GOS covers it **partly** — includes the 12 lead-intake scenarios. |
| **Requires my decision** | **63** | 22 auto-disabled by the outage + 40 active-but-idle + 1 unknown purpose. |

### 0.3 The ONLY things that need you personally

Everything else in this document is resolved. These three cannot be resolved from outside:

| # | What | Why only you | Effort |
|---|---|---|---|
| **A** | **Export Pipedrive Workflow Automations** from the UI | No API exposes them, in any version, with any auth (§2.1 proves this) | ~15 min |
| **B** | **Decide restore-vs-retire for the 22 auto-disabled scenarios** | They were switched off by an outage, not by a decision. Includes business receipts and payment reminders. | ~20 min with the table in §1.4 |
| **C** | **Read Pipedrive → Settings → API usage** | Names the consumer that exhausted the budget | ~5 min |

### 0.4 What changed since yesterday's audit

Two findings materially improve the picture:

1. **The lead loss was 1 person, not "unknown".** Make retains the raw webhook payloads, and I
   recovered them. The 39 "failed executions" on 2026-08-01 were **2 distinct people retried ~25
   times each**, and one of those two eventually succeeded.
2. **Make can post straight to GOS today.** The payload Make already sends is *already compatible*
   with the GOS ingress endpoint on 5 of 7 fields. Removing Pipedrive from intake needs one
   credential, a two-word code fix, and one URL change inside a single Make scenario.

---

## PART 1 — Complete Make audit (business level)

### 1.1 Where the full inventory lives

All 233 scenarios, each with a plain-language business flow, are in:

**→ `docs/architecture/GOS-make-business-inventory-2026-08-04.md`**

Each entry reads like this (real example, scenario 440477):

> **Status:** 🟢 live · last ran 2026-07-30
> **Trigger:** Webhook — רכישה באתר (a purchase on the website)
> **Systems:** WooCommerce · Pipedrive · iCount · Gmail · Google Calendar · Airtable
> **Business flow:** website order arrives → reads the order → finds or creates the customer and
> company in Pipedrive → creates the deal and its products → issues the iCount receipt → sends the
> confirmation email → creates the calendar event
> **GOS replaces it?** Partly — Confirmation Email + Calendar sync + iCount + Woo ingress
> **Still missing:** `WOO_PRIMARY_WEBHOOK_SECRET` unset; adapter gaps G1/G2/G4
> **Recommendation:** Keep temporarily

And the decision sheet with your two blank columns:

**→ `docs/architecture/GOS-make-decisions-2026-08-04.csv`** (233 rows, `MY_DECISION`, `MY_NOTES`)

### 1.2 The business picture in one table

| Business domain | What Make still does | Does GOS do it? | Verdict |
|---|---|---|---|
| **Lead intake** | Website form → normalise phone → find-or-create person + deal in Pipedrive → note → office WhatsApp → follow-up task | Meta only. Website forms: code ready, **not switched on** | **Keep — until §4** |
| **Guide communications** | Daily 06:00 WhatsApp: tomorrow's tours, missing summaries, coordination chasing | **Yes, completely** — Reports #11–#16, #7, #8, verified sending 2026-08-03 | **Replace — both are firing today** |
| **Payroll** | Guide approves record in Airtable → salary calculator → management approval → email | **Yes, completely** — Payroll module, all 6 slices | **Replace** |
| **Manager reports** | Nightly digests to office Gmail + WhatsApp group | **Yes** — Reports #1–#26 | **Replace** (Make's already dead) |
| **WON handling** | Deal WON → WhatsApp to customer → email → Drive folder → calendar event → invoice | Partly — Confirmation Email + Calendar + Files exist; iCount parity unverified | **Keep temporarily** |
| **Payments / collection** | Payment link page → capture → mark paid → move to collection pipeline | **Yes** — Cardcom + iCount + Collection module | **Replace** (verify volume first) |
| **Accounting** | Business receipts + invoices via iCount, daily | Native iCount module | **Your decision** — Make's is auto-disabled |
| **Quotes** | Build proposal in Prospero → email + WhatsApp → handle signature | Partly — Quote module exists | **Keep temporarily** — no Prospero signature equivalent |
| **Website shop** | Order → confirmation → calendar → receipt → Pipedrive deal | Partly — GOS publishes tours to Woo; does not ingest orders | **Keep temporarily** |
| **WhatsApp content** | Assemble message from Airtable templates → shorten link → send via Wassenger | **Yes** — Baileys bridge, 33,091 outgoing msgs/30d vs Make's handful | **Replace** |
| **Airtable housekeeping** | Delete stale rows, sync paid flags | Nothing needed — Airtable is retired | **Can shut down** |
| **Agent / business order forms** | Cognito form → deal + document + office notice | Partly — Agent Reservations module | **Keep temporarily** |

### 1.3 The one thing about Make's shape that decides everything

All 12 lead sources funnel through **one** scenario before touching Pipedrive:

```
12 lead sources → pipe4u (1069253) → Find/Create UTM (3897811) → Pipedrive
```

**This is the whole reason §4 is easy.** Changing where `pipe4u` sends its data redirects every
website lead at once — one edit, not twelve.

### 1.4 🔴 The 22 auto-disabled scenarios — YOUR DECISION (item B)

These switched themselves off during the Pipedrive outage. Make deactivates a scenario after
repeated failures. **No human chose this.**

| ID | Business purpose (plain language) | Does GOS cover it? | Suggested |
|---|---|---|---|
| 430267 / 430273 | Issue business receipts, twice daily | Native iCount module | **Retire** if GOS receipts are confirmed working |
| 430295 | Payment reminder on the activity day, to customer + guide | Communication Center | **Rebuild in GOS** — no active CC rule |
| 430291 | Pre-activity + payment reminders (Sat evening) | Communication Center | **Rebuild in GOS** |
| 430262 / 430274 | Private-customer follow-up #1 (10:00 and 16:00) | Communication Center | **Rebuild in GOS** |
| 430266 | Private-customer follow-up #2 | Communication Center | **Rebuild in GOS** |
| 430292 | One-month-after-activity email + WhatsApp | Communication Center | **Rebuild in GOS** |
| 430261 | Day after activity → move to collection pipeline + summary email | Collection module | **Retire** — GOS Collection owns this |
| 430265 / 430300 | Evening office digest: tomorrow's payment reminders / follow-ups | Reports #1–#26 | **Retire** |
| 430238 | Nightly closures report → Sheet + WhatsApp group | Manager Reports | **Retire** |
| 1070979 / 1353334 | Auto-mark deals lost after 30 / 60 days | — | **Rebuild in GOS** — no equivalent |
| 1989068 | Business-customer tour summary | Questionnaire Engine | **Retire** |
| 430297 | Daily contact merge/dedupe | Canonical contact search | **Retire** |
| 799554 | Give any open deal without a task a task, at midnight | CRM Tasks | **Rebuild in GOS** — safety net, no equivalent |
| 1052263 | "מנגנון בקרה" — Make's own control mechanism | בקרה module | **Retire** |
| 1989054 | New person in Pipedrive → add Wassenger chat link | WhatsApp module | **Retire** |
| 4549206 / 1830833 / 430258 | Scheduled content 4 days ahead / product notes / daily link creation | Mixed | **Your decision** |

**Six of these have no GOS equivalent** (marked *Rebuild*) and have been silently off for 4 days.
Customer-facing follow-ups and payment reminders are among them.

---

## PART 2 — Pipedrive Workflow Automations

### 2.1 Why they cannot be exported through the API — proven, not assumed

I probed every plausible endpoint, on both hosts, with both auth methods:

| Endpoint | `api_token` | `Bearer` |
|---|---|---|
| `/v1/automations` | **404** | 401 |
| `/v2/automations` | **404** | 401 |
| `/v1/workflows` | **404** | — |
| `/v1/workflowAutomations` | **404** | — |
| `/v1/automations/list` | **404** | — |
| `/v1/legacyAutomations` | **404** | — |
| `/v1/flows`, `/v1/triggers`, `/v1/settings/automations` | **404** | — |

Also tried on `api.pipedrive.com` as well as `grafitiyul.pipedrive.com`. Control endpoints
(`/v1/companyFeatures`, `/v1/webhooks`, `/v1/filters`) all return **200** with the same token — so
this is not a permission problem. **Pipedrive simply publishes no read API for Workflow
Automations.** The feature is UI-only.

I also tried to reconstruct them from imported data: `LegacyRecord.payload` is `NULL` for all
24,661 deals, 127,036 activities and 74,516 notes — the migration converted them into native GOS
entities and dropped the raw payload. That route is closed too.

### 2.2 The smallest manual export procedure (item A — ~15 minutes)

1. Pipedrive → **Tools and apps → Workflow automations**
2. Set the filter to **All automations** (not "My automations") — the default hides other users'
3. Toggle **Show inactive** on
4. For each row, screenshot or copy: **name · status · trigger · conditions · actions**
5. Paste into **`docs/architecture/GOS-pipedrive-automation-decisions-TEMPLATE.csv`**

That template already has every column this audit needs, including your `MY_DECISION` column.

### 2.3 What I *could* establish about them — evidence-based

**Proven — 40 webhook subscriptions, all active:**

| Destination | Count | Meaning |
|---|---|---|
| Make (`hook.us1/eu1.make.com`, `hook.integromat.com`) | **39** | Pipedrive pushes business events into Make |
| **GOS (`app.grafitiyul.co.il`)** | **1** | Webhook **1756503**, `*.*`, added 2026-07-30, last delivery 2026-08-03T17:06 = 200 |

**8 of the 39 have NEVER delivered** — `added.user` (124385), רדיפה לקבוע סיור (660914), Wassenger
chat link (660915), stage-change → Airtable (660918), guide-assignment activity (661063 — its own
name says *"closed at Elinoy's request, 14.2.24"*), group chasing (661090), business-customer Gantt
(661093), manual note (1085997). **These are dead and safe to remove as a group.**

**Proven — at least one Pipedrive Automation creates follow-up tasks.** 237 imported activities
titled **"ליד חדש ממתין לשיוך"** ("new lead waiting for assignment"), first seen 2026-06-29, last
2026-07-31, matching Pipedrive activity type 19 (`ליד חדש לשיוך`). That is an automation firing on
every new lead. **GOS equivalent:** CRM Tasks exists, but **no ingress→task rule is wired** — so
retiring this automation today would lose the follow-up task.

**Proven — automations write standard notes.** The most repeated note bodies on imported deals:
`נשלח וואצאפ "חוגגים מכירות"` (4,399), `פניה חדשה:` (2,078), `מולא טופס הרשמה לסיור` (1,359),
`פניה חדשה מהאתר` (767). Each is a recurring automated note, not a human one.

**Honest limit:** whether each of the 39 Make-bound webhooks is attached to a Workflow Automation or
was created directly by Make **cannot be determined from the API**. That distinction is exactly what
the 15-minute export resolves.

---

## PART 3 — Failed / lost leads: RESOLVED

### 3.1 How I recovered this

Make retains the **raw payload of every webhook delivery**. I harvested 729 deliveries across 166
hooks (GET only — nothing replayed). Because all website leads pass through `pipe4u`, its hook log
is a complete intake record for the retained window.

**Retained window: 2026-07-29T06:27 → 2026-08-03T21:02.** The incident began 2026-07-30 (zero 429
errors on any scenario before that date), so **the window fully covers the incident.**

### 3.2 The headline correction

**92 lead deliveries were retained — but they are only 15 distinct people.** The rest are Make
retrying the same submission. The "39 failures on 2026-08-01" were **two people**, retried ~25 times
each.

### 3.3 Every lead in the window, reconciled

| # | First attempt | Attempts | Name | Phone | Pipedrive deal? | GOS deal? |
|---|---|---|---|---|---|---|
| 1 | 07-29 06:27 | 1 | Maya yacobi | 0507233993 | ✅ | ✅ #26602 |
| 2 | 07-29 09:19 | 1 | Radmila Tkach | 0526154047 | ✅ | ✅ #26603 |
| 3 | 07-29 09:29 | 1 | Rotem Adler Waitzman | 0547539234 | ✅ | ✅ #26604 |
| 4 | 07-29 10:39 | 1 | גתית לרמן | 0544220337 | ✅ | ✅ #26605 |
| 5 | 07-29 13:53 | 1 | Liat Shafir | 0546516096 | ✅ | ✅ #26607 |
| 6 | 07-29 20:01 | 1 | Yudith Farhi | 0542802807 | ✅ | ✅ #26610 |
| 7 | 07-29 21:30 | 1 | תמר סתר | 0542253363 | ✅ | ✅ #26597 (won) |
| 8 | 07-30 09:37 | 1 | רעות קרייזמן ♡ | 0526504293 | ✅ | ✅ #26613 |
| 9 | 07-30 12:21 | 1 | Liat Kaufman | 0524502504 | ✅ | ✅ #26615 |
| 10 | 07-30 12:51 | 1 | Keren Ninyo | 0507340001 | ✅ | ✅ #26616 |
| **11** | **07-30 16:31** | **27** | **דיה כהן** | **0528666030** | ❌ | ❌ **LOST** |
| 12 | 07-31 04:58 | 2 | דור קורן *(your own test)* | 0524264020 | ✅ | ✅ #26617 |
| 13 | 07-31 16:16 | 28 | אורטל | 0509227007 | ⚠️ late | ✅ #27045 (Aug 3) |
| 14 | 08-01 08:59 | 23 | מירב | 0505063865 | ✅ (08-02 01:23) | ✅ #26619 |
| 15 | 08-03 12:16 | 2 | אתי אבנון | 0505229200 | ✅ | ✅ #26620 |

### 3.4 The one lost lead — full record

| Field | Value |
|---|---|
| **Name** | **דיה כהן** |
| **Phone** | **0528666030** |
| **Email** | **dayacohen1058@gmail.com** |
| **Interest** | 2–5 people · wants to **join an existing tour** (`להצטרף_לסיור_קיים`) |
| **Source** | Facebook (`utm_source=fb`), landing on `grafitiyul.co.il` |
| **First attempt** | 2026-07-30 16:31:58 |
| **Last attempt** | 2026-08-01 08:57:18 |
| **Delivery attempts** | **27** over ~40 hours |
| **Failure point** | `Find/Create UTM` → Pipedrive `429: daily request budget exceeded`. The deal was never created, so the Pipedrive→GOS bridge had nothing to relay. |
| **Pipedrive deal** | Never created |
| **GOS contact** | None |
| **GOS deal** | None |
| **Recoverable?** | **YES — completely.** Full payload retained in Make hook log; also captured in this audit's evidence file. |

**Note on #13 (אורטל):** the lead first arrived 2026-07-31 16:16 and was retried 28 times, but the
GOS deal (#27045, "אורטל ליזרוביץ") was only created **2026-08-03** — a ~2.5-day delay, and the name
differs, suggesting it was re-entered by hand rather than flowing through. Worth a 30-second check
that nothing was missed on that deal, but the customer is **not** lost.

### 3.5 Recommended recovery

| Option | How | Verdict |
|---|---|---|
| **A. Replay in Make** | The hook log is marked `replayable: true` | ❌ **Do not** — it replays into the same Pipedrive path that is still failing |
| **B. Create the deal by hand in GOS** | All details are in §3.4 | ✅ **Fastest — do this today.** ~2 minutes. The lead is already 4 days cold. |
| **C. Post the retained payload to GOS ingress** | Once `WEBSITE_FORM_SECRET` is set | ✅ **Cleanest** — preserves source/UTM attribution and fires the manager alert. Do this if §4 lands within a day or two. |

**Recommendation: B now** (the lead is 4 days old and wanted to join an existing tour — timing
matters), and treat C as the pattern for any future gap.

### 3.6 Why this cannot recur once §4 is done

GOS's ingress keys idempotency on a **body hash**. Those 27 identical retries would have collapsed
into **one** event, and GOS answers 200 as soon as the payload is durably stored — then retries
internally with exponential backoff. The entire failure class disappears; it exists only because
Make's success depends on Pipedrive's API budget being available at that instant.

---

## PART 4 — Removing Pipedrive from the intake flow

### 4.1 `Website → Make → GOS`: **YES. This is small.**

I compared what Make already sends against what GOS already accepts.

**What `pipe4u` sends today** (read from a real delivery):
```
{ name, email, phone, date, url, messege, webpage }
```

**What the GOS website-form adapter already understands** (`server/src/ingress/adapters/websiteForm.js`):

| Make field | GOS alias exists? | Maps to |
|---|---|---|
| `name` | ✅ | fullName |
| `email` | ✅ | email |
| `phone` | ✅ | phone |
| `url` | ✅ | pageUrl |
| `date` | ✅ | preferredDate |
| `messege` | ❌ **misspelled in Make** | message |
| `webpage` | ❌ | pageUrl (secondary) |

**5 of 7 fields already work with zero code changes.** The two misses are one line of config.

### The complete change list

| # | Change | Where | Effort | Risk |
|---|---|---|---|---|
| 1 | Set `WEBSITE_FORM_SECRET` | Railway env | 2 min | None |
| 2 | Add `'messege'` and `'webpage'` to the alias table | `websiteForm.js` — one line | 5 min | None |
| 3 | Point `pipe4u`'s HTTP module at `POST /api/ingress/website-form/<secret>/<formKey>` **in addition to** Find/Create UTM | 1 Make scenario | 10 min | Reversible instantly |
| 4 | Watch both systems for 48h, then remove the Find/Create UTM call | 1 Make scenario | — | Reversible |

**Because all 12 lead sources funnel through `pipe4u`, step 3 redirects every website lead at once.**

### What is genuinely lost, and what replaces it

| Pipedrive did this | Replacement | Status |
|---|---|---|
| Person/deal dedupe by org + phone | `ingress/resolve.js` — phone-then-email, 30-day window | ✅ **Stronger already** |
| Israeli phone normalisation | `ingress/normalize.js` | ✅ |
| Lead-source labelling | `formKey` → source label | ⚠️ Needs a `formKey` per form (config only) |
| Campaign attribution | `attribution.js` + `DealMarketing` | ✅ |
| Office WhatsApp notification | Manager Report **#25** — 11 sends verified | ✅ Fires from ingress **and** the mirror |
| Follow-up task | CRM Tasks | ❌ **Gap G9 — no ingress→task rule** |
| Note on the deal | Pinned intake note | ✅ |

**Only one real gap: the automatic follow-up task.** Everything else is already better in GOS.

### Remaining Pipedrive dependencies after this change

| Dependency | Still needed? |
|---|---|
| Webhook 1756503 → GOS | **Yes** — until *all* sources bypass Pipedrive (manual leads, agent forms, Woo orders) |
| Pipedrive API tokens in Make | Yes — 206 other scenario usages |
| Pipeline 1 / `stage_id=1` | No longer on the website-lead path |
| Lead custom fields | No longer written for website leads |
| **Closed-deal file bodies** | **Yes — permanent data-loss risk on downgrade.** See §4.3 |

### 4.2 `Website → GOS` (Make removed entirely): achievable, but bigger

| # | Blocker | Why it blocks | Fix |
|---|---|---|---|
| B1 | 12 Elementor forms must each be repointed | Each is edited by hand in WP Admin | ~1h total. Do lowest-traffic first, **footer last** (127+97 pages) |
| B2 | Nobody has confirmed which Make webhook each form posts to | The mapping is correlated by name, never read from the form config | Open each form's *Actions After Submit* |
| B3 | Payload shape differs per form | Hebrew labels + raw Elementor ids | Alias table already covers the observed shapes — **verified against real payloads in this audit** |
| B4 | Abandoned cart (430271) is a Make schedule reading WooCommerce | 1,282 pending orders; no GOS equivalent | Build the GOS poller (gap G7) |
| B5 | Woo checkout orders | `WOO_PRIMARY_WEBHOOK_SECRET` unset; adapter gaps G1/G2/G4 | Credential + 3 small fixes |
| B6 | Cognito / Google Forms / Smoove sources | Still Make-only | Repoint to `website-form` with their own `formKey`, or replace |
| B7 | Follow-up task on new lead | Gap G9 | One rule |
| B8 | Marketing list (Smoove) | No GOS replacement at all | **Product decision: keep Smoove, or drop it** |

**None of B1–B8 blocks §4.1.** They only block full Make removal.

### 4.3 One irreversible item, unrelated to leads

Closed-deal **file bodies were never copied out of Pipedrive** — the migration crosswalked them as
metadata only (8,570 file records, 2,932 with card data, bodies on R2 only for active deals).
**Downgrading or closing Pipedrive destroys them permanently.** This must be decided before any
account change, and it is not on any existing checklist.

---

## PART 5 — Decision package

### 5.1 Make scenarios

Full table: **`GOS-make-decisions-2026-08-04.csv`** (233 rows, `MY_DECISION` blank).
Summary of what is being asked:

| Scenario group | Business purpose | Recommendation | My decision |
|---|---|---|---|
| **92 inactive scenarios** | Historical; already off | **Can shut down now** | |
| 4452993, 3956203, 1126290, 1051602 | Guide daily schedule + summary chasing (WhatsApp) | **Replace inside GOS** — Reports #11–#16, both firing today | |
| 2693681, 2906484, 3190154, 2883326, 2844878, 4207107 | Payroll: calculate, guide approves, office approves | **Replace inside GOS** — Payroll module | |
| 4095754, 2600471 | Keep Google Calendar in step with tour changes | **Replace inside GOS** — Calendar sync | |
| 889252, 4131369, 1978153 | Create Drive/Photos folders per tour | **Replace inside GOS** — Files + Gallery | |
| 3121861, 4345044, 4447721, 4359629 | WhatsApp content into the deal; contact creation | **Replace inside GOS** — WhatsApp + Contacts | |
| 835533, 835854, 4677340, 1899057 | Payment links, capture, collection state | **Replace inside GOS** — Cardcom + Collection | |
| 4548217, 4357153, 430254 | Airtable housekeeping | **Can shut down now** — Airtable is retired | |
| **1069253, 3897811 + 10 form scenarios** | **Website lead → Pipedrive** | **Keep temporarily** → then §4.1 | |
| 440477, 430271 | Website purchase + abandoned cart | **Keep temporarily** — Woo ingress not switched on | |
| 1443901, 1817282 | Quote build + post-signature | **Keep temporarily** — no Prospero equivalent | |
| 1993303, 1993342 | Agent/producer order forms | **Keep temporarily** | |
| **22 auto-disabled** | See §1.4 | **Requires my decision** | |
| **40 active-but-idle** | No runs in the retained window | **Requires my decision** | |
| 1445570 | Feedback-call form — **77% error rate**, purpose unclear | **Requires my decision** | |

### 5.2 Pipedrive automations

| Automation | Business purpose | Recommendation | My decision |
|---|---|---|---|
| *(to be filled from the 15-min export — §2.2)* | | | |
| **Webhook 1756503 → GOS** | Relays every Pipedrive change to GOS — the lead bridge | **KEEP ACTIVE** — remove last | |
| 8 never-delivered webhooks (124385, 660914, 660915, 660918, 661063, 661090, 661093, 1085997) | Dead subscriptions, never fired | **Can shut down now** | |
| 31 other Make-bound webhooks | Push business events into Make | **Keep temporarily** — retire with their scenario | |
| *Inferred:* new-lead → create "ליד חדש ממתין לשיוך" task | Follow-up task on every new lead | **Replace inside GOS** — needs the ingress→task rule (G9) first | |

### 5.3 Failed leads

| Lead | Recoverable? | Recommended action | My decision |
|---|---|---|---|
| **דיה כהן** · 0528666030 · dayacohen1058@gmail.com · wants to join an existing tour, 2–5 people, from Facebook, 2026-07-30 | **YES — full details retained** | **Create the deal in GOS by hand today** (§3.4 has everything). Lead is 4 days cold. | |
| אורטל · 0509227007 | Already in GOS (#27045) | 30-second check that nothing was missed on that deal | |
| The other 13 | Not lost | No action | |

### 5.4 Migration tasks

| # | Task | Reason | Blocking? | Effort |
|---|---|---|---|---|
| **1** | **Read Pipedrive → Settings → API usage** | The estate is degraded; readiness cannot be measured through a live outage | **BLOCKS EVERYTHING** | 5 min (you) |
| **2** | Export Pipedrive Workflow Automations | Whole category unauditable via API | Blocks Part 2 | 15 min (you) |
| **3** | Decide the 22 auto-disabled scenarios | 6 have no GOS equivalent and are silently off | Blocks customer-comms retirement | 20 min (you) |
| **4** | Recover lead דיה כהן | Real customer, 4 days cold | No | 2 min |
| **5** | Set `WEBSITE_FORM_SECRET` | Unlocks shipped ingress code | **Blocks §4.1** | 2 min |
| **6** | Add `messege` + `webpage` aliases | Two fields would be dropped | Blocks §4.1 | 5 min |
| **7** | Point `pipe4u` at GOS (keep Pipedrive in parallel) | Removes Pipedrive from intake | — | 10 min |
| **8** | Watch 48h, then drop the Pipedrive call | Confirms parity | — | — |
| **9** | Build ingress→follow-up-task rule (G9) | Only real capability lost with Pipedrive intake | Blocks full intake cutover | ~half day |
| **10** | Disable Make guide comms (4 scenarios) | Confirmed double-sending to guides today | No | 10 min |
| **11** | Rebuild 6 customer-facing automations in CC | Payment reminders + follow-ups are silently off | Blocks Make retirement | ~2 days |
| **12** | Set `WOO_PRIMARY_WEBHOOK_SECRET` + fix G1/G2/G4 | Woo orders still need Make | Blocks Woo cutover | ~half day |
| **13** | Build abandoned-cart poller (G7) | 1,282-order lead pool | Blocks retiring 430271 | ~half day |
| **14** | **Decide: copy closed-deal file bodies out of Pipedrive** | **Permanent data loss on downgrade** | **Blocks Pipedrive downgrade** | ~1 day |
| **15** | Decide Smoove: keep or drop | No GOS replacement | Blocks full Make retirement | Decision only |
| **16** | Repoint 12 Elementor forms directly to GOS | Removes Make from intake | Blocks Make removal | ~1h + watch |
| **17** | Add Make failure alerting (until Make is gone) | A full-day lead outage went unnoticed | No, but cheap insurance | 30 min |

### 5.5 Suggested sequencing

**Today (you):** tasks 1, 2, 3, 4 — about 45 minutes total.
**This week (small, reversible):** 5, 6, 7, 8, 10, 17 → Pipedrive leaves the intake path and guide
double-sends stop.
**Next (real build):** 9, 11, 12, 13 → the remaining capability gaps.
**Then (one-way):** 14, 15, 16 → account changes and Make removal.

---

## Evidence classification

| Claim | Status |
|---|---|
| Exactly one lead lost (דיה כהן), with full contact details | **PROVEN** — Make hook-log payloads reconciled against GOS contacts/deals by phone and email |
| 92 lead deliveries = 15 distinct people | **PROVEN** — deduplicated by phone/email |
| Retention window covers the whole incident | **PROVEN** — window starts 2026-07-29; zero 429s on any scenario before 2026-07-30 |
| Make's payload is 5/7 compatible with GOS ingress today | **PROVEN** — real payload compared against the live alias table |
| All 12 lead sources funnel through `pipe4u` | **PROVEN** — blueprint HTTP module targets |
| Pipedrive Workflow Automations unreadable via API | **PROVEN** — 9 endpoints × 2 hosts × 2 auth methods |
| At least one Pipedrive Automation creates follow-up tasks | **PROVEN** — 237 imported "ליד חדש ממתין לשיוך" activities |
| Which of the 39 webhooks belong to Workflow Automations | **UNKNOWN** — resolved by the 15-min export |
| Root cause of the API budget exhaustion | **UNKNOWN** — GOS steady-state usage ruled out; needs the usage screen |
| Purpose of 40 active-but-idle scenarios | **UNKNOWN** — no retained execution history |

---

## Safety

GET/SELECT only. ~1,300 read requests. No scenario paused, edited, enabled, disabled, replayed,
cloned or deleted. No Pipedrive write of any kind. No token rotated. No secret printed. No customer
contacted. No GOS runtime change, env change or deploy. Raw payloads (which contain real customer
PII) stayed in the session scratchpad and are **not committed**.

---

*Decision package. Nothing implemented. Awaiting your decisions in the CSV columns and on items A, B, C.*
