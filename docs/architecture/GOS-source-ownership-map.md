# GOS — Source Ownership Map (the mirror contract)

> ## ⚠ SUPERSEDED IN SCOPE BY THE CUTOVER (2026-07-31)
>
> This map describes the **Intermediate Stabilization Phase**, which has ended.
> Read [GOS-cutover-final-2026-07-31.md](GOS-cutover-final-2026-07-31.md) first —
> where the two disagree, the cutover document wins.
>
> What changed: field-level ownership is no longer *reachable* for almost
> everything below. Airtable is retired entirely, and Pipedrive may only
> **create** new leads (deal + its person + its company) — no updates, no status
> sync, no contacts sync, no organizations sync, no activities, no notes, no
> files, and never a deletion. `server/src/mirror/legacyPolicy.js` decides that
> before any field in this document is consulted.
>
> This map is still the correct and binding contract for the fields the mirror
> may write **when it creates a record**, and for the `full_mirror` break-glass.
> It is kept, not deleted, because that is exactly when it would be needed.

**Status:** CONTRACT. This document is a precondition of the mirror, not a
description of it. No mirror code may synchronize an entity or a field that does
not appear here with all five columns filled in.

**Scope:** the Intermediate Stabilization Phase — GOS is a one-way operational
mirror of Pipedrive and Airtable, and each legacy ingress source is retired
individually and later. **That phase ended on 2026-07-31 — see the banner above.**

**Last updated:** 2026-07-31 (cutover banner; body unchanged from 2026-07-29)

---

## 0) How to read this

Every synchronized entity and every synchronized field carries five declarations:

| Column | Question it answers |
|---|---|
| **Source of truth** | Who is allowed to be right when two systems disagree, *today* |
| **Direction** | Which way bytes are permitted to move |
| **Merge** | What the mirror does when the source value changes |
| **Conflict** | What happens when GOS and the source both changed since the last sync |
| **Post-retirement owner** | Who owns it the moment that legacy source is switched off |

A field with no row here is, by definition, **not synchronized**: the mirror must
never touch it, and GOS owns it outright.

---

## 1) The five laws

These are invariants. Every table below is an application of them, and any
implementation that contradicts one is wrong regardless of what it achieves.

**Law 1 — One-way, always.**
`Pipedrive → GOS` and `Airtable → GOS`. There is no code path, no retry, no
"reconciliation fix-up", and no admin action that writes to Pipedrive or
Airtable. The legacy API clients are GET-only, enforced at the client layer, not
by convention.

**Law 2 — Cancelled never becomes active.**
An Airtable tour whose status is cancelled must never produce, resurrect, or
re-activate a GOS operational tour. Carried forward verbatim from the Wave-1
migration, where it is already enforced.

**Law 3 — Never silently overwrite a human.**
If GOS changed and the source changed, the mirror writes **nothing** and raises a
conflict. Divergence is made visible; it is never resolved by timestamp, by
"source wins", or by last-writer-wins.

**Law 4 — One writer per field per source.**
A field may have exactly one active writer at a time. When a source moves to
direct ingress, its legacy path is disabled in the same change that enables the
direct path — never both, never neither.

**Law 5 — The crosswalk is permanent.**
`LegacyRecord` is never deleted, never rewritten in place beyond its sync
baseline, and survives deletion of the entity it points at. Auditability outlives
the mirror.

---

## 2) Ownership classes

| Class | Meaning | UI treatment |
|---|---|---|
| **L** — legacy-owned | The legacy system is authoritative today | "מסונכרן מ-Pipedrive" / "מסונכרן מ-Airtable" badge; **editable**; a later legacy change to a locally-edited field raises a conflict instead of overwriting |
| **G** — GOS-owned | GOS is authoritative; the mirror never writes it | normal |
| **G!** — GOS-owned, legacy-seeded | Imported once at Wave 1, GOS-owned since; the mirror never writes it again | normal |
| **D** — derived | Computed by GOS from other fields; not a sync target | read-only, no badge (it is not "from legacy", it is *computed*) |
| **X** — never synchronized | Deliberately excluded | not shown as synced |

Per the approved stabilization decision: **class L is a badge, not a lock.** The
team keeps full CRM editing throughout the mirror period. Operational continuity
beats strict immutability; conflicts are surfaced, not prevented.

---

## 3) Entity-level map

| Entity | Source of truth | Direction | Merge | Conflict | Post-retirement owner |
|---|---|---|---|---|---|
| Deal (CRM) | **Pipedrive** | PD → GOS | 3-way per field (§6) | Conflict record, no write | **GOS** at Pipedrive retirement |
| Contact | **Pipedrive** | PD → GOS | 3-way per field; channels append-only | Conflict record | **GOS** |
| Organization | **Pipedrive** | PD → GOS | 3-way per field | Conflict record | **GOS** |
| Note → TimelineEntry | **Pipedrive** | PD → GOS | Append-only, immutable | Impossible by construction | **GOS** |
| Activity → TimelineEntry | **Pipedrive** | PD → GOS | Append-only + status update | Conflict on completion state only | **GOS** |
| Task | **Pipedrive** (imported activities) | PD → GOS | 3-way on status/due | Conflict record | **GOS** |
| TourEvent (legacy operational) | **Airtable** | AT → GOS | 3-way per field, date-gated | Conflict record | **GOS** |
| TourEvent (GOS-native) | **GOS** | none | n/a | n/a | **GOS** |
| Booking / seats | **Airtable** (legacy tours) | AT → GOS | Quantity reconcile (§6.4) | Conflict record | **GOS** |
| TicketRegistration | **GOS** | none | n/a | n/a | **GOS** |
| TourAssignment (guides) | **Airtable** (legacy tours) | AT → GOS | Set-reconcile by `PersonRef.externalPersonId` | Conflict record | **GOS** |
| Open tours / templates | **GOS** | none | n/a | n/a | **GOS** |
| DealMarketing | **Pipedrive** now → **Ingress** later | PD → GOS, then Ingress → GOS | First-touch immutable, latest-touch overwrite (§6.5) | First-touch conflict only | **Ingress platform** |
| Payroll | **GOS** | none | n/a | n/a | **GOS** |
| Quotes / offers / documents | **GOS** | none | n/a | n/a | **GOS** |
| Guide Portal | **GOS** | none | n/a | n/a | **GOS** |
| Calendar sync | **GOS** | GOS → Google | n/a | n/a | **GOS** |
| Communications (email/WhatsApp) | **GOS** | none | n/a | n/a | **GOS** |
| Files / gallery / media | **GOS** | none (Wave-1 archive is frozen) | n/a | n/a | **GOS** |
| Configuration + catalogue | **GOS** | none | n/a | n/a | **GOS** |

**Deliberately absent** — Pipedrive Products/price lists, Pipedrive users/teams,
Airtable payroll sheets, Airtable access/passwords table (excluded at snapshot
level and must stay excluded), Airtable tour summaries (superseded by the
Questionnaire Engine), and every GOS module built after Wave 1.

---

## 4) Field-level map — Pipedrive

### 4.1 Deal

| GOS field | Pipedrive source | Class | Merge | Conflict | Post-retirement |
|---|---|---|---|---|---|
| `title` | `title` | L | 3-way | conflict | GOS |
| `status` | `status` | L | 3-way | conflict | GOS |
| `dealStageId` | `stage_id` via frozen stage map | L | 3-way on stage KEY | conflict | GOS |
| `valueMinor` | `value` ×100 | L | 3-way | conflict | GOS |
| `currency` | `currency` | L | 3-way | conflict | GOS |
| `wonAt` | `won_time` | L | 3-way | conflict | GOS |
| `lostAt` | `lost_time` | L | 3-way | conflict | GOS |
| `lostReason` (free text) | `lost_reason` | L | 3-way | conflict | GOS |
| `lostReasonId` / `lostNotes` | — | G | never written | — | GOS |
| `expectedCloseDate` | `expected_close_date` | L | 3-way | conflict | GOS |
| `tourDate`, `tourTime`, `participants` | custom fields | L | 3-way | conflict | GOS |
| `orderNo` | Pipedrive deal id | **G!** | **never re-written** — it is the deal's URL | — | GOS |
| `dealSourceId` | source custom field | L | 3-way | conflict | **Ingress** |
| `source` (free-text detail) | source custom field | L | 3-way | conflict | **Ingress** |
| `organizationTypeId`, `activityType` | org linkage | **D** | derived by `normalizeClassification` | — | GOS |
| `productId`, `productVariantId`, `locationId` | — | G | never written | — | GOS |
| `paymentTermId`, `paymentMethodId` | — | G | never written | — | GOS |
| `noPaymentWaiver` | — | G | never written | — | GOS |
| `wonQuoteRef` | — | G | never written | — | GOS |
| `valueMinor` when a GOS quote is primary | — | **G overrides L** | mirror **skips** `valueMinor` once `wonQuoteRef` or a primary Builder version exists | — | GOS |
| `ownerUserId` | `user_id` → label | L | 3-way | conflict | GOS |
| `notes` | — | G | never written | — | GOS |
| everything else on `Deal` | — | X | — | — | GOS |

> The `valueMinor` exception is load-bearing. Once GOS produces the commercial
> document, GOS owns the money — otherwise a stale Pipedrive value would
> overwrite a signed quote. This is an ownership *transfer trigger*, and the only
> one that fires automatically.

### 4.2 Contact

| GOS field | Pipedrive source | Class | Merge | Conflict | Post-retirement |
|---|---|---|---|---|---|
| `firstNameHe` / `lastNameHe` / `firstNameEn` / `lastNameEn` | `name` + approved name-cleanup decisions | L | 3-way | conflict | GOS |
| `ContactPhone[]` | `phone[]` | L | **append-only**; never reformat, never re-primary, never delete | none (append cannot conflict) | GOS |
| `ContactEmail[]` | `email[]` | L | **append-only** | none | GOS |
| `communicationLanguage` | — | G | never written | — | GOS |
| `taxId` | national id custom field | L | 3-way | conflict | GOS |
| `contactNo` | Pipedrive person id | **G!** | never re-written | — | GOS |
| `ContactOrganization[]` | `org_id` | L | set-reconcile, additive | conflict on removal | GOS |
| notes / internal fields | — | G | never written | — | GOS |

> Append-only channels are non-negotiable: a phone number the office already
> uses must never be silently reformatted or demoted by a sync. Identical rule as
> the ingress platform's `enrichContactChannels`, reused, not re-implemented.

### 4.3 Organization

| GOS field | Pipedrive source | Class | Merge | Conflict | Post-retirement |
|---|---|---|---|---|---|
| `name` | `name` | L | 3-way | conflict | GOS |
| `taxId` | custom field | L | 3-way | conflict | GOS |
| `address` | `address` | L | 3-way | conflict | GOS |
| `organizationTypeId` | `סוג העסק` → frozen enum map | L | 3-way | conflict | GOS |
| `orgNo` | Pipedrive org id | **G!** | never re-written | — | GOS |
| quote content, defaults, finance settings | — | G | never written | — | GOS |
| merge/dedup decisions | — | **G** | Review Center decisions always win over a source change | — | GOS |

### 4.4 Notes and Activities → TimelineEntry

| GOS field | Pipedrive source | Class | Merge | Conflict | Post-retirement |
|---|---|---|---|---|---|
| entry body / author / occurredAt | note / activity | L | **append-only, immutable once written** | impossible | GOS |
| activity completion state | `done` | L | 3-way | conflict | GOS |
| activity due date/time | `due_date`, `due_time` | L | 3-way | conflict | GOS |
| GOS-authored timeline entries | — | G | never touched | — | GOS |

> Imported history is immutable. A note edited in Pipedrive appends a revision
> entry; it does not mutate the original. This preserves the audit trail and
> makes conflict impossible for the highest-volume entity in the system
> (213,729 rows), which is exactly where a merge bug would be most expensive.

### 4.5 Task

| GOS field | Pipedrive source | Class | Merge | Conflict | Post-retirement |
|---|---|---|---|---|---|
| `title` | activity subject | L | 3-way | conflict | GOS |
| `dueAt` | `due_date` + `due_time` | L | 3-way | conflict | GOS |
| `status` | `done` | L | 3-way | conflict | GOS |
| `taskTypeId` | activity type via frozen map | L | 3-way | conflict | GOS |
| `assigneeId` | `user_id` → `PersonRef` | L | 3-way | conflict | GOS |
| GOS-created tasks | — | G | never touched | — | GOS |

### 4.6 DealMarketing (new canonical entity)

| GOS field | Pipedrive source | Class | Merge | Conflict | Post-retirement |
|---|---|---|---|---|---|
| `leadSource`, `channel`, `campaign`, `medium`, `content`, `term` | marketing custom fields / UTM | L | latest-touch overwrite | none | **Ingress** |
| `landingUrl`, `referrer` | custom fields | L | latest-touch overwrite | none | **Ingress** |
| `firstTouchAt`, `firstTouchSource`, `firstTouchCampaign` | earliest evidence | L | **immutable once set** | conflict if a different first touch arrives | **Ingress** |
| `latestTouchAt`, `latestTouchSource` | latest evidence | L | overwrite | none | **Ingress** |
| `originalIngressSource` | derived from source system | **G!** | write-once | — | **Ingress** |
| `sourceCreatedAt` | `add_time` | L | write-once | — | **Ingress** |
| `attributionRaw` | full custom-field bag | L | overwrite | none | **Ingress** |

> Marketing is the one area whose post-retirement owner is **not** GOS-the-human
> but the ingress platform. The fields are identical either way, which is the
> whole point: the panel does not change at cutover, only who writes it.

---

## 5) Field-level map — Airtable

### 5.1 TourEvent (legacy operational tours only)

Applies **only** to TourEvents carrying an `airtable/tour` crosswalk row.
GOS-native tours are class G throughout and the mirror must not consider them.

| GOS field | Airtable source | Class | Merge | Conflict | Post-retirement |
|---|---|---|---|---|---|
| `date` | `DATE` | L | 3-way, **date-gated** (§6.3) | conflict | GOS |
| `startTime` | `שעת התחלה` | L | 3-way | conflict | GOS |
| `status` | `סטטוס` via frozen map | L | 3-way + **Law 2** | conflict | GOS |
| `cancelledAt` | cancellation | L | one-way: active → cancelled only | never un-cancels | GOS |
| `locationId` | city field | L | 3-way | conflict | GOS |
| `tourLanguage` | language field | L | 3-way | conflict | GOS |
| `capacity` | participants | L | 3-way | conflict | GOS |
| `notes` | notes | L | 3-way | conflict | GOS |
| `completedAt`, `completedReason` | — | **G** | never written — `completedReason='migration'` is what suppresses payroll | — | GOS |
| `gcal*` (all) | — | **G** | never written | — | GOS |
| `woo*` (all) | — | **G** | never written | — | GOS |
| `openTourTemplateId`, `generatedByRuleId` | — | G | never written | — | GOS |
| `productId` / `productVariantId` | derived from the tour type map | D | derived | — | GOS |

### 5.2 Booking / seats

| GOS field | Airtable source | Class | Merge | Conflict | Post-retirement |
|---|---|---|---|---|---|
| seat quantity per booking | `משתתפים` | L | quantity reconcile (§6.4) | conflict when GOS seats were also edited | GOS |
| booking ↔ Deal link | `פייפ דיל ID` | L | set-reconcile | conflict | GOS |
| booking status | tour status | D | follows the TourEvent | — | GOS |
| payment / collection state | — | G | never written | — | GOS |

### 5.3 TourAssignment (guides)

| GOS field | Airtable source | Class | Merge | Conflict | Post-retirement |
|---|---|---|---|---|---|
| assigned guide set | guide link fields | L | set-reconcile, resolved via **`PersonRef.externalPersonId` first**, email second, name never | conflict when GOS assigned someone else | GOS |
| role on the tour | role field | L | 3-way | conflict | GOS |
| payroll linkage | — | **G** | never written | — | GOS |
| guide-portal state | — | **G** | never written | — | GOS |

> Identity resolution order is a hard requirement, not a heuristic: an
> `externalPersonId` match is authoritative, an email match is acceptable, and a
> name match is **never** allowed to create or rebind an assignment. Name
> collisions between guides are real and have already been fixed once in this
> project.

---

## 6) Merge and conflict machinery

### 6.1 The baseline

Every merge is **3-way**, never 2-way. The three inputs are:

| Input | Where it lives |
|---|---|
| `base` — the value at the last successful sync | `LegacyRecord.syncBaseline` |
| `source` — the value now in Pipedrive/Airtable | the incoming webhook/poll payload |
| `gos` — the value now in GOS | the live row |

A 2-way merge (source vs GOS) cannot distinguish "GOS was edited" from "the
source was edited", so it must either clobber humans or refuse everything. The
baseline is what makes Law 3 implementable.

This is the same algorithm already proven in `planDealDelta`
(`server/src/migration/import/cutoverImport.js`), generalised — not a second
merge implementation.

### 6.2 The decision table

| `base` vs `source` | `base` vs `gos` | Action |
|---|---|---|
| equal | any | **no-op** — the source did not change |
| changed | equal | **merge** — write `source` into GOS, advance the baseline |
| changed | changed, `gos == source` | **converged** — advance the baseline only |
| changed | changed, `gos != source` | **CONFLICT** — write nothing, raise a conflict, do not advance the baseline |

A conflict leaves both systems exactly as they were. Nothing is lost, and the
next sync will re-raise it until a human resolves it — deliberately, because a
conflict that silently disappears is worse than one that nags.

### 6.3 The date gate (Airtable tours)

A tour whose date cannot be parsed to a real calendar date is **never guessed
at** and never silently dropped: it is surfaced as a rejected record and blocks
planning for that record only. Carried forward from `tourNormalize.js`, which
already enforces this.

### 6.4 Quantity reconcile (seats)

Seats are reconciled by **delta**, not by absolute overwrite: if the source moved
from 20 → 25 and GOS is at 22 (two GOS-side cancellations), the mirror proposes
27 and flags it, rather than stamping 25 and destroying the local truth. Any
reconcile that would reduce seats below the number already registered in GOS is
always a conflict, never an automatic write.

### 6.5 Marketing merge

Marketing attribution has two halves with opposite rules, and conflating them is
the classic attribution bug:

- **first touch** — immutable once set. A later payload claiming a different
  first touch is a conflict, never an overwrite.
- **latest touch** — overwritten freely. That is what "latest" means.

### 6.6 Conflict surfacing

Conflicts surface as `OperationalIssue` rows in the existing **בקרה** module —
one canonical detector family, `legacy_sync_conflict`, not a new screen and not a
new notification channel. Each conflict carries entity, field, the three values,
and both timestamps. Resolution is: accept legacy · keep GOS · edit manually —
and each choice advances the baseline so the conflict does not re-fire.

### 6.7 Deletes

A record that disappears from the source is **never** deleted in GOS. It is
marked `sourceDeletedAt` and raised as an issue. Legacy deletions are frequently
accidental, and GOS is now the system of record for operational history —
including payroll and guide-portal state that hangs off those records.

---

## 7) Ownership transfer at retirement

When a legacy source is retired, every field of class **L** belonging to it flips
to class **G** in one atomic change:

1. the mirror stops reading that source (its poller and webhook are disabled);
2. all `L` fields for that source become plain GOS fields — badge removed;
3. the crosswalk is retained permanently (Law 5);
4. `sourceDeletedAt` and open conflicts for that source are force-resolved to
   "keep GOS" and archived, not deleted.

Per-source retirement order is independent, and each retirement must satisfy Law
4 — the legacy path off in the same change that turns the direct path on.

| Legacy source | Replaced by | Fields that flip |
|---|---|---|
| Meta lead ads (via Pipedrive) | Ingress `meta_lead_ads` | Deal source + all DealMarketing |
| Woo old | Ingress `woocommerce` | Deal source, DealMarketing, order lines |
| Woo new | Ingress `woocommerce` (new key) | as above |
| Website forms | Ingress `website_form` | Deal source + DealMarketing |
| Pipedrive (whole CRM) | GOS CRM | every §4 `L` field |
| Airtable (operational tours) | GOS Tours | every §5 `L` field |

---

## 8) What the mirror must never do

1. Write to Pipedrive or Airtable — in any code path, including error recovery.
2. Resolve a conflict automatically, by timestamp or by precedence.
3. Delete a GOS record because it vanished from the source.
4. Re-activate a cancelled Airtable tour (Law 2).
5. Overwrite `orderNo`, `contactNo`, or `orgNo` — they are permanent identity.
6. Overwrite `valueMinor` on a deal whose commercial document GOS produced.
7. Reformat, re-primary or delete an existing contact phone or email.
8. Touch payroll, guide-portal, quote, document, gallery, questionnaire,
   reservation, calendar, or communication state.
9. Bind a guide assignment by name.
10. Run two writers against the same field for the same source (Law 4).
