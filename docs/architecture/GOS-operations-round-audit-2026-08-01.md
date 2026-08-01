# GOS Operations Round — Architecture Audit (Parts 1–12)

**Date:** 2026-08-01
**Status:** AUDIT + PROPOSAL. No code written. Awaiting approval.
**Covers:** Automation Registry 2a–2d · Queue module · Staff language · Dual-language
manager reports · Questionnaire multilingual · Control cleanup · Management Tasks ·
Tour Summary automations · Logistics Report · Manager reports (email + WhatsApp)

---

## 0. Headline findings

Five things decide the shape of this whole round:

1. **The queue you want is four tables and four workers, and they should stay four.**
   Merging them would be a rewrite of every send path. What is missing is not a queue —
   it is a **read-only aggregation layer**. Same shape as the unified Files list.

2. **The sending-window engine already exists and is excellent** — `communication/windows.js`
   is pure, DST-correct, unit-tested, with `nextAllowedAt()` for "when may this next go
   out". It is wired to **exactly one consumer** (Communication Center deliveries).
   Part 2 is mostly *re-keying and re-using* it, not building it.

3. **One live behaviour directly contradicts your requirement.** The WhatsApp scheduled
   worker **deletes** work: `pending` rows more than 2h past their time are flipped to
   `skipped`. A provider outage overnight today loses those messages. That was a
   deliberate decision ("never send a good-morning at midnight") which the sending-window
   policy now supersedes — but it is a change to a live send path.

4. **Translation infrastructure already exists** (`communication/translate.js` — Claude,
   token-preserving, always produces a reviewable draft). Parts 4 and 5 should reuse it.
   It needs `ANTHROPIC_API_KEY`, which is **still not set in Railway**.

5. **Part 6 is much smaller than it looks.** I queried production: there are **4 open
   issues total**. Two are real (`deal_tour_out_of_sync`), two are stale migration
   leftovers that can never self-resolve. There is no Pipedrive detector at all.

---

## 1. Audit by part

### Part 2 — WhatsApp + Email Queue

**Four independent queues exist today. All four are well built.**

| Queue | Model | Worker | Idempotency | Provider-outage handling |
|---|---|---|---|---|
| Communication Center | `CommunicationDelivery` | `deliveryWorker` 60s | `(messageId, triggerKey, recipientKey)` | connection codes → retry; **has window support** |
| Scheduled WhatsApp | `WhatsAppScheduledMessage` | `scheduledWorker` 60s | `gos-sched-<id>-<at>-a<n>` | `connectionDeferredCount` — defers without burning an attempt ✅ |
| Scheduled Email | `ScheduledEmail` | `email/scheduledWorker` 60s | `gmailMessageId` | `connectionDeferredCount` ✅ |
| Admin Reports | `AdminReportDelivery` | `adminReports/worker` 60s | `(reportNumber, idempotencyKey)` | attempt ladder, **terminal at 6 attempts** ⚠ |

Shared already: `whatsapp/sendPace.js` (one anti-burst policy for every automated
sender), `bridgeClient`, `phoneToJid`.

**Gap 1 — no aggregate view.** Nothing renders all four together. Each has its own log
screen or none at all.

**Gap 2 — windows serve one queue.** `CommunicationMessage.windowEnabled` +
`sendingWindowId` is the only entry point. Scheduled WhatsApp, scheduled email and admin
reports ignore windows entirely.

**Gap 3 — windows are keyed per MESSAGE, you want per AUDIENCE × CHANNEL.**
`CommunicationSendingWindow` has no audience or channel dimension. Today a window is
chosen individually on each message.

**Gap 4 — messages can be silently dropped** (`STALE_AGE_MS = 2h` → `skipped`). The
בקרה detector `whatsapp_scheduled_stuck` surfaces these, so they are not invisible — but
they are not sent, and they do not resume when the bridge returns.

**Gap 5 — Admin Reports can exhaust.** Six attempts on an exponential ladder caps around
a few hours. A long WhatsApp outage turns reports into `failed_final`, which no worker
retries.

### Part 3 — Staff language

`PersonRef` carries `displayName` (one string), `email`, `phone`, and
`identitySource: 'recruitment' | 'management'`. There is **no first/last split and no
English name anywhere**. `PersonProfile` is documented as *"Operational data, always
owned by management"* — the deliberate identity-vs-operations line.

**The decision this forces:** identity fields on `PersonRef` are overwritten by
recruitment sync. If English names live there, a sync could clobber them. Placing them
on `PersonProfile` makes them management-owned and safe. Given the staff-migration
programme is mid-flight (slices A–D done, E pending), this needs an explicit answer.

### Part 4 — Dual-language manager reports

Admin Reports are **code-managed by deliberate design** — `registry.js` documents this
as an explicit exception to the editable-template rule, bought for exact formatting
control. Each report has `render(ctx)` returning a Hebrew string, plus `sample()`.
`audience: 'guides'` already exists, and `GUIDE_REPORTS` already routes per-person.

**The tension:** you asked for side-by-side *editing* with live regeneration. That means
report bodies become **data**, which is precisely what the current design deliberately
avoided. Two coherent answers — this is the main question I need answered (§5).

### Part 5 — Questionnaire multilingual

**Better news than expected.** The data model is already fully multilingual: every
label/help/placeholder/option is a localized JSON map, with `resolveLocalized`,
`hasLanguage`, per-language publish validation and a frozen per-answer snapshot in the
responder's language. `QuestionnaireTemplate.supportedLanguages` exists.

What is poor is only the **editing UX**: `LanguageSwitcher` sets ONE global editing
language, so you edit Hebrew, switch tab, edit English, switch back. Nothing is
side-by-side.

**So Part 5 is a UI change plus a one-time content migration — no schema change.**

Guide-language delivery needs Part 3 (`preferredLanguage`) and one line in the fill
surface: the questionnaire runtime already resolves to a language; today it comes from
the tour/deal/contact, not from the guide.

### Part 6 — Control cleanup (measured, not guessed)

Production `OperationalIssue`, queried 2026-08-01:

| Type | Open | Resolved | Verdict |
|---|---|---|---|
| `deal_tour_out_of_sync` | **2** | 130 | **Real.** Keep — but 130 resolutions is churn worth reviewing separately. |
| `legacy_sync_conflict` | **2** | 4 | **OBSOLETE.** Last seen 2026-07-31 11:59, hours before the legacy cutover completed. The mirror no longer runs, so these can never auto-resolve. |
| `legacy_tour_product_unmatched` | 0 | 9 | **OBSOLETE.** Migration-era; all resolved. |
| `tour_over_capacity` | 0 | 1 | Real, dormant. |

**Never fired at all** (registered, dormant, all real safety nets):
`gallery_cleanup_approval`, `whatsapp_scheduled_stuck`, `held_reservation_expired`,
`reservation_stuck`, `reservation_link_abuse`, `woo_sync_failed`,
`open_tour_generation_failed`, `booking_integrity`, `tour_change_impact`.

**There is no Pipedrive detector.** Nothing to remove there.

So the cleanup is: retire the two legacy issue types, close the 2 stale rows, and
document the remaining 11. Small and safe.

### Part 7 — Management Tasks

**`Task` cannot host this.** It is Deal-scoped: `dealId` is required with cascade delete.
A Tour Summary review card belongs to a tour and a guide, not a deal.

**`OperationalIssue` is closer but semantically wrong.** Its whole contract is
*"re-derive from live state; auto-resolve when the condition disappears."* A Tour Summary
review card must **not** vanish because the summary still exists — it is dismissed by a
human, once. Forcing it into `OperationalIssue` would corrupt that contract for every
existing detector.

**Verdict: a new model, reusing the proven card + action-registry pattern** from
`control/registry.js`, not its lifecycle.

### Parts 8–12 — the business layer

- **Part 8 (AUT-001)** needs the outstanding balance: `server/src/collection.js` is
  already the server-side SSOT (receipt + invrec − refund). Reuse it; never re-derive.
- **Parts 8 and 12 overlap.** Both are "notify managers after a Tour Summary". Part 8
  says Communication Center; Part 12 reads like an Admin Report (fixed internal layout,
  deep link). Running both would mean two manager notifications from one submission.
- **Part 11 needs email in Admin Reports, which today are WhatsApp-only** (`callBridge`,
  `phoneToJid`, `AdminReportConfig.waAccountId/waChatId`). `email/simpleSend.js` exists
  for server-initiated sends, so this is an added channel, not a new sender.
- **Parts 9, 10, 12** all depend on Part 7 existing (cards + deep links).

---

## 2. Shared architecture

Five shared pieces carry this whole round. Everything else hangs off them.

### 2.1 `queue/` — one read-only aggregation layer (Part 2)

```
server/src/queue/
  types.js        the canonical QueueItem DTO
  sources/        one adapter per existing queue — READ ONLY
    communication.js  whatsappScheduled.js  emailScheduled.js  adminReports.js
  service.js      merge · filter · sort · paginate · queue position
  actions.js      cancel / reschedule / send-now — DELEGATED to the owning module
```

Canonical DTO:

```js
{
  source, sourceId,            // 'communication' | 'wa_scheduled' | ...
  channel,                     // 'whatsapp' | 'email'
  status, statusHe,            // normalised across sources
  waitReasonHe,                // why it has not gone out
  scheduledAt, effectiveAt,    // requested vs next-allowed
  queuePosition,               // per (channel, sender account)
  recipient: { name, phone, email, kind },  // kind: customer|guide|manager
  sender:    { accountId, label },
  preview:   { subject, body, attachments },
  origin:    { moduleHe, label, link },     // "מרכז התקשורת · מסר #7"
}
```

**No new queue table, no new worker, no second send path.** Each adapter reads its own
model. Actions delegate to the endpoints that already own them.

### 2.2 `sendingPolicy.js` — windows for every sender (Part 2)

`windows.js` stays **untouched** — it is already correct. What is new is *policy
resolution*: today the window is picked per message, tomorrow it is resolved from
**(audienceKind × channel)**.

```
resolveSendPolicy({ audienceKind, channel, messageOverride? }) → policy
                                    ↓
                        windows.js  evaluateAt / nextAllowedAt   (unchanged)
```

`audienceKind` ∈ `customer | guide | manager`, `channel` ∈ `whatsapp | email` — a 6-cell
matrix, plus "both/global". Per-message overrides in the Communication Center keep
working: an explicit choice beats the matrix.

Then all four workers ask the same question before sending, and a blocked message becomes
**`waiting_window` with a reason**, never `skipped`. The overnight-backlog requirement
falls out of `nextAllowedAt()` for free.

### 2.3 Localized content — ONE convention, already chosen (Parts 4, 5)

The questionnaire engine's localized JSON map (`{ he, en }` + `resolveLocalized` +
`hasLanguage`) is the established pattern. Manager reports should adopt **the same
shape** rather than invent a parallel one, and `communication/translate.js` should be the
**only** translation caller in the codebase (Hebrew → English, tokens verified, output
always a reviewable draft — never auto-published).

### 2.4 `reviewItems/` — the Management Tasks core (Parts 7, 9, 10)

A new model with a **human-dismissal** lifecycle, deliberately distinct from
`OperationalIssue`'s auto-resolve:

```prisma
model ReviewItem {
  id, kind,            // 'tour_summary' | 'logistics_report' | future kinds
  dedupeKey  @unique,  // exactly-once creation
  status,              // open | handled   (NEVER auto-resolves)
  title, summary, data,
  entityRefs,          // same shape control already renders
  tourEventId, submissionId, personRefId,
  createdAt, handledAt, handledBy, handledByName
}
```

Registry-driven exactly like בקרה: a new card type is one file plus one import.
**Independently dismissible** is structural — a Tour Summary card and its Logistics card
are two rows, so handling one cannot touch the other.

### 2.5 The automation runtime (Parts 1, 8, 9, 10)

Unchanged from the agreed §13 plan: a registered automation appears in the Communication
Center trigger picker as `automation:AUT-001`; the runtime is one hook after
`submitSubmission`'s transaction commits, idempotency key `AUT-xxx:<submissionId>`.

**One extension needed for Parts 9–10:** an action kind that creates a `ReviewItem`.
That is a genuine new capability, not a workaround — but it does widen what an automation
may do beyond "send a message". Flagged as a decision (§5).

---

## 3. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **Removing the 2h stale-skip changes a live send path.** A message that used to be dropped will now actually send later. | **High** | Windows make "later" bounded and correct. Ship behind a flag; convert `skipped` → `waiting_window` only for rows whose reason is provider-outage, not operator cancellation. Do NOT retroactively resurrect historical skipped rows. |
| R2 | **A long outage plus windows could release a burst.** | **High** | `sendPace.js` already exists and is shared. Verify it paces the drain; add a per-window release cap if not. |
| R3 | **Admin Reports exhaust at 6 attempts** — a day-long outage loses internal reports permanently. | **Medium** | Add connection-deferral like the WhatsApp/email workers (defer without burning an attempt). |
| R4 | **Making manager reports editable data discards the reason they are code.** | **Medium** | See §5 Q2 — decide before building. |
| R5 | **Auto-translating existing questionnaires writes content nobody reviewed** into forms guides will read. | **Medium** | Translate into the English slot only, leave Hebrew untouched, mark `ai_draft`, and require a publish pass. Never auto-publish. |
| R6 | **`ANTHROPIC_API_KEY` is not set in Railway.** Parts 4 and 5 translation cannot run. | **Medium** | Blocker — must be set before those slices. Everything else proceeds without it. |
| R7 | **English names on `PersonRef` could be overwritten by recruitment sync.** | **Medium** | Put them on `PersonProfile` unless you confirm GOS now owns staff identity outright. |
| R8 | **Parts 8 and 12 both notify managers after one Tour Summary.** | **Low** | Pick one path (§5 Q3). |
| R9 | **`deal_tour_out_of_sync` raised/resolved 130 times in 2 days.** Possibly noisy. | **Low** | Out of scope here; worth its own look. |
| R10 | **The queue aggregates four sources with different status vocabularies.** A wrong normalisation would misreport what is actually happening. | **Medium** | Normalise in adapters only, keep the raw source status visible in the detail panel, and unit-test every mapping. |

---

## 4. Required migrations

| # | Migration | Type | Risk |
|---|---|---|---|
| M1 | `PersonProfile.firstNameEn`, `lastNameEn`, `preferredLanguage` (default `'he'`) | additive | none |
| M2 | `SendingWindowPolicy` — (audienceKind × channel) → windowId; seed from current defaults | additive | none |
| M3 | `WhatsAppScheduledMessage` / `ScheduledEmail`: `waitReason`, `effectiveAt` | additive | none |
| M4 | `AdminReportDelivery.connectionDeferredCount` (default 0) | additive | none |
| M5 | `AdminReportConfig`: channel + email recipients (`channel`, `emailAccountId`, `emailRecipients Json`) | additive | none |
| M6 | `ReviewItem` (+ indexes, unique `dedupeKey`) | new table | none |
| M7 | Retire `legacy_sync_conflict` + `legacy_tour_product_unmatched`; close the 2 stale open rows | **data** | reversible — rows are only marked resolved |
| M8 | One-time He→En translation of existing questionnaire content into the `en` slot | **data** | additive per field; Hebrew untouched; produces drafts |
| M9 | *(only if §5 Q2 answer is "editable")* manager-report body templates → DB | **data** | significant — see R4 |

---

## 5. Decisions I need before building

**Q1 — Staff English names: `PersonProfile` (management-owned, sync-safe) or `PersonRef`
(identity, may be overwritten by recruitment sync)?** I recommend `PersonProfile`.

**Q2 — Manager reports: editable or code?**
- **(a) Code + side-by-side authoring aid.** Each report declares `{ he, en }` render
  functions. The settings screen shows both languages side by side, read-only, with a
  "generate English" action I use while authoring. Keeps exact formatting control and the
  no-drift guarantee. Cheaper, and honest about who edits reports today (me).
- **(b) Editable templates.** Report bodies move to the DB with live He↔En editing and
  auto-regeneration. Matches your description literally, but discards the deliberate
  reason these are code, and adds a template language for conditional lines.
I recommend **(a)** unless you actually want to edit report wording yourself.

**Q3 — Parts 8 and 12 are two manager notifications from one Tour Summary.** Merge into
one, or keep both (payment-received and tour-overall) as separate messages?

**Q4 — May an automation create a `ReviewItem`?** Required for Parts 9–10. It widens
automations beyond "invoke a Communication Center rule" — the boundary you set last
round. I recommend yes, with `review_item` as the *only* added action kind.

---

## 6. Proposed slices

Ordered so each is independently shippable, and nothing waits on a blocked dependency.

### Group A — finish what is agreed (no new decisions needed)

| Slice | Scope | Depends on |
|---|---|---|
| **A1** | Automation trim (2a): delete out-of-scope action kinds + resolvers | — |
| **A2** | Trigger bridge (2b): automations appear in the CC trigger picker | A1 |
| **A3** | Runtime (2c): one hook, conditions by key, idempotency, run log | A2 |
| **A4** | Registry screen (2d): read-only list + detail + health | A3 |
| **A5** | Control cleanup (Part 6): retire 2 legacy types, close 2 stale rows, document the other 11 | — |

### Group B — shared infrastructure

| Slice | Scope | Depends on |
|---|---|---|
| **B1** | `sendingPolicy.js` + `SendingWindowPolicy` (M2): audience × channel resolution over the existing `windows.js` | — |
| **B2** | Windows for every sender (M3): all four workers consult B1; `skipped`-on-stale becomes `waiting_window` **(R1 — flagged)** | B1 |
| **B3** | Outage resilience (M4): connection-deferral for Admin Reports; verify pacing on drain (R2) | B2 |
| **B4** | Queue module (Part 2): the aggregation layer + two-tab screen | B2 |

### Group C — language

| Slice | Scope | Depends on |
|---|---|---|
| **C1** | Staff English names + preferred language (M1, Part 3) | Q1 |
| **C2** | Questionnaire side-by-side editing (Part 5) — UI only | — |
| **C3** | One-time questionnaire translation (M8) | C2, R6 |
| **C4** | Guides receive questionnaires in their language | C1, C2 |
| **C5** | Dual-language manager reports (Part 4) + "send in guide language" | C1, Q2, R6 |

### Group D — operational inbox and the first automations

| Slice | Scope | Depends on |
|---|---|---|
| **D1** | `ReviewItem` + Management Tasks module (M6, Part 7) | — |
| **D2** | Tour Summary review cards (Part 10) | D1 |
| **D3** | Logistics Report (Part 9) — derived, independently dismissible | D2, Q4 |
| **D4** | **AUT-001** payment-received manager notification (Part 8) | A3, A4 |
| **D5** | Manager report — email channel + recipients (M5, Part 11) | B4, Q2 |
| **D6** | Daily review-digest email (Part 11) | D5, D2, D3 |
| **D7** | WhatsApp tour-summary manager report + deep link (Part 12) | D2, Q3 |

**Suggested order:** A1–A5 → B1–B4 → D1–D2 → D4 → C1–C2 → the rest.
That front-loads the two things with real current value (a working queue view, and the
first automation) and leaves translation until `ANTHROPIC_API_KEY` is set.

---

## 7. Dependency map

```
windows.js (exists) ──► B1 sendingPolicy ──► B2 all workers ──► B3 resilience ──► B4 Queue UI
                                                                                      │
translate.js (exists, needs API key) ──► C3 questionnaire translation                 │
                                     └─► C5 report translation                        │
                                                                                      ▼
PersonProfile ──► C1 staff language ──► C4 guide questionnaires        D5 report email ──► D6 digest
                                    └─► C5 guide-language reports
automations 2a–2d (A1–A4) ──► D4 AUT-001
                          └─► D3 logistics (needs Q4)
ReviewItem (D1) ──► D2 summary cards ──► D3 logistics ──► D6 digest
                                     └─► D7 WhatsApp report + deep link
collection.js (exists) ──► D4 outstanding balance
```

**External blockers:** `ANTHROPIC_API_KEY` (C3, C5) · answers to Q1–Q4.

**Nothing in Group A or B is blocked.** Work can start there immediately on approval.
