# Make Retirement — Decision Log

**Started:** 2026-08-04
**Source of truth for facts:** `GOS-retirement-decision-package-2026-08-04.md`,
`GOS-make-business-inventory-2026-08-04.md`, `GOS-make-decisions-2026-08-04.csv`
**This file records only DECISIONS.** No auditing happens here.

Decision vocabulary: `Disable now` · `Keep temporarily` · `Replace inside GOS` ·
`Merge into another workflow` · `Delete permanently` · `Needs separate discussion`

---

## Walkthrough map (24 sittings, 233 scenarios)

| # | Business group | Count | Status |
|---|---|---|---|
| A1 | Business-customer payment reminders + daily receipts | 4 | ✅ decided |
| A2 | Private-customer sales follow-ups | 3 | **in progress** |
| A3 | After-activity follow-ups & collection handover | 3 | pending |
| A4 | Evening office digests & nightly closures report | 3 | pending |
| A5 | CRM hygiene (auto-lost, task safety net, dedupe, control) | 5 | pending |
| A6 | Small helpers that switched off in the outage | 4 | pending |
| B | Lead intake → Pipedrive | 15 | pending |
| C | Guide operations & payroll | 11 | pending |
| D | Deal became WON → post-sale chain | 13 | pending |
| E | Business customers (live + idle) | 13 | pending |
| F | Payments / clearing | 5 | pending |
| G | WhatsApp (Wassenger) | 16 | pending |
| H | WhatsApp conversation into the deal | 5 | pending |
| I | Quotes | 5 | pending |
| J | Agents & producers | 5 | pending |
| K | "Landoliny" new automations | 12 | pending |
| L | Lost & rejection handling | 8 | pending |
| M | Exposure tours (חשיפה) | 5 | pending |
| N | Business pre-sale | 4 | pending |
| O | Unfiled — currently live | 11 | pending |
| P | Unfiled — active but idle | 16 | pending |
| Q | Small folders (AI, One click, כללי, שעות עבודה, טריגרים, היסטוריה) | 9 | pending |
| R | Already-inactive & archive | 92 | pending |

---

## Decisions recorded

| # | ID | Scenario | Decision | Notes | Date |
|---|---|---|---|---|---|
| A1-a | 430267 | לקוחות עסקיים - הוצאת קבלות פעם ביום - 8:00 | **Delete permanently** | Owner: almost certainly never really active or useful in practice. Do NOT rebuild. | 2026-08-04 |
| A1-a | 430273 | לקוחות עסקיים - הוצאת קבלות פעם ביום - 16:00 | **Delete permanently** | Same as 430267. | 2026-08-04 |
| A1-b | 430295 | תזכורת לתשלום ביום הפעילות ללקוח + המדריך | **Replace inside GOS — later** | Deferred to the dedicated collections/payment-communications design session. **Owner corrected the business rule:** the trigger is NOT "customer still owes money". The real rule is **payment method = payment on the day of the activity (e.g. cheque) → notify the guide before the activity so they know they are expected to collect**. | 2026-08-04 |
| A1-c | 430291 | תזכורת לקראת פעילות + תזכורות לתשלום (שבת - ערב) | **Replace inside GOS — later** | Same deferral. All customer/payment reminder flows to be designed together in the collections communications session, not piecemeal during migration. | 2026-08-04 |
| B | 430307 | דף נחיתה אלמנטור > פייפדרייב | **TURN OFF** | Obsolete old-website intake chain. | 2026-08-08 |
| B | 430315 | טופס בעמודי מוצר באתר > פייפדרייב | **TURN OFF** | Obsolete old-website intake chain. | 2026-08-08 |
| B | 430331 | טופס עמוד צור קשר באתר > פייפדרייב + סמוב | **TURN OFF** | Obsolete old-website intake chain. | 2026-08-08 |
| B | 430320 | דף נחיתה פעילות בת מצווה > פייפדרייב + סמוב | **TURN OFF** | Obsolete old-website intake chain. Dead receiver, 0 runs. | 2026-08-08 |
| B | 430321 | טופס פוטר באתר > פייפדרייב + סמוב | **TURN OFF** | Obsolete old-website intake chain. Dead receiver, 0 runs. | 2026-08-08 |
| B | 430346 | פופאפ צור קשר באתר > פייפדרייב | **TURN OFF** | Obsolete old-website intake chain. Dead receiver, 0 runs. | 2026-08-08 |
| B | 1069253 | pipe4u | **TURN OFF** | Central old-website lead router. No caller survives once the 6 receivers are off. | 2026-08-08 |
| B | 3897811 | Find/Create UTM | **TURN OFF** | Helper called only from inside the old-website chain; no independent trigger. | 2026-08-08 |

**Owner ruling on group B:** no future-rebuild record needed. The business requirement (website lead
intake) already exists via **new website → GOS ingress**. Only the obsolete implementation
(old website → Make → Pipedrive) is being retired.

**Explicitly NOT touched** (separate sources, to be reviewed individually): `430317` (Google Forms
leads), `430343` + `430335` (Smoove subscribers), `430337` (email link → contact).

### Batch 2 — Guide communications (folder מדריכים)

| ID | Scenario | Decision | Notes | Date |
|---|---|---|---|---|
| 4452993 | שליחת לו"ז הודעה של כל הסיורים של מחר | **TURN OFF** | Owner: intentional retirement. | 2026-08-08 |
| 1126290 | רדיפה למדריך למלא טופס תיאום סיור | **TURN OFF** | Owner: intentional retirement. | 2026-08-08 |
| 4749928 | הודעה חדשה על כל מדריך שמילא טופס תיאום סיור | **TURN OFF** | Owner: intentional retirement. | 2026-08-08 |
| 1051602 | שליחת הודעה למדריך טופס סיום הסיור - סיכומי סיור | **TURN OFF** | Owner: intentional retirement. | 2026-08-08 |
| 1126045 | שליחת תכנים ללקוח לאחר מילוי טופס סיכום סיור + מחיקת הודעות מתוזמנות | **TURN OFF** | Owner: intentional retirement. | 2026-08-08 |

**Owner ruling on Batch 2:** no GOS-coverage investigation, no replacement design, no follow-up
development tasks arising from this batch.

---

### Batch 3 — Payroll, payment links, WhatsApp-into-deal, helpers

| ID | Scenario | Decision | Date |
|---|---|---|---|
| 2693681 | מחשבון שכר | **TURN OFF** | 2026-08-08 |
| 2844878 | תזמון חודשי למחשבון שכר | **TURN OFF** | 2026-08-08 |
| 2883326 | עדכון חודש ושנה בשכר | **TURN OFF** | 2026-08-08 |
| 4207107 | הכנסת הערות עבור השכר מהפייפ | **TURN OFF** | 2026-08-08 |
| 430349 | כפתור באיירטייבל להקמת מדריך.ה חדש.ה | **TURN OFF** | 2026-08-08 |
| 835533 | לינק לסליקה | **TURN OFF** | 2026-08-08 |
| 835854 | תפיסת הסליקה מדף סליקה בפייפ | **TURN OFF** | 2026-08-08 |
| 3934706 | מוטרג מהתוסף חשבוניות אצל לאנדוליני | **TURN OFF** | 2026-08-08 |
| 4345044 | הכנסת התכתבות וואצאפ לדיל | **TURN OFF** | 2026-08-08 |
| 4359629 | הקמת איש קשר בפייפ | **TURN OFF** | 2026-08-08 |
| 4447721 | בדיקה אם איש קשר קיים בפייפ ושליחה לאיירטייבל | **TURN OFF** | 2026-08-08 |
| 4548217 | מחיקת דטא לאחר שבוע שלא הוקם איש קשר בפייפ | **TURN OFF** | 2026-08-08 |
| 4357153 | מחיקת הדטא הודעות וואצאפ | **TURN OFF** | 2026-08-08 |
| 1213773 | Office hours calculator | **TURN OFF** | 2026-08-08 |
| 3252574 | ביטול סיור חשיפה בקוגניטו | **TURN OFF** | 2026-08-08 |

**Owner ruling on Batch 3:** explicit retirement of all 15. No replacement investigation or design.

---

### Batch 4 — WON chain, lost deals, quotes

| ID | Scenario | Decision | Date |
|---|---|---|---|
| 889158 | לאנדוליני לקוח - מילוי טופס הרשמה לסיור | **TURN OFF** | 2026-08-08 |
| 1651940 | שליחת מסר לאחר WON | **TURN OFF** | 2026-08-08 |
| 1015939 | שליחת וואצאפ חוגגים סגירות אחרי וון | **TURN OFF** | 2026-08-08 |
| 440477 | רכישה מהאתר > מייל אישור > יומן > קבלה > פייפדרייב | **TURN OFF** | 2026-08-08 |
| 1889926 | הוצאת חשבונית עסקה לאחר סגירה | **TURN OFF** | 2026-08-08 |
| 4602660 | הוצאת חשבונית עסקה לאחר סגירה 2 | **TURN OFF** | 2026-08-08 |
| 889252 | פתח תיקיה בגוגל דרייב | **TURN OFF** | 2026-08-08 |
| 965408 | עדכון בדיל טופס הרשמה לסיור | **TURN OFF** | 2026-08-08 |
| 728643 | טופס עדכון סיור לפייפ 7 | **TURN OFF** | 2026-08-08 |
| 1899057 | עדכון שולם מהפייפ לאיירטייבל | **TURN OFF** | 2026-08-08 |
| 1160762 | ביטול עסקה - לוסט | **TURN OFF** | 2026-08-08 |
| 2034772 | דיל הפך ללוסט-שליחה לסמוב | **TURN OFF** | 2026-08-08 |
| 440482 | עסקאות שהפכו ללוסט > עדכון לוואטסאפ | **TURN OFF** | 2026-08-08 |
| 1443901 | הצעת מחיר | **TURN OFF** | 2026-08-08 |
| 1817282 | לאחר החתימה על ההצעה | **TURN OFF** | 2026-08-08 |

### Batch 5 — all 33 remaining regularly-running scenarios

**Decision: TURN OFF (all 33).** Owner: explicit retirement, no replacement investigation.

`2125961` · `4131439` · `440474` · `4549250` · `3121861` · `430326` · `3956203` · `4459424` ·
`2906484` · `3190154` · `4095754` · `2600471` · `1830861` · `4131369` · `1978153` · `1993342` ·
`1993303` · `430353` · `430333` · `1564301` · `2725066` · `4677340` · `4453116` · `964304` ·
`698867` · `1411537` · `830264` · `1445570` · `430341` · `430271` · `430254` · `2607384` · `3734669`

**Milestone:** with Batch 5 decided, **every regularly-running Make scenario has a decision.**
76 enabled scenarios are instructed TURN OFF; 43 enabled-but-idle remain.

### Batch 6 (final) — all 43 enabled-but-idle scenarios

**Decision: TURN OFF (all 43).** Owner: explicit retirement of every enabled scenario.

`430317` · `430343` · `430335` · `430337` · `1989063` · `430324` · `430308` · `430325` · `430345` ·
`4561651` · `1443989` · `430351` · `430342` · `430314` · `430339` · `4698828` · `430334` · `430330` ·
`430311` · `1914956` · `1449188` · `704964` · `445168` · `430344` · `445156` · `3190312` · `430338` ·
`430332` · `439285` · `4046811` · `601178` · `456768` · `1586537` · `3106389` · `3162997` · `3314785` ·
`430322` · `3648282` · `430347` · `3018034` · `430312` · `430340` · `1711911`

**Owner position:** every Make scenario presented as enabled has been decided TURN OFF.

---

## Final census — live Make state, 2026-08-08

Read directly from the Make API (`GET /scenarios`, team 120547, all 233 rows).

| Measure | Count |
|---|---|
| Total scenarios | 233 |
| **Enabled (`isActive: true`)** | **118** |
| Disabled (`isActive: false`) | 115 |
| Flagged invalid | 28 (0 of them enabled) |
| Decisions recorded TURN OFF | 119 |
| **Actually disabled by us in Make** | **0** |

- All 118 currently-enabled scenarios carry a TURN OFF decision. **Zero enabled scenarios lack a decision.**
- All 22 outage auto-disabled scenarios remain inactive. All 92 previously-inactive remain inactive.
- **Census drift, 1 row:** `430271` (abandoned-cart poller) was `live` in the 2026-08-04 audit and is
  now `isActive: false` **and flagged invalid** in Make. It switched itself off between 08-04 and
  08-08. Decision (TURN OFF) is unaffected.

---

## ✅ Execution status — COMPLETE

**All 233 Make scenarios are disabled.** Shutdown was performed manually by the owner in the Make
UI on 2026-08-08 (the Railway `MAKE_API_TOKEN` carries read scopes only — `scenarios:write` was
never granted, so no shutdown was executed programmatically).

**Independent read-only verification, 2026-08-08T16:40:50Z** — fresh `GET /scenarios`, team 120547,
all 233 rows, no cached data:

| Measure | Result |
|---|---|
| Total scenarios | **233** |
| Enabled (`isActive: true`) | **0** |
| Disabled | **233** |
| Flagged invalid | 28 (all disabled) |
| Paused | 0 |
| Of the 118 enabled at the prior census, still enabled | **0** |
| Unexpected state changes (OFF→ON, new, deleted) | **0** |
| Live scenarios absent from the 233-row inventory | **0** |

**Make is fully retired for operations.** No further Make shutdown action is required.

---

## Deferred design sessions (parking lot)

### DS-1 — Collections / payment communications
Owner's rule: customer- and payment-facing reminder flows are **designed as one system**, not
rebuilt scenario-by-scenario during this migration.

Items parked here:
- `430295` — guide notification before an activity when **payment method = pay on the day**
  (e.g. cheque), so the guide knows they are collecting.
- `430291` — Saturday-evening pre-activity + payment reminders to business customers.

---

## Final shutdown plan

*(produced only after every scenario has a decision)*
