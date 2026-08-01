# GOS Automation Registry — Architecture Proposal

**Date:** 2026-08-01
**Status:** SCOPE REDUCED 2026-08-01 by the owner (§13). Slices 0–1 shipped (`8c3678d`).
The platform-wide adoption programme in §6.1 and slices 4–5 are **WITHDRAWN** —
not deferred, not approved.
**Scope (current):** questionnaire-answer-triggered messages via the existing
Communication Center, stable key protection, and a small read-only registry with
permanent AUT ids. Nothing else.

> **Read §13 first.** Sections 6.1 and 9 below describe a larger programme that was
> explicitly rejected. They are kept only as a record of what was considered and
> declined, so the decision is not silently re-litigated later. §13 is the live plan.

---

## 0. Executive summary

The separation you asked for — *questionnaires are content, automations are logic* —
is already **structurally true** in the codebase and nobody has been using it.

Three facts from the audit:

1. **Stable keys already exist.** `QuestionnaireQuestion.key` is `q_<8 hex>`,
   auto-generated at creation, never user-editable, and **preserved verbatim across
   version clones** (`structure.js: newKey()` + `cloneStructureForNewVersion`). Option
   values are `o_<8 hex>` with the same property. Question text, answer text and
   ordering are already free to change without touching identity. We do not need to
   invent a "Question Automation Key" — we need to **surface** and **protect** the one
   that exists.

2. **The registry pattern you want is already proven in this repo.**
   `server/src/adminReports/registry.js` is a code-defined catalog with stable
   never-reused numbers, one renderer shared by production/preview/test, DB config
   keyed by number, and a delivery row per outcome. Admin Reports is a working
   prototype of the Automation Registry, at 1/10 scale. The new module should be that
   pattern, generalised — not a new invention.

3. **There is exactly ONE questionnaire-triggered automation in production today**
   (coordination on-time vs late → Admin Report #4/#5), plus two questionnaire-triggered
   *state transitions* (tour completion, timeline history). Everything else labelled
   "automation-like" belongs to four other subsystems. The registry's job is to make
   all of them visible from one screen without stealing ownership from any of them.

The single biggest risk is **not** building the registry. It is that a question key an
automation depends on can be destroyed by a normal builder action (delete a question,
add it back) and nothing today would notice. **Slice 0 fixes that and is worth shipping
even if the rest is deferred.**

---

## 1. Audit — what exists today

### 1.1 The questionnaire engine (`server/src/questionnaires/`)

| Concern | Where | Verdict |
|---|---|---|
| Template identity | `QuestionnaireTemplate.key` — unique slug, e.g. `tour_coordination` | Stable, safe to reference |
| Question identity | `QuestionnaireQuestion.key` = `q_<hex>`, `@@unique([versionId, key])`, cloned across versions | **Stable within a template**, safe to reference |
| Option identity | `QuestionnaireQuestionOption.value` = `o_<hex>`, `@@unique([questionId, value])` | Stable, safe to reference |
| Text / order | `label` (Json localized), `sortOrder` | Free to change — never identity |
| Version immutability | Published versions are structurally frozen; editing auto-creates the next draft | Strong foundation |
| Answer freezing | Per-answer `questionSnapshot` + `sortOrder` frozen at submit | History never rewrites |
| Publish gate | `publishRules.js` returns structured `{code, questionKey}` errors the builder renders inline | **The correct place for an automation-key guard** |

**Where a submission becomes an event.** `service.js: submitSubmission()` — inside the
transaction it flips status, writes frozen answers, then calls
`adapter.onSubmitted(subjectId, frozen, tx, { firstSubmit, changes })`. Two adapters
implement it:

- `adapters/booking.js` → deal + tour timeline entries, then (first submit,
  purpose `coordination` only) fire-and-forget `reportCoordinationSubmission()`.
- `adapters/tourEvent.js` → tour timeline entry, then (first submit, purpose
  `tour_summary`) `summaryCompletionState()` → possibly `completeTour()` in the same tx.

**This is the exact seam the automation runtime plugs into.** No engine surgery needed.

### 1.2 The four existing decision subsystems

| Subsystem | Rules live in | Config | Execution record | Operator screen |
|---|---|---|---|---|
| **Communication Center** | DB (`CommunicationEvent` + messages), operator-editable | DB | `CommunicationDelivery` | נוסחים למייל + WhatsApp |
| **Admin Reports** | CODE (`adminReports/registry.js`, `REPORTS[]` with stable `number`) | `AdminReportConfig` by number | `AdminReportDelivery` (incl. `skipped` rows) | דיווחי מנהלים |
| **בקרה / Control** | CODE (`control/detectors/*.js` + `registry.js`) | none | `OperationalIssue` lifecycle | בקרה |
| **Questionnaire adapters** | CODE (`questionnaires/adapters/*.js`) | none | timeline entries only | *(none — invisible)* |

The first three are each already a small automation registry with its own conventions.
The fourth is invisible: a questionnaire-triggered decision leaves no run record and
appears on no screen. That is the gap.

### 1.3 Every background loop (17 workers, `server/src/index.js`)

`adminReports` · `communication/deliveryWorker` · `ingress` · `mirror` ·
`whatsapp/scheduledWorker` · `whatsapp/activitySweep` · `email/syncWorker` ·
`email/scheduledWorker` · `tours/gallery/cleanupWorker` · `tours/calendar/syncWorker` ·
`tours/completionWorker` · `tours/woo/syncWorker` · `tours/generationWorker` ·
`tours/heldExpiryWorker` · `reservations/worker` · `control/sweepWorker` ·
`realtime/sse` heartbeat.

Classified in §6.

### 1.4 Conventions the registry must inherit (they are already proven here)

- **Fire-and-forget after commit.** `fireCommunicationTrigger` uses `setImmediate` and
  can never fail or slow a business operation. Automations must behave identically.
- **Idempotency by unique key.** Communication: `(messageId, triggerKey, recipientKey)`.
  Admin Reports: `idempotencyKey` unique. Replays hit P2002 and are dropped.
- **Honest skips.** A misconfigured Admin Report writes a `skipped` delivery row with a
  Hebrew reason instead of vanishing. Automations must do the same.
- **Retry lives with the transport**, not with the decision.
- **Never claim done unless verified** (CLAUDE.md §10) — hence a real run ledger,
  not a "last run" column that someone remembers to update.

---

## 2. The canonical AutomationDefinition architecture

### 2.1 The definition of an automation (the line we draw)

> An **automation** is a rule that, in response to a business event or a schedule,
> decides autonomously whether to change business state or emit an outbound artifact —
> without a human pressing a button for that specific instance.

This deliberately **excludes**:
- transports that execute a decision already made (delivery workers, scheduled senders);
- reconcilers that mirror state without deciding (calendar sync, Woo sync, legacy mirror);
- derived-field writers (`touchDealActivity`, seat recompute).

Those are **infrastructure**. Registering them would inflate the registry with rows
nobody can act on, and dilute what "AUT-014" means.

### 2.2 Module layout

```
server/src/automations/
  registry.js              register() · byId() · list() · uniqueness + retired-ledger guards
  ledger.js                ALLOCATED = ['AUT-001', …]  RETIRED = {…}  ← append-only, never edited
  definitions/
    index.js               one import line per automation (the ONLY wiring)
    AUT-001.coordination-on-time.js
    AUT-002.coordination-late.js
    …
  runtime.js               runAutomation(def, event) → resolve ctx · conditions · actions · record
  events.js                emitAutomationEvent(event)  ← the ONE intake, fire-and-forget
  conditions.js            answer/context condition evaluator (reuses shared/questionnaire/conditions.mjs)
  actions/
    index.js               ACTION_KINDS registry
    createTask.js  raiseIssue.js  timelineNote.js  fireCommunication.js
    fireAdminReport.js  setField.js  assignOwner.js
  sources/
    questionnaire.js       submit → automation event (hooked from the adapters)
    schedule.js            daily/interval automations riding the existing 60s tick
  projections/
    communicationCenter.js  adminReports.js  controlDetectors.js   ← live read-only providers
```

### 2.3 The definition module — the single artifact

Every automation is one file that the **runtime executes** and the **registry reads**.
There is no second description anywhere.

```js
// server/src/automations/definitions/AUT-001.coordination-on-time.js
export default {
  id: 'AUT-001',                       // permanent. Never changes, never reused.
  slug: 'coordination_on_time',        // stable machine handle for logs
  nameHe: 'שיחת תיאום בוצעה בזמן',      // display only — safe to rename
  category: 'tours',
  descriptionHe:
    'כשטופס שיחת התיאום מוגש בפעם הראשונה עד יומיים לפני מועד הסיור — נשלח דיווח מנהלים #4.',
  defaultEnabled: true,

  trigger: {
    kind: 'questionnaire_submitted',
    templateKey: 'tour_coordination',   // stable template slug
    purpose: 'coordination',
    firstSubmitOnly: true,
  },

  // Answer-level conditions reference STABLE KEYS ONLY. Never labels.
  when: null,                           // e.g. { q: 'q_9f3a12bd', op: 'equals', value: 'o_7c21ab90' }

  // Execution conditions — business state, evaluated against the loaded context.
  guards: [
    { code: 'tour_is_live',  hintHe: 'הסיור אינו מבוטל' },
    { code: 'deadline_known', hintHe: 'לסיור יש מועד, כך שניתן לחשב את המועד הנדרש' },
  ],

  // Ordered actions. Each is a GENERIC capability from actions/, never bespoke code.
  actions: [
    { kind: 'admin_report', number: 4, buildData: (ctx) => ({ coordinationReport: … }) },
  ],

  // Business identity of the event — a replay can never act twice.
  idempotency: (ev) => `AUT-001:${ev.submissionId}`,

  // STRUCTURED, RESOLVABLE dependencies — not prose. Each one is checked live
  // against the owning subsystem and drives the automation's health status (§7.4).
  // `hard` ⇒ the automation CANNOT run (Broken); `soft` ⇒ it cannot run YET
  // (Waiting for dependency).
  dependsOn: [
    { kind: 'questionnaire_template', templateKey: 'tour_coordination', severity: 'hard' },
    { kind: 'admin_report',           number: 4,                        severity: 'soft' },
  ],

  notesHe: 'החלטת בזמן/באיחור נגזרת מהחותמות בפועל מול המועד הקנוני — לא מתווית סטטוס.',
};
```

**Rules enforced by a guard test, not by discipline:**

- `id` matches `/^AUT-\d{3,}$/`, is present in `ledger.js: ALLOCATED`, and is unique.
- No id is ever removed from `ALLOCATED`. Deleting a definition requires moving it to
  `RETIRED` with a date and reason — the registry then renders it as `הוסרה`.
- `when` / condition leaves reference `q_*` / `o_*` keys only; a literal Hebrew string
  in a condition value fails the test.
- Every `actions[].kind` exists in the action registry.
- `trigger.templateKey` resolves to a real `QuestionnaireTemplate.key` at boot
  (warning, not crash — a template can be created after the definition).

### 2.4 What automations may NOT do

**Automations decide; they do not compose customer-facing messages.**

Outbound text stays where it already lives and is already reviewable:
- customer-facing → `fire_communication` action → Communication Center (operator-owned
  templates, sending windows, frozen versions);
- internal → `admin_report` action → the code catalog;
- anything else → `create_task` so a human acts.

This preserves the existing SSOT, respects the *no auto email send* rule (GOS-composed
email to a customer is never sent without operator review), and keeps the automation
module from becoming a second messaging system.

---

## 3. Data model

Three new tables. **No automation logic is stored in the DB** — only operator config,
execution facts, and change history.

```prisma
// Operator-owned state for a code-defined automation. Absent row = definition default.
model AutomationState {
  autId         String   @id            // 'AUT-014'
  enabled       Boolean?                // null = follow defaultEnabled
  updatedBy     String?
  updatedByName String?
  updatedAt     DateTime @updatedAt
  createdAt     DateTime @default(now())
}

// One row per execution ATTEMPT. This is the sole source of last-run / count / errors.
model AutomationRun {
  id             String   @id @default(cuid())
  autId          String
  // Business identity of the event — replay-proof. Unique ⇒ P2002 = already handled.
  idempotencyKey String   @unique
  // ran | skipped | failed
  status         String
  // Hebrew reason for skipped/failed — shown verbatim in the registry.
  reasonHe       String?
  // Which guard/condition stopped it (registry shows "why nothing happened").
  stoppedAt      String?
  // Frozen trigger input (submissionId, answer values that mattered, subject refs).
  input          Json?
  // What each action actually did: [{ kind, ok, ref, error }]
  actionResults  Json?
  dealId         String?
  tourEventId    String?
  submissionId   String?
  durationMs     Int?
  startedAt      DateTime @default(now())
  finishedAt     DateTime?

  @@index([autId, startedAt])
  @@index([autId, status, startedAt])
}

// Change history — enable/disable + automatic definition-drift detection.
model AutomationChange {
  id         String   @id @default(cuid())
  autId      String
  // enabled | disabled | definition_changed | registered | retired
  kind       String
  summaryHe  String
  fromHash   String?
  toHash     String?
  actorId    String?
  actorName  String?
  createdAt  DateTime @default(now())

  @@index([autId, createdAt])
}
```

**Definition-drift detection (this is what makes "Updated date" and "Change history"
truthful).** At boot, `registry.js` hashes each definition's declared shape (id, trigger,
when, guards, action kinds, dependsOn — *not* the prose). If the hash differs from the
last `AutomationChange.toHash`, it writes a `definition_changed` row automatically. Nobody
maintains a changelog by hand, and nobody can change behaviour silently.

**One questionnaire-side column only:**

```prisma
model QuestionnaireQuestion {
  // …
  // MANUAL business flag — "משמשת באוטומציות". The author's DECISION that this
  // question is an automation extension point. Deliberately NOT derived from the
  // registry: a question may be flagged before any automation exists, and that
  // intent is itself the business fact worth recording. Checking it creates
  // nothing. Carried verbatim by cloneStructureForNewVersion.
  automationFlag Boolean @default(false)
}
```

Live *usage* (which automations actually reference this key) is a **separate, derived**
read — never stored, never a checkbox. See §5.3.

---

## 4. How permanent AUT IDs are assigned

**Assigned in code, in an append-only ledger.** Not a DB sequence.

Reasons: the id must exist in the same artifact the runtime executes; it must survive a
database reset; and `grep AUT-014` must land you on the file. This is exactly how Admin
Report `number` already works, and it has held up.

```js
// server/src/automations/ledger.js — APPEND ONLY. Never edit or remove an entry.
export const ALLOCATED = ['AUT-001', 'AUT-002', 'AUT-003'];

export const RETIRED = {
  // 'AUT-002': { retiredOn: '2026-09-01', reasonHe: 'הוחלפה על ידי AUT-019' },
};
```

Allocation procedure — *"Create AUT-037"*:
1. next free number in `ALLOCATED` (sequential, **no reserved ranges** — ranges rot;
   grouping is the `category` field);
2. append the id to `ALLOCATED`;
3. create `definitions/AUT-037.<slug>.js`;
4. add one import line to `definitions/index.js`.

Retirement — *"Remove AUT-014"*:
1. delete the definition file + its import;
2. move the id into `RETIRED` with date + Hebrew reason.
The registry keeps showing it as `הוסרה` with its full run history. **The id is never
reused.** Guard test asserts `ALLOCATED` is append-only against git history.

**Guaranteed stable across:** question wording, answer wording, implementation rewrite,
`nameHe` rename, disable, retirement. The only thing that changes an id is nothing.

---

## 5. Question Keys and Option Keys — management + protection

### 5.1 Use the keys that already exist

Canonical reference form:

```
tour_coordination#q_9f3a12bd            ← question
tour_coordination#q_9f3a12bd:o_7c21ab90 ← option
```

`templateKey` + `questionKey` is globally stable and already survives every legal
builder action *except one* (below). No new column, no migration to mint keys.

### 5.2 The real hazard — and the fix that matters most

`newKey()` is random per creation. Therefore:

| Builder action | Key survives? |
|---|---|
| Edit question text / help / placeholder | ✅ |
| Reorder questions or sections | ✅ |
| Move question to another section | ✅ |
| Change question type | ✅ |
| Rename / reword an option | ✅ |
| Publish a new version | ✅ (cloned verbatim) |
| **Delete a question and re-add it** | ❌ **new key — automation silently stops matching** |
| **Delete an option and re-add it** | ❌ **new value — condition silently stops matching** |
| Recreate the question in a different template | ❌ different template scope |

Today nothing detects this. The automation would simply never fire again, with no error
anywhere. **This is the single most important thing to fix**, and it is independent of
the registry UI:

1. **Publish-time guard** in `publishRules.js` (it already returns structured
   `{code, questionKey}` errors the builder renders inline). New error codes:
   - `automation_question_removed` — the draft drops a key referenced by a
     **non-retired** automation. Blocks publish; names the AUT ids.
   - `automation_option_removed` — same, for an option value used in a `when` condition.
   - `automation_flagged_question_removed` — the draft drops a key the author flagged
     **משמשת באוטומציות**. Warning-level (acknowledgeable), because no automation
     depends on it yet — but the reservation was a deliberate decision, so it cannot
     disappear silently.
2. **Delete-time warning** in the builder — deleting a referenced question shows
   *"שאלה זו משמשת באוטומציות AUT-004, AUT-011. מחיקה תמנע מהן לפעול."* before the
   destructive action, not after.

### 5.3 The builder checkbox — a manual business flag, and a separate dependency panel

**Owner decision (§12.1): the checkbox is MANUAL and stays manual.** These are two
different facts and the UI keeps them visibly separate:

| | Type | Question it answers |
|---|---|---|
| **משמשת באוטומציות** (checkbox) | **manual**, stored as `automationFlag` | *"Is this question intended as an automation extension point?"* — a **business decision** by the form author. May be true before any automation exists. |
| **אוטומציות המשתמשות בשאלה** (panel) | **derived**, read live from the registry | *"Which automations reference this key right now?"* — a **runtime fact**. |

The flag is intent; the panel is reality. Neither is derived from the other, so neither
can be "wrong" — they simply answer different questions. The two are shown adjacent, and
where they diverge the builder says so plainly rather than silently reconciling them:

```
☑ משמשת באוטומציות                                    ← manual business decision

🔑 מפתח קבוע:  tour_coordination#q_9f3a12bd              [העתק]

   אוטומציות המשתמשות בשאלה כרגע                        ← derived, live
     AUT-004 · שיחת תיאום בוצעה בזמן            פעילה    [פתח ↗]
     AUT-011 · פתיחת משימת מעקב                מושבתת   [פתח ↗]

   ⚠ מחיקת השאלה או שינוי מזהה השאלה ישברו את האוטומציות האלה.
```

Divergence notices (informational — never auto-corrective):
- flag **on**, no automations → `שאלה מסומנת כנקודת הרחבה לאוטומציות; טרם נבנתה אוטומציה.`
- flag **off**, automations reference it → `⚠ קיימות אוטומציות התלויות בשאלה זו למרות שאינה מסומנת.`

Options in an option-type question each show their `o_*` value plus the automations
referencing that specific option.

**Protection follows the union of both**, so neither signal can be lost:
- a key **referenced by a non-retired automation** → publish is **blocked** if dropped;
- a key **flagged `automationFlag`** with no automation yet → publish is **warned**
  (acknowledgeable) if dropped, so a reserved extension point cannot vanish unnoticed.

---

## 6. Which existing behaviours become registered automations

Three verdicts: **NATIVE** (becomes an AutomationDefinition, adopted from existing code),
**PROJECTED** (stays owned by its subsystem; the registry shows it live via a read-only
provider), **INFRASTRUCTURE** (not an automation — stays out).

### 6.1 NATIVE — adopt as AutomationDefinitions  ⛔ WITHDRAWN 2026-08-01

> **This table is not a plan.** The owner declined to migrate existing coordination
> reports, tour completion, payroll hooks or background workers into a new engine.
> Those behaviours stay exactly where they are, owned by their current modules.
> The list survives only so the decision is on record. Adopting any row requires a
> new, explicit approval.

| Proposed | Behaviour | Today | Why native |
|---|---|---|---|
| AUT-001 | Coordination submitted **on time** → Admin Report #4 | `booking.js onSubmitted` → `coordinationEvent.js` | The one existing questionnaire-triggered automation. Perfect first adoption. |
| AUT-002 | Coordination submitted **late** → Admin Report #5 | same | Same rule, different branch — two ids because you will want to disable them independently. |
| AUT-003 | Last required guide summary submitted → **tour completes** | `tourEvent.js onSubmitted` → `completeTour` | Questionnaire-triggered state change; today invisible with no run record. |
| AUT-004 | Midnight after tour date → **tour completes** | `tours/completionWorker` → `sweepOverdueTours` | Scheduled decision, changes business state. |
| AUT-005 | Tour completed → **payroll entries ensured** | `completion.js` → `ensureTourPayroll` | Event-driven state change. Money — deserves a run ledger. |
| AUT-006 | Tour reopened/cancelled → **payroll cancelled** | `completion.js` → `cancelTourPayroll` | Counterpart of AUT-005. |
| AUT-007 | Held registration past `expiresAt` → **expired, capacity released** | `heldExpiryWorker` | Scheduled decision, changes seat truth. |
| AUT-008 | Open-tour horizon → **occurrences generated** | `generationWorker` → `ensureOpenTourSlots` | Autonomous creation of business objects. |
| AUT-009 | Deal → WON → fire `deal_won` + `tour_datetime` triggers | `deals.js`, `paymentWon.js` | Decision (which triggers fire) distinct from the transport. |
| AUT-010 | Verified payment document → Admin Report #1 + `payment_received` | `paymentCompleted.js` | Fan-out decision from one external event. |
| AUT-011 | Quote document produced → Admin Report #2 | `quoteDocuments.js` | |
| AUT-012 | Quote signed → Admin Report #9 | `quoteSignedEvent.js` | |
| AUT-013 | Tour date/time actually changed → Admin Report #3 + trigger | `tours.js`, `deals.js` | Already has "actually changed" logic worth documenting. |
| AUT-014 | Agent reservation processed → Admin Report #10 + `reservation_submitted` | `reservations/processor.js` | |
| AUT-015 | Daily 15:00 → coordination-tracking report #6 | `adminReports/daily.js` | Scheduled aggregate. |
| AUT-016 | Daily 06:00 → missing-summaries reports #7/#8 | `adminReports/daily.js` + `tourSweeps.js` | |

Adoption is **wrapping, not rewriting**: the definition declares the trigger + guards +
action, and the action calls the *existing* function. Behaviour must be byte-identical;
the gain is an id, a run ledger, an on/off switch and a registry row.

### 6.2 PROJECTED — visible in the registry, owned elsewhere

| Subsystem | Registry entry | How rows appear |
|---|---|---|
| **Communication Center** | `AUT-P01` platform row | Provider reads live `CommunicationEvent` + messages; each active event lists as a child rule with its real delivery stats and a link to its editor. |
| **Admin Reports catalog** | `AUT-P02` | Provider reads `REPORTS[]` + `AdminReportConfig` + delivery stats. Reports fired *by* a native automation cross-link to it. |
| **בקרה detectors** | `AUT-P03` | Provider reads the detector registry + open `OperationalIssue` counts. |

Why not mint an AUT id per Communication Center event: those are **operator-created data**
with their own full editing screen. Minting code ids for DB rows would either require a
migration on every operator action or produce ids that change — breaking the one promise
the id makes. Projection gives complete visibility ("if it runs in production it appears
in the registry") with **zero duplication and zero drift**, because the provider reads
the same rows the runtime reads.

**Honest limitation:** you will say *"modify AUT-014"* for native automations, but for a
Communication Center rule you will still say *"change message #7"* — because that is what
that module already calls it, and it is editable by you without a developer. I think that
is correct, but flagging it as a deliberate trade-off, not an oversight.

### 6.3 INFRASTRUCTURE — deliberately NOT registered

| Component | Why not |
|---|---|
| `communication/deliveryWorker`, `whatsapp/scheduledWorker`, `email/scheduledWorker`, `adminReports/worker` | Transports. They execute decisions already made and recorded elsewhere. |
| `tours/calendar/syncWorker`, `tours/woo/syncWorker` | Reconcilers — mirror GOS state outward, decide nothing. |
| `mirror/worker`, `ingress/worker` | Integration plumbing with their own audit models. |
| `email/syncWorker`, `whatsapp/activitySweep`, `tours/gallery/cleanupWorker` | Ingest / housekeeping. |
| `touchDealActivity`, seat/collection recompute | Derived-field writers, not decisions. |
| `reservations/worker` | Retry safety net for `processor` (which *is* AUT-014). |

If a component's answer to *"what did it decide?"* is *"nothing — it carried out a
decision"*, it stays out.

---

## 7. Runtime + Registry: one source of truth

### 7.1 Execution path

```
business event (questionnaire submit / worker tick / domain change)
        │  fire-and-forget, AFTER the owning transaction commits
        ▼
emitAutomationEvent({ kind, templateKey, purpose, submissionId, subjectRefs, answers })
        ▼
registry.list()  →  definitions whose trigger matches
        ▼   per definition, isolated (one failure never affects another)
runtime.runAutomation(def, event)
   1. resolvedEnabled = AutomationState.enabled ?? def.defaultEnabled   → not enabled ⇒ no run row
   2. AutomationRun.create({ idempotencyKey: def.idempotency(event) })  → P2002 ⇒ stop, already handled
   3. load context (the SAME loadTriggerContext the Communication Center uses)
   4. evaluate def.when against FROZEN answers, by key      → no match ⇒ status 'skipped'
   5. evaluate def.guards                                    → fail ⇒ 'skipped' + stoppedAt + reasonHe
   6. run def.actions in order via the action registry       → collect actionResults
   7. finalise the run row: status, durationMs, finishedAt
```

Every branch writes a row **except** "disabled" and "no definition matched" — matching
the proven Communication Center rule (inapplicable events must not flood the ledger,
but a *matched-then-stopped* automation must be explainable).

### 7.2 Why there cannot be two sources of truth

| Registry field | Comes from |
|---|---|
| ID, Name, Description, Trigger, Questionnaire, Question key, Answer conditions, Execution conditions, Actions, Dependencies, Idempotency rule, Notes | **The definition module the runtime executes.** Read via `import`, never transcribed. |
| Status | `def.defaultEnabled` ⊕ `AutomationState.enabled` — the same expression `runtime.js` evaluates |
| Last execution / Last success / Last failure / Total runs / Error indicator | `AutomationRun` aggregates — written by the runtime itself |
| Tasks created · Notifications created · Integrations | Derived from `def.actions[].kind` + real `actionResults` refs |
| **Runtime status** (Active / Disabled / Waiting / Broken / Error / Retired) | Computed live by `resolveHealth(def)` — §7.4. No stored status column exists. |
| **Communication rules invoked** | Resolved live from `CommunicationEvent` by trigger type — §7.5 |
| Retry behaviour | Declared by the **action kind**, not per automation (see below) |
| Created / Updated / Change history | `AutomationChange` — including auto-detected definition drift |

**Structural enforcement:** the registry API has no writable field that describes
behaviour. There is nowhere to put a stale description. A guard test asserts every
`ALLOCATED` id resolves to a loaded definition or a `RETIRED` entry — so "exists in
production ⇒ appears in the registry" is a test, not a promise.

### 7.4 Live operational health — the registry as a control center

**Owner requirement (§12.2): the registry is an operational dashboard, not a catalog.**
An automation that *cannot* run must say so on the list screen, before anyone asks why
nothing happened.

Every automation resolves to exactly ONE primary status, computed live on every read:

| Status | Meaning | Source |
|---|---|---|
| `retired` · **הוסרה** | id moved to `RETIRED`; history preserved | `ledger.js` |
| `disabled` · **מושבתת** | `AutomationState.enabled === false`, or `defaultEnabled: false` and never enabled | DB ⊕ definition |
| `broken` · **שבורה** | a **hard** dependency is missing — it can never run as configured | dependency resolvers |
| `waiting_dependency` · **ממתינה לתלות** | a **soft** dependency is not satisfied yet — it will run once it is | dependency resolvers |
| `error` · **שגיאה** | enabled + dependencies fine, but failed runs in the last 7 days | `AutomationRun` |
| `active` · **פעילה** | enabled, dependencies satisfied, no recent failures | — |

Precedence: `retired > disabled > broken > waiting_dependency > error > active`. A
disabled automation that is *also* broken shows **מושבתת** as its primary status with a
**שבורה** chip beside it — the operator turned it off deliberately, but the breakage is
never hidden.

**Dependency resolvers** — one per `dependsOn.kind`, each reading the owning subsystem
live (never a cached copy):

| kind | Checks | hard/soft |
|---|---|---|
| `questionnaire_template` | template exists, `status = active`, has a published version | hard / soft |
| `questionnaire_question` | `q_*` key present in the template's **current published version** | hard |
| `questionnaire_option` | `o_*` value present on that question | hard |
| `communication_trigger` | ≥1 `CommunicationEvent` active on the trigger with ≥1 active published message | soft |
| `admin_report` | report number exists in the catalog; `AdminReportConfig` enabled with a destination | hard / soft |
| `task_type` | `TaskType` row exists and is active | hard |
| `control_issue_type` | type registered in the בקרה registry | hard |
| `env` | environment variable present | soft |

Each returns `{ ok, severity, labelHe, detailHe, link }`. `detailHe` is what the registry
shows verbatim — e.g. *"שאלה q_9f3a12bd אינה קיימת בגרסה המפורסמת של השאלון"* — so the
answer to *"why isn't this running?"* is on the screen, with a link straight to the thing
that needs fixing.

**A `broken` automation still evaluates its trigger** and records a `skipped` run with
`stoppedAt: 'dependency'` — so the ledger proves it *would* have fired and shows exactly
how many times the breakage cost something. Silence is never the failure mode.

**Health is a projection, not stored state.** There is no `status` column to go stale;
`resolveHealth(def)` is called on read and by the בקרה detector (below). Recomputing it is
cheap and it can never drift.

**Escalation into בקרה.** One new detector (`control/detectors/automations.js`) raises an
`OperationalIssue` for any automation that is `broken`, or `error` with ≥3 failures in 24h
— reusing the module that already exists for "a human must look at this" instead of
building a second alerting path. Fixing the dependency auto-resolves the issue on the next
60s sweep.

### 7.5 The execution chain — full visibility without leaving the screen

**Owner requirement (§12.3).** The detail screen renders the ordered action list with
every downstream artifact resolved **live** from its owning module:

```
פעולות (לפי הסדר)
  1. ✓  יצירת משימה            סוג: "מעקב אחרי שיחת תיאום"           [סוגי משימות ↗]
  2. ✓  כלל תקשורת  #7          "תזכורת ללקוח לפני סיור" · WhatsApp · פעיל   [מרכז התקשורת ↗]
  3. ✓  דיווח מנהלים  #4        "שיחת תיאום בוצעה בזמן" · יעד: קבוצת תפעול   [דיווחי מנהלים ↗]
  4. ⚠  פתיחת תקלה בבקרה        סוג: coordination_missing                    [בקרה ↗]
```

The `fire_communication` action declares only a **trigger type**. At read time the
projection resolves which `CommunicationEvent`s are active on that trigger and lists their
messages by their real `#N` public numbers, with live status. This is the same data the
Communication Center screen renders — read, not copied — so the chain can never show a
message that was deleted or a rule that was disabled.

The Communication Center remains the sole owner of outbound content. The registry shows
**which** rules an automation invokes; it never shows or edits **what** they say.

### 7.6 Retry — deliberately not a new engine

The runner does **not** retry. A failed *decision* is a bug or a data problem, and
retrying it silently hides both. Instead:

- **Actions** delegate to subsystems that already retry correctly
  (`CommunicationDelivery`, `AdminReportDelivery`, `WhatsAppScheduledMessage` — each with
  its own proven backoff). The registry shows each action kind's retry behaviour, sourced
  from the action module.
- A `failed` run is surfaced with its error and, for `severity: 'high'` definitions,
  raises an `OperationalIssue` into **בקרה** — reusing the module that already exists for
  "a human must look at this", instead of building a second alerting path.
- Replay is manual and explicit from the detail screen (re-runs with the same
  idempotency key ⇒ safe by construction).

---

## 8. Registry UI

**Location:** `הגדרות → אוטומציות` (`/admin/settings/automations`), one
`SETTINGS_TREE` entry + one `ModuleCard` on Settings home. Reuses the existing shared
table infra (`tableColumns` with chooser + drag + persistence), the standard searchable
selector, and the existing detail-page chrome — no new component language.

**List** — wide layout, searchable, filter chips by status / category / trigger source:

| ID | שם | סטטוס | מקור הפעלה | שאלון | פעולה ראשית | הפעלה אחרונה | הרצות | שגיאות | עודכן |
|---|---|---|---|---|---|---|---|---|---|

Status is the live health value from §7.4 — **פעילה · מושבתת · ממתינה לתלות · שבורה ·
שגיאה · הוסרה** — not a stored column. Broken and error rows sort to the top by default
and carry the one-line Hebrew reason inline, so the screen answers *"is anything wrong
right now?"* without a single click. A **"בעיות בלבד"** filter chip narrows to exactly
the automations that need attention.

**Detail** — read-only, every field sourced per §7.2. Layout:

1. **Header** — AUT id (copyable), name, live status badge + reason.
2. **תלויות** — every `dependsOn` with its live check result and a deep link to whatever
   needs fixing (§7.4).
3. **הפעלה** — trigger, questionnaire, question key, answer conditions, execution guards.
4. **שרשרת הפעולות** — the ordered chain with live-resolved communication rules, admin
   reports, task types and issue types (§7.5).
5. **אמינות** — idempotency rule, retry behaviour per action kind, dependencies.
6. **היסטוריה** — the last 50 runs with frozen input, per-action results and the Hebrew
   skip/failure reason, plus the `AutomationChange` log.

Three operator actions only: **Enable/Disable**, **Re-run** (idempotent), **Copy AUT id**.
No definition field is editable from the UI — that is what keeps §7.2 true.

---

## 9. Implementation slices  ⚠ SUPERSEDED BY §13

> Slices 0–1 shipped as written. Slices 2 and 3 are **replaced** by the smaller
> §13 plan; slices 4–5 are **withdrawn**. Kept for the record only.

| Slice | Scope | Deploy risk |
|---|---|---|
| **0 — Key protection** *(first, valuable alone)* | Surface `templateKey#questionKey` + option keys in the builder with a copy button; manual **משמשת באוטומציות** checkbox (`automationFlag`) + carry through version clone; derived dependency panel; publish-time + delete-time guards in `publishRules.js` (registry empty initially). **No automations yet.** | Low — additive column, new publish error codes |
| **1 — Registry core** | `automations/` module, `ledger.js`, `registry.js`, dependency resolvers + `resolveHealth`, boot validation + definition hashing, three Prisma models, guard tests. No runtime, no UI. | Low — nothing executes |
| **2 — Runtime + first adoptions** | `runtime.js`, `events.js`, action library v1 (`admin_report`, `timeline_note`, `state_change`), questionnaire source hook, **AUT-001…AUT-003 adopted** with byte-identical behaviour + a parity test proving the old and new paths agree. | Medium — touches live coordination reporting; gated behind `AUTOMATIONS_ENABLED` until verified in production |
| **3 — Registry UI** | List + detail + live health + dependency panel + execution chain + run history + enable/disable + re-run. Builder panel switches from "empty registry" to real AUT links. | Low |
| **4 — Full adoption** | AUT-004…AUT-016 adopted, one at a time, each with a parity test. | Medium, incremental |
| **5 — Projections + escalation** | `AUT-P01/P02/P03` live providers for Communication Center, Admin Reports, בקרה; `control/detectors/automations.js` escalates broken/erroring automations. Registry becomes complete. | Low — read-only |
| **6 — New capabilities** | Action library v2 (`create_task`, `raise_issue`, `fire_communication`, `set_field`, `assign_owner`) + **the first genuinely new questionnaire automation you specify**. | Per automation |

Slices 0–5 build the foundation and register what already exists. **Slice 6 is the first
time new business logic is written** — which matches your instruction not to implement
questionnaire business automations yet.

---

## 10. Remaining implementation decisions

1. **`AutomationRun` retention** — proposal: keep every `failed` row forever, prune
   `ran`/`skipped` older than 180 days. To be fixed in Slice 1.
2. **Adoption order within Slice 4** — proposal: money-touching automations
   (AUT-005/006 payroll) last, after the pattern has run in production for a week.

---

## 11. Risks stated plainly

- **Adoption is behaviour-preserving surgery on live paths.** Coordination reporting,
  tour completion and payroll all run through the code being wrapped. Every adoption
  needs a parity test and an env gate; adopting them in one commit would be reckless.
- **Question keys are only as stable as the guard.** Until Slice 0 ships, a question
  delete + re-add silently breaks any automation built on it, with no error anywhere.
- **`AutomationRun` grows unbounded.** ~16 automations × real volume. Needs a retention
  policy (proposal: keep all `failed` forever, prune `ran`/`skipped` older than 180 days)
  decided in Slice 1, not discovered later.
- **The registry can only be complete if projections land.** Between Slice 2 and Slice 5,
  "everything appears in the registry" is *not* true. The UI must say so explicitly
  rather than imply completeness.
- **Health is computed on read.** Cheap today (~16 automations, a handful of indexed
  lookups each). If the list screen ever gets slow, the fix is a short-lived request-scoped
  cache — never a stored status column, which would reintroduce exactly the drift this
  architecture exists to prevent.

---

## 12. Owner amendments — 2026-08-01

Recorded verbatim in effect; the sections above are already updated.

1. **"משמשת באוטומציות" stays a MANUAL business flag** (§3, §5.3). It records the
   author's decision that a question is an automation extension point — which is not the
   same fact as "an automation currently references it", and may legitimately be true
   before any automation exists. Live usage, delete/change warnings and dependency
   information are shown **separately** and derived from the registry.
2. **The registry is the operational control center, not documentation** (§7.4). Every
   automation exposes a live runtime status — **Active / Disabled / Waiting for
   dependency / Broken / Error / Retired** — and anything blocking execution (missing
   question, unpublished questionnaire, missing communication rule, unconfigured report)
   is visible from the list screen with the specific reason and a link to the fix.
3. **Communication Center integration is explicit** (§7.5). Automations never compose
   customer-facing content — the Communication Center remains the sole owner — but the
   registry shows exactly which communication rules an automation invokes, by their real
   `#N` numbers with live status, as part of the ordered execution chain. Full visibility
   of the chain without opening other modules.
4. **No new key layer** (§5.1). The existing `QuestionnaireQuestion.key` and
   `QuestionnaireQuestionOption.value` satisfy the identity requirements and are reused
   as-is.
5. **Registry generated from the canonical runtime definitions** (§7.2). No second
   documentation layer that can drift from the executing implementation.

**Approved for implementation by slice.**

---

## 13. Scope reduction — 2026-08-01 (THE LIVE PLAN)

The architecture above was correct but the *programme* around it was not. It grew
into a platform-wide automation runtime and a migration of existing behaviour, which
is not what was asked for. That is withdrawn.

### 13.1 The actual requirement

Certain questions in **שיחת תיאום** and **סיכום סיור** should trigger a specific
email or WhatsApp message. That is the whole thing.

- The trigger uses the stable `Question.key` / `Option.key`, never visible text.
- Renaming, rewording or reordering a question must never break an automation.
- The outbound message stays in the **Communication Center**. No second messaging system.
- A small read-only registry in Settings gives each automation a permanent id, so
  "change AUT-001" is a complete instruction later.

### 13.2 Explicitly out of scope

Not deferred — **out**, until separately approved:

- moving coordination reports (#4/#5), tour completion, payroll hooks, held-expiry,
  open-tour generation, WON fan-out or any other existing behaviour into this engine;
- `domain_event` and `schedule` trigger kinds (they exist only to adopt workers);
- action kinds beyond invoking a Communication Center rule;
- projections of Communication Center / Admin Reports / בקרה into the registry;
- a בקרה detector for automation health;
- any automation composing message content itself.

### 13.3 What shipped in 0–1, kept or trimmed

Kept — each is directly required by the small use case:

| Kept | Why it is required |
|---|---|
| `automationFlag` + publish/delete guards | requirements 7 and 8 — **already done** |
| `ledger.js` (append-only AUT ids) | requirement 6 |
| `registry.js` (definition + boot validation, key-only conditions) | requirements 1, 2, 6 |
| `references.js` | powers the guards + the builder panel |
| `dependencies.js` — the questionnaire and communication resolvers only | requirement 8 + dependency visibility |
| `health.js` | requirement 5 (visible error state) |
| `AutomationState` / `AutomationRun` / `AutomationChange` | requirements 4, 5, 6 |
| Builder key panel + AUT links | requirements 7, 8 |

**To trim (slice 2a)** — surface that exists only to serve the withdrawn programme,
and whose presence would quietly invite it back:

- `actionKinds.js` → keep **`communication`** only. Delete `task`, `admin_report`,
  `control_issue`, `timeline_note`, and especially **`state_change`**, whose
  `handler` field was the adoption vehicle for existing domain logic.
- `dependencies.js` → keep `questionnaire_template`, `questionnaire_question`,
  `questionnaire_option`, `communication_trigger`. Delete `admin_report`,
  `task_type`, `control_issue_type`, `env` (and their tests).
- `registry.js` → `TRIGGER_KINDS` becomes `['questionnaire_submitted']` only.

This is a deletion-only change: nothing executes today, so it cannot regress
behaviour. It takes the codebase from "a platform waiting for consumers" to "the
one thing that was asked for".

### 13.4 The smallest next slice (proposed)

Requirements 7 and 8 are already live. What remains:

**2a — Trim** (above). Deletion only.

**2b — The trigger bridge.** One idea, and it is what keeps this small:

> A registered automation appears in the Communication Center's trigger picker.

`communication/triggers.js` today exports a static `TRIGGERS` array consumed by
exactly three places: the meta endpoint that feeds the picker, `triggerByType`
validation, and `TRIGGER_TYPES.includes()` in the routes. Appending one derived
entry per registered automation — type `automation:AUT-001`, label
`אוטומציה · AUT-001 · <name>`, its own category — means:

- the operator builds the message in the Communication Center **exactly as today**:
  channel, audience, timing, sending window, variables, versioning, delivery log;
- the automation's only action is *"fire trigger `automation:AUT-001`"*;
- the registry's "which communication rules does this invoke" resolves by querying
  `CommunicationEvent WHERE triggerType = 'automation:AUT-001'` — live, no drift.

No new messaging machinery, no second engine, no new delivery/retry path.
Contexts declared as `['deal','contact','org','tour']` — all existing branches, so
variables and documents work unchanged.

**2c — The minimal runtime.** `runtime.js`, roughly 120 lines:

```
submitSubmission()  →  after the transaction commits, fire-and-forget
      ↓
automationsForTrigger({ kind:'questionnaire_submitted', templateKey, purpose })
      ↓ per matching definition
  1. enabled?                     → no ⇒ nothing (no run row)
  2. AutomationRun.create({ idempotencyKey: `AUT-001:${submissionId}` })
                                  → P2002 ⇒ stop. THIS is requirement 4.
  3. evaluate `when` against the FROZEN answers, by key
                                  → no match ⇒ status 'skipped' + Hebrew reason
  4. fireCommunicationTrigger({ type:'automation:AUT-001', dealId, tourEventId,
                                triggerRef: submissionId })
  5. finalise the run row
```

ONE hook, in `submitSubmission` after the transaction — subject-agnostic, so both
adapters (booking / tour_event) are covered without touching either. Failures are
recorded and never propagate into the submission.

`firstSubmitOnly` defaults true: an edited answer is not a new event. Because the
idempotency key is the submission id, re-submitting the same form can never send twice.

**2d — Read-only registry screen.** `הגדרות → אוטומציות`. List (id, name, status,
questionnaire, communication rules invoked, last run, run count, errors) and a detail
page: dependencies with live status, the answer condition in plain Hebrew, the
communication rules it invokes with their `#N` numbers, and the last 50 runs with
skip/failure reasons. Enable/disable and copy-id are the only controls.

**2e — The first real automation.** You name the question, the answer, and which
message. I allocate `AUT-001`, write one definition file, and wire nothing else.

Slices 2a–2d are the foundation for *any* such automation; 2e is one per request
afterwards, with no new infrastructure.

### 13.5 What this deliberately does not give you

- No way for an automation to create a task, raise a בקרה issue, or change business
  state. Only "send through the Communication Center".
- No scheduled or domain-event automations — questionnaire submissions only.
- Existing behaviours keep working exactly as they do now, untouched and unregistered.
  The registry will therefore **not** be a complete picture of every automated
  behaviour in GOS, and the screen must say so rather than imply otherwise.

Each of those is a deliberate no, reversible by an explicit decision later.
