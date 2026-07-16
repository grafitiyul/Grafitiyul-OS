# GOS — CRM Tasks Workspace: Architecture Plan

Status: **approved for implementation, not started**
Date: 2026-07-15
Supersedes: nothing. First plan for this module.

---

## 0. What this screen is

The **primary daily operational workspace of CRM**. First tab, full width, full height.

It is not an Activities list and not a report. It is the screen the owner lives in
all day: filter to a time window, work the rows, open a Deal only when the row
itself cannot answer the question.

**Design target: Airtable, not Pipedrive.**

- Dense. Rows are compact; the grid, not the chrome, owns the pixels.
- Fast. Server-side filter/sort/paginate; the grid never waits on the browser.
- Keyboard-first. The mouse is optional for the whole daily loop.
- **Popups are a failure mode.** Editing a field happens in the cell. Bulk actions
  happen in an inline action bar. The Deal drawer is the *one* deliberate exception,
  because a Deal genuinely is another workspace.

Anything that would open a modal must first be argued for.

---

## 1. Locked product decisions

These were decided by the owner on 2026-07-15. Do not relitigate during implementation.

| # | Decision |
|---|---|
| 1 | **No virtualization now.** Server-side filtering + pagination first. Add virtualization only if real measurement justifies it. |
| 2 | **No hard delete, ever.** Bulk action is "ביטול משימות" (cancel). Task history stays auditable forever. |
| 3 | **No partially-working sorting.** Explicit sortable/non-sortable matrix (§4) is binding. To-one relations may be sortable; contacts/bookings/computed/aggregated columns are display-only unless explicitly promoted. |
| 4 | **Time chips are mutually exclusive**, never cumulative. היום = only today. מחר = only tomorrow. השבוע = the remaining days of this week *after* tomorrow. השבוע הבא = next calendar week. |
| 5 | **Chips are navigation; Saved Views are presets.** A Saved View stores the selected chip alongside every other filter. There is exactly one concept of "today" in the system. |
| 6 | **DealDrawer moves to a shared location**, gains Previous/Next, keeps dirty-form protection. |
| 7 | **One realtime system.** Extract the Payroll SSE implementation into shared infrastructure; Payroll migrates onto it; Tasks is its second consumer. |
| 8 | **Tags: removed entirely.** No column, no field, no placeholder infrastructure. Future feature. |
| 9 | **`Task.ownerUserId` becomes a real relation** to `AdminUser` with **`onDelete: Restrict`**. An admin owning tasks cannot be physically deleted until they are reassigned. Historical owners are retired via `AdminUser.isActive`, never by deletion. `AdminUser.displayName String?` with username fallback. |
| 10 | **Airtable-like.** Dense, fast, keyboard-friendly, inline editing. Drawer is the exception, not the rule. |
| 11 | **No `priorityRank`.** `Task.priority` stays the single source of truth. Semantic ordering (high → medium → low) is implemented centrally; a narrowly-contained SQL `CASE` is permitted only under the constraints in §4.4. Priority must never be duplicated into a second writable field. |
| 12 | **Two tour dates stay separate** with distinct labels. The planned Deal date may be sortable; the operational Booking/TourEvent date stays display-only until a correct queryable design is explicitly implemented. Never merge or silently substitute. |

---

## 2. Current state (audited 2026-07-15)

### Exists and is reusable

- **`useTableColumns`** — `client/src/admin/common/tableColumns.jsx` + `tableColumnsCore.js`.
  Show/hide, drag-reorder (picker *and* headers), RTL-aware resize with clamping,
  localStorage persistence with schema migration, reset, single-column sort. Unit-tested.
  Seven consumers. **This is the column SSOT and will be extended, not replaced.**
- **`DealDrawer`** — `client/src/admin/whatsapp/DealDrawer.jsx`. Props `{ dealId, onClose }`,
  renders `<DealDetail key={dealId} />`, `absolute inset-0` so it covers its relative
  ancestor and leaves the list visible. Already cross-imported by Email.
- **`hasDirtyForms()`** — `client/src/lib/dirtyForms.js`.
- **Payroll SSE** — `client/src/lib/payrollRealtime.js` + `server/src/payroll/events.js`.
  Invalidation-hint contract, 400ms debounce, capped 5s→60s backoff, focus/visibility
  catch-up. Framework-free core + thin React wrapper.
- **`startMidnightRefresh`** — `client/src/admin/tours/tourEvents.js`. Asia/Jerusalem
  midnight rollover with visibility/focus recovery. Pure, injectable clock.
- **`transitionTask`** — `server/src/tasks/taskService.js`. The single task-transition
  point; writes task + one `TimelineEntry` in one transaction. Idempotent.
- **`GET /api/task-types`** — serves the type chips as-is.
- **`multiSelectCore.js` / `MultiSelectFilter.jsx`** — shared filter infra.

### Exists but does not fit

- **`GET /api/deals/:dealId/tasks`** — single-deal, one filter param (`status`),
  hard-coded sort, no pagination, includes only `taskType`. Cannot serve a cross-deal grid.
- **`searchTasks`** — `server/src/search/providers/tasks.js`. Read-only, capped,
  `updatedAt desc`. Not a grid API, but it proves the task→deal→contact join shape and
  the batched owner-resolution pattern.

### Does not exist

- Any cross-deal task list API. Any bulk task endpoint. Any task DELETE (deliberate).
- Saved views — no model, no API, no UI, anywhere in the project.
- Server-side user preferences — every screen persists to localStorage ad-hoc.
- Task realtime. (Payroll SSE is the only server→client push in the app.)
- Row selection, sticky header/columns, multi-sort, keyboard nav, virtualization in the table infra.
- Tags (correctly — decision #8).

### Known gaps to resolve inside this work

- **`Task.ownerUserId`** is a loose `String`, no FK → cannot join or sort by owner.
- **`AdminUser` has no display-name field** — only `username`, `passwordHash`, `role`,
  `isActive`, `lastLoginAt`. The Owner column can only render a username until a
  `displayName` is added. **Add `AdminUser.displayName String?` in Slice 0** and fall
  back to `username` when null. Cheap, and the alternative is a workspace that shows
  `dorko` where a human name belongs.
- **Task indexes** are `[dealId, status]` and `[ownerUserId, status]` — wrong for this
  screen's core query (window + type + owner, sorted by dueDate).
- **`dealTasks.js` PATCH writes Prisma directly**; only transitions go through
  `taskService`. Two write paths for one model. Must be unified (§5.3).
- **`client/src/admin/crm/config.js`** header comment contradicts itself (says CRM is a
  "SECONDARY reference surface" and an "interim home", then says it is "the operational
  hub"). Clean up when Tasks becomes the first tab.

---

## 3. The canonical filter object

**One shape is the SSOT for the entire screen.** The chips are not a parallel filtering
system — they are the one control that writes `window`. Everything ANDs.

```js
{
  window:     'overdue' | 'today' | 'tomorrow' | 'this_week' | 'next_week' | 'range',
  rangeFrom:  'YYYY-MM-DD' | null,   // only when window === 'range'
  rangeTo:    'YYYY-MM-DD' | null,   // only when window === 'range'
  typeKeys:   string[],              // [] = all types
  ownerIds:   string[],              // [] = all owners
  priorities: string[],              // [] = all  ('low'|'medium'|'high'|'none')
  stageIds:   string[],              // [] = all
  status:     'open' | 'completed' | 'all',
}
```

This object is what the grid query takes, what the counts endpoint takes, what a
`SavedView` stores, and what the URL reflects. **One shape, one resolver, one place to
change.**

### 3.1 Window resolution — server-side, Asia/Jerusalem

Windows resolve to concrete `[from, to]` date bounds in a **shared pure module**
(`server/src/tasks/windows.js`), unit-tested with an injected clock. "Today" in UTC is
wrong for these users. The project already has IL-midnight conventions (the questionnaire
completion worker, `startMidnightRefresh`); this follows them.

Weeks are **Sunday–Saturday** (Israel).

Given `today` in Asia/Jerusalem, the buckets are **disjoint by construction**:

| Window | Bounds | Notes |
|---|---|---|
| `overdue` | `dueDate < today` | **Also pins `status = 'open'`** — see §3.2 |
| `today` | `dueDate == today` | |
| `tomorrow` | `dueDate == today + 1` | |
| `this_week` | `today + 2 … Saturday of this week` | **Empty when today is Fri or Sat.** The chip must render as disabled/0, not as a lie. |
| `next_week` | `Sunday … Saturday of next week` | |
| `range` | `[rangeFrom, rangeTo]` inclusive | The only window that may overlap the others |

Edge cases that must have tests:
- Friday/Saturday → `this_week` is empty.
- Saturday → `next_week` starts *tomorrow*.
- DST transitions (Israel shifts in late March / late October).
- Midnight rollover while the tab is open (§7.3).

### 3.2 The one semantic exception: באיחור

"Overdue" is meaningless for a completed task. `overdue` therefore pins `status = 'open'`
in addition to its date bound, and **while באיחור is active the status control is
disabled** with the reason shown. Every other window treats `status` as orthogonal.

This is the single place where a chip touches a non-date field. It is deliberate,
documented here, and must not be generalized.

---

## 4. Column matrix (binding)

**Rule:** sortable ⟺ the value is reachable from `Task` through an unbroken chain of
**to-one** relations. Prisma supports nested to-one `orderBy` chains
(`{ deal: { productVariant: { location: { nameHe: 'asc' } } } }`); it cannot order through
a to-many. Anything to-many, computed, or aggregated is **display-only**.

Display-only columns are hydrated by **batched second queries over the page window only**
(the pattern `searchTasks` and payroll already use) — never by a per-row include.

### 4.1 Sortable

| Column | Path | Sort key | Notes |
|---|---|---|---|
| סוג משימה | `task.taskType` (to-one) | `taskType.sortOrder` | Sort by configured order, not label. |
| כותרת | `task.title` | `title` | |
| תאריך יעד | `task.dueDate` | `dueDate` | Default sort, asc. |
| שעת יעד | `task.dueTime` | `dueTime` | `String?` "HH:MM" — lexicographic sort is correct. Nulls last. |
| עדיפות | `task.priority` | *semantic* | `String?` `null\|low\|medium\|high` — **lexicographic order is wrong** (`high < low < medium`). Ordered high→medium→low, nulls last, centrally. See §4.4. |
| סטטוס | `task.status` | `status` | |
| הושלם ב־ | `task.completedAt` | `completedAt` | |
| נוצר ב־ | `task.createdAt` | `createdAt` | |
| אחראי | `task.owner` (to-one, **after Slice 0**) | `owner.displayName` → `owner.username` | Blocked on the FK migration + `displayName`. |
| מספר דיל | `task.deal` (to-one) | `deal.orderNo` | `Int @unique`. |
| כותרת דיל | `task.deal` | `deal.title` | |
| שלב | `task.deal.dealStage` (to-one) | `dealStage.sortOrder` | **Pipeline order, not alphabetical.** |
| סטטוס דיל | `task.deal` | `deal.status` | `open\|won\|lost` |
| ארגון | `task.deal.organization` (to-one) | `organization.name` | Nullable — deal may have no org. |
| מוצר | `task.deal.product` (to-one) | `product.nameHe` | |
| וריאנט | `task.deal.productVariant.location` (to-one chain) | `location.nameHe` | `ProductVariant` has **no name of its own** — it is product×location. Display renders the location; sort follows it. |
| עיר | `task.deal.location` (to-one) | `location.nameHe` | **Distinct from the variant's location.** `Deal.locationId` is the operational city and may be a manual override with no matching variant. |
| משתתפים | `task.deal.participants` | `deal.participants` | `Int?` |
| תאריך סיור (מתוכנן) | `task.deal.tourDate` | `deal.tourDate` | `String?` "YYYY-MM-DD" — lexicographic sort is correct. **This is the Deal's *planning* field, not operational truth.** See §4.3. |
| שפת תקשורת | `task.deal.communicationLanguage` | `deal.communicationLanguage` | |

### 4.2 Display-only (never sortable)

| Column | Why | Hydration |
|---|---|---|
| לקוח | `Deal → DealContact[] → Contact` (to-many) | Batched: primary contact (`isPrimary`) per page. |
| טלפון | `Deal → DealContact[] → Contact → ContactPhone[]` (to-many of to-many) | Batched with the contact. |
| אימייל | `Deal → DealContact[] → Contact → ContactEmail[]` (to-many of to-many) | Batched with the contact. |
| סיור קרוב (מבצעי) | `Deal → Booking[] → TourEvent` (to-many) | Batched: nearest non-cancelled booking's event per page. See §4.3. |
| סטטוס תזמון WhatsApp | `Task.scheduledMessageId` → loose key, no relation | Batched — exactly as `serializeTasks` already does. |

### 4.3 Two tour dates — do not merge them

- **`Deal.tourDate` / `Deal.tourTime`** — Deal scalars, the pre-WON *planning* fields from
  the sales-call workspace. Sortable. May be stale or empty.
- **`Booking[] → TourEvent.date`** — the operational SSOT (per the schema: "the ONLY
  Deal↔TourEvent relationship. Never add a direct tourEventId here"). To-many. Display-only.

They are different facts and must be two different columns with two different labels
("תאריך סיור (מתוכנן)" vs "סיור קרוב"). Collapsing them into one "Upcoming tour" column
would be a lie in both directions.

### 4.4 Priority sort — semantic ordering, no second field

`Task.priority` is `String?` with values `null | low | medium | high`. Alphabetical sort
produces `high, low, medium` — nonsense.

**Decision (locked, #11): `priority` remains the single source of truth.** A denormalized
`priorityRank` column was considered and **rejected** — it would create a second writable
representation of the same fact that can drift from it.

Semantic order is **high → medium → low**, with `null` (no priority) last.

Implementation: express the ordering centrally in the canonical Tasks query layer. If
Prisma cannot express it (it cannot order by a CASE over a scalar), **one** narrowly
contained SQL `CASE` is permitted, under all of the following constraints:

- It lives in **one server-side module** and nowhere else.
- It is **covered by tests**.
- Sort fields pass a **strict whitelist** (§4.1). Unknown key ⇒ `400`.
- It **never** interpolates untrusted column names or SQL fragments. The whitelist maps
  client keys to server-controlled constants; client input never reaches the query text.
- It preserves a **stable secondary sort** (`dueDate`, then `id`) so offset pagination
  cannot skip or duplicate rows across pages.

This is the project's only sanctioned raw-SQL exception, and it is scoped to ordering.

> Note: this constraint applies to the **Slice 1 read API**, not Slice 0. Slice 0 proves
> the ordering is achievable with a test/prototype; it adds no field and no query layer.

### 4.5 Explicitly dropped

- **תגיות (Tags)** — decision #8. No column, no field, no infrastructure.
- **פעילות אחרונה (Last activity)** — an aggregate over the timeline; expensive and
  ambiguous (last *what*?). Not in v1. If it returns, it must be defined precisely and
  probably denormalized.

---

## 5. Server architecture

### 5.1 `GET /api/tasks` — the workspace query

Query params mirror §3 exactly. Server-side filter, multi-sort against a **whitelist
derived from §4.1** (an unknown or non-sortable sort key is a `400`, never a silent
fallback), offset pagination (`page`, `pageSize ≤ 100`), and `total`.

- To-one data via `include`.
- To-many data (§4.2) via batched second queries **over the returned page only**.
- Offset (not cursor) pagination: multi-sort + cursor is fragile, and offset is correct
  and simple at page size ≤ 100. Revisit only if measurement demands it.

### 5.2 `GET /api/tasks/counts` — chip counts

Takes the same filter object **minus `window`**, returns a count per chip.

**Two queries, not six:**
1. One narrow scan selecting only `dueDate` for tasks matching all other filters within
   `[today, end-of-next-week]`, bucketed in memory into today/tomorrow/this_week/next_week.
2. One `count` for `overdue` (unbounded backwards, so it cannot join the bucketed scan).

Cheap enough that counts are **not optional**.

### 5.3 `POST /api/tasks/bulk` and the write-path unification

Actions: `complete`, `cancel`, `assign_owner`, `set_due_date`, `set_priority`, `set_type`.
**No delete** (decision #2).

Hard requirements:
- **Chunk the work.** `transitionTask` writes one `TimelineEntry` per task; 200 tasks in
  one transaction holds locks far too long. Chunk (~25) and report per-id results.
- **Guard WhatsApp-channel tasks.** `Task.channel` is a snapshot and `scheduledMessageId`
  binds the task to a real scheduled send. `set_type` must **refuse** channel-bound tasks
  (partial success, reported honestly in the response) rather than silently orphaning a
  scheduled message.
- **Partial success is the normal case** and must be surfaced in the UI, not swallowed.

**Write-path unification (required, not optional):** today `dealTasks.js` PATCH writes
Prisma directly while transitions go through `taskService`. Adding a third write path
would be the "duplicate systems" failure. Extract *all* task mutation into `taskService`;
both the deal-scoped routes and the new `/api/tasks` routes become thin callers. Inline
cell edits need a canonical `PATCH /api/tasks/:id` — it must delegate to the same service
as `PATCH /api/deals/:dealId/tasks/:taskId`, not reimplement it.

### 5.4 `SavedView`

Cannot be localStorage — shared team views and cross-device restore are server concerns.

```
model SavedView {
  id, module ('crm_tasks'), name, icon,
  filters Json,       // the §3 object verbatim, including `window`
  sort Json,          // [{ key, dir }]
  columns Json,       // { visible[], order[], widths{} } — the tableColumns shape verbatim
  scope ('personal' | 'shared' | 'system'),
  ownerUserId, createdAt, updatedAt
}
```

`filters`/`columns` deliberately store the **existing** client shapes verbatim so there is
no translation layer to drift.

System views ship seeded and are not editable: 🔴 באיחור · 📅 היום · 📞 השיחות שלי ·
💰 גבייה · 🎯 עדיפות גבוהה · 🚶 תיאום סיורים · 📱 מעקב WhatsApp.

### 5.5 Migration (Slice 0)

- `Task.owner` → real relation to `AdminUser` with **`onDelete: Restrict`**. `ownerUserId`
  **stays `String` (non-null)**, preserving today's always-set assumption in `taskService`.
  Restrict means an admin owning tasks cannot be deleted until they are reassigned;
  retirement is `isActive: false`, which keeps historical owners valid and resolvable.
- `AdminUser.displayName String?` — Owner column renders `displayName ?? username`.
- Indexes: `[status, dueDate]`, `[ownerUserId, status, dueDate]`, `[taskTypeId, status, dueDate]`.
- **No `priorityRank`** (decision #11) and therefore no priority backfill.
- Must pass the repo's migration validation gate (`npm run validate:migrations`).

**Pre-flight gate (blocking):** before the FK is added, audit every existing
`Task.ownerUserId` value and prove each resolves to a real `AdminUser.id`. A non-resolving
value would make the `ADD CONSTRAINT` fail at deploy — on Railway, mid-startup. If any
orphaned or non-user values exist, **stop and report the exact population and proposed
treatment.** Do not force the FK.

---

## 6. Client architecture

### 6.1 Layout

Tasks becomes the **first CRM tab** (`CRM_TABS` in `client/src/admin/crm/config.js`,
index redirect in `App.jsx`, and `CrmLayout`'s hardcoded `activeKey` if/else chain —
which derives the active tab from `pathname`, *not* from the config array, so it must be
updated too). Clean up the contradictory header comment while there.

Full width, full height, no wasted chrome:

```
┌─ CRM tabs ────────────────────────────────────────────────┐
├─ [🔴 באיחור 12] [🟢 היום 8] [🟡 מחר 5] [📅 השבוע 9] …    │  ← time chips (navigation)
├─ [view ▾] [☑ שיחות][☑ וואטסאפ][☑ מייל]… | owner | ⚙      │  ← saved view + type chips + filters
├─ grid (sticky header, sticky leading columns) ─────────────┤
│                                                    ┌────── │
│                                                    │ Deal  │  ← drawer over the grid's
│                                                    │ drawer│    relative container
└────────────────────────────────────────────────────┴────── ┘
   [n selected] complete · cancel · owner · date · priority     ← inline bulk bar, no modal
```

### 6.2 Extending `tableColumns` (benefits all seven existing consumers)

Additive only — no consumer breaks:
- Sticky header + sticky leading columns.
- Multi-sort (`sort` becomes `[{key,dir}]`; single-sort callers keep working).
- Row selection (the `leading` slot already exists for the checkbox).
- Keyboard navigation + a `KeyboardSensor` for reorder/resize (currently `PointerSensor`
  only — the resize handle has `role="separator"` but no key handler).
- **Editable cell contract** (§6.4).

Sort state is currently per-screen `useState` and **not persisted**. It must join the
persisted state, because a Saved View stores it.

### 6.3 Time chips

- Mutually exclusive; exactly one always active. Default **היום**, highlighted green.
- Counts inline; `this_week` renders disabled at 0 on Fri/Sat (§3.1).
- Writes `filters.window` — nothing else. No parallel filter path.
- Recompute at Asia/Jerusalem midnight via `startMidnightRefresh` (reuse — do not write a
  second timer).
- טווח תאריכים uses the shared `DateTimeFields` (`DateField`) — never native inputs.

### 6.4 Inline editing (decision #10)

The Airtable feel is inline editing. Cells for owner, priority, due date, due time and
task type edit **in place**: Enter opens the editor, Enter commits, Esc cancels, Tab moves
on. Optimistic write with rollback + a visible error on failure.

Two constraints from the existing model:
- `PATCH` refuses non-open tasks (`409 task_not_open`). Completed rows are read-only —
  render them as such rather than failing on commit.
- Editing a WhatsApp-channel task's type is refused (§5.3). The cell must not offer it.

Precedent worth noting: `DealStage.displayMode` (`'read'|'edit'`) is an existing
platform-level inline-edit convention. Follow its spirit; the Tasks grid does not need
the stage-level toggle.

### 6.5 State persistence and the URL

- Filter object + sort + selected view live in the **URL** (deep-linkable — "look at this
  list" in WhatsApp, and the back button behaves).
- Last-selected view and column state persist per user (`useTableColumns` localStorage for
  columns today; the `SavedView` server model for the view itself).
- Return to the screen ⇒ restore the last view exactly.

### 6.6 Default on first visit

`{ window: 'today', ownerIds: [me], status: 'open' }` — the daily workspace on open, not
an empty grid.

### 6.7 Drawer

- Move `DealDrawer` → `client/src/admin/common/` (three consumers across three modules;
  it lives under `whatsapp/` for historical reasons only). Update the Email and WhatsApp
  imports.
- **Additive** props: `onPrev`, `onNext`, position label ("3 מתוך 47"). Existing consumers
  pass nothing and are unaffected.
- **Debounce the deal switch (~150ms).** `DealDetail` is a ~1000-line workspace and
  `key={dealId}` forces a full remount; holding an arrow key would otherwise fire one
  full load per keypress.
- Navigation walks the **task rows** in current filter+sort order. Consecutive rows may
  share a Deal — that is fine and must not be deduped; the position label refers to rows.
- Guard prev/next with `hasDirtyForms()`, exactly as the inboxes guard thread-switching.
- The grid container must be `position: relative` (the drawer is `absolute inset-0` and
  covers its ancestor, not the viewport — this is what keeps the table visible).

### 6.8 Keyboard map

| Key | Action |
|---|---|
| ↑ / ↓ | Move row |
| Enter | Open drawer |
| Space | Toggle selection |
| Shift+Click / Shift+↑↓ | Range select |
| Ctrl/Cmd+A | Select visible |
| Ctrl/Cmd+Enter | Complete |
| Esc | Close drawer / cancel cell edit |
| PgUp / PgDn | Drawer prev/next |
| Tab | Next cell (in edit mode) |

`DealDrawer` already owns its own Esc; the grid must defer while it is open (the pattern
both inboxes already use).

### 6.9 Mobile

Cards, not a grid — same filter object, same API, card renderer instead of the table.
Time chips stay (horizontally scrollable). Desktop is primary.

---

## 7. Realtime

### 7.1 Extract, don't fork

`payrollRealtime.js` is already the right design. Extract `createRealtimeStream` into
`client/src/lib/realtime.js` (invalidation hints only, debounce, capped backoff,
focus/visibility catch-up), **migrate Payroll onto it**, then add Tasks as the second
consumer. Server side: generalize `server/src/payroll/events.js` into a shared
SSE helper (`text/event-stream`, `no-store`, `X-Accel-Buffering: no`).

Payroll's behavior must not change; its existing tests (`events.test.js`,
`payrollRealtime.test.js`) are the regression net for the extraction.

### 7.2 What covers what

- **SSE** — another user edits a task; the WhatsApp worker completes/sends one; a Deal-side
  change. This is the half the client buses cannot see.
- **Client buses** (`taskEvents.js`, `gos:tour-changed`) — same-tab/cross-tab echo of
  *this* browser's own mutations. They stay.
- **Polling** — not added here. The screen must not join the `setInterval` crowd.

### 7.3 Rendering updates

Invalidate → refetch → **diff by task id** → animate entering/leaving rows. Subtle, not
flashing. This explicitly rules out `key`-remounting the table on refresh.

At Asia/Jerusalem midnight the window bounds move; `startMidnightRefresh` triggers a
refetch of both grid and counts.

---

## 8. Performance

| Risk | Mitigation |
|---|---|
| Cross-entity join width | To-ones via `include`; to-manys via batched second queries over the page window only. Never per-row. |
| Missing indexes | Slice 0 (§5.5). |
| Chip counts on every filter change | Two queries, one narrow scan (§5.2). |
| Bulk timeline writes | Chunk ~25 (§5.3). |
| Drawer remount on arrow-key nav | Debounce ~150ms (§6.7). |
| Row count growth | Server-side pagination. Virtualization stays **off** (decision #1) until measured. |

**Measurement gate for virtualization:** if a realistic page (≤100 rows, all columns
visible) exceeds ~16ms render, revisit. Not before.

---

## 9. Slices

Each is independently shippable and independently deployable (push to `main` = deploy).

Slice numbering below is the owner's, fixed on 2026-07-16, and is authoritative.
Two units of work identified during the audit are **folded in** rather than given
their own numbers — they are prerequisites, not features:

- **Table-infra extension** (sticky header/columns, multi-sort, selection,
  keyboard nav, editable cells, persisted sort) → inside Slice 2. It touches all
  seven existing `useTableColumns` consumers and is the highest-regression work in
  the project; it ships as its own commit *within* Slice 2.
- **Write-path unification** (all task mutation behind `taskService`) → inside
  Slice 4, where bulk actions first require it.

**Slice 2 inline editing deliberately reuses the existing
`PATCH /api/deals/:dealId/tasks/:taskId`.** Every grid row already carries its
`dealId`, so no new write route is needed and the project keeps exactly one task
write path until Slice 4 consolidates it. Adding `PATCH /api/tasks/:id` earlier
would create a second write path for no gain.

| Slice | Content | Status |
|---|---|---|
| **0 — Model** | Owner-value audit (blocking gate, §5.5), `Task.owner` FK `Restrict`, `AdminUser.displayName`, indexes, priority semantic-sort proven **without** `priorityRank`. | **shipped** — see §10a |
| **1 — Read API + counts** | Shared window resolver (`server/src/tasks/windows.js`, unit-tested with injected clock) + `GET /api/tasks` + `GET /api/tasks/counts`. Sortable whitelist enforced from §4.1. Bounded hydration, no N+1. No UI. | |
| **2 — Workspace UI** | First CRM tab + default CRM route, time chips, type chips, filters, grid on the extended table infra, conditional formatting, inline editing, URL + persisted state. | |
| **3 — Shared Deal drawer** | Move to `common/`, prev/next over the filtered order, keyboard, debounced switch, dirty guard, position indicator. Email + WhatsApp unchanged. | |
| **4 — Bulk actions** | `POST /api/tasks/bulk`, chunked, WhatsApp guards, partial-failure report, cancel-never-delete. Includes write-path unification. | |
| **5 — Saved views** | `SavedView` model + CRUD, personal/shared/system, seeded system views, last-selected restore, edit permissions. | |
| **6 — Realtime** | Extract shared SSE core, migrate Payroll without regression, Tasks as second consumer, row diff animations. | |
| **7 — Mobile** | Card renderer on the same canonical filter/query/state model. No separate mobile business logic. | |

Slice 1 is server-only. Slice 2 carries the table-infra regression risk. Slice 6
touches live Payroll realtime and must not regress it.

---

## 10. Open questions

**None.** Both prior questions were closed by the owner on 2026-07-15:

1. **Priority sort** — resolved: no `priorityRank`; central semantic ordering under the
   §4.4 constraints. (Decision #11.)
2. **`ownerUserId` nullability** — resolved: `onDelete: Restrict`, field stays non-null,
   retirement via `isActive`. (Decision #9.)

One **blocking gate** remains inside Slice 0, which is a verification step rather than an
open design question: the owner-value audit in §5.5. If it finds non-resolving values,
Slice 0 stops and reports.

---

## 10a. Delivery record

### Slice 0 — shipped 2026-07-15, split across two commits (accepted; do not "fix")

Slice 0 is represented by **two** commits rather than one. The owner decided on
2026-07-16 to leave them exactly as they are and not rewrite pushed history.

| Commit | Contents |
|---|---|
| `d5027c0` | *"feat(migration): Name Cleanup + Exceptional Records…"* — a concurrent migration session ran `git add .` and pushed while Slice 0 was mid-implementation, sweeping its files (`schema.prisma`, `src/tasks/priority.js`, `src/admin/displayName.js`, `src/routes/dealTasks.js`, both test files, `scripts/_tasks-owner-gate.mjs`) into an unrelated commit. |
| `7c0307a` | *"feat(crm-tasks): Slice 0 migration…"* — the migration SQL, which the sweep had left untracked. Without it, main declared an FK and a column that did not exist in the database (latent only: nothing queried them yet). This commit closed that drift forward. |

**The deployed and verified state is authoritative, not the commit shape.**
Verified against production after deploy: FK `RESTRICT` ✓ · owner relation joins ✓ ·
`displayName` → `username` fallback ✓ · Restrict blocks deleting an owner who still
has tasks (P2003, nothing deleted) ✓ · 7/7 tasks join their owner ✓ · 1389/1389
tests ✓ · production 200 ✓. The blocking pre-flight gate passed *before* the FK was
written (7 tasks, 1 distinct owner, 0 null/empty, 0 orphaned).

Do not attempt to manufacture a cleaner history for Slice 0.

### Slices 1–3 — shipped 2026-07-16, verified in production

| Slice | Commit | Notes |
|---|---|---|
| 1 — Read API + counts | `0a27165` | `GET /api/tasks`, `GET /api/tasks/counts`. Created `lib/israelDate.js` (the canonical date module — there were three "today in Israel" copies; `tours/completion.js` and `tours/slotGeneration.js` now re-export from it). |
| 2 — Workspace UI | `f95e3db` | משימות is the first CRM tab + landing route. Chips, filters, grid, inline editing, URL state. Multi-sort added to the shared table infra. |
| 3 — Shared Deal drawer | `272fa52` | `DealDrawer` moved `whatsapp/` → `common/`; prev/next over the filtered row order, PgUp/PgDn, dirty guard, 150ms debounce, position indicator. |

**Slices 4–7 are NOT started**: bulk actions, saved views, realtime, mobile cards.

#### Deviations from this plan (deliberate, with reasons)

1. **§4.4's raw-SQL `CASE` escape hatch went unused.** It was permitted, not
   required, and it buys nothing: the canonical `where` is built by Prisma, so a
   raw `ORDER BY` still needs the filtered id set first, and expressing the
   filter in SQL too would fork it into a second implementation. The id set is
   ordered in memory with the tested comparator instead — bounded by
   `PRIORITY_SORT_CAP`, with `truncated` surfaced. Dead SQL removed from
   `priority.js`. If it ever stops scaling, the answer is a Postgres STORED
   GENERATED column (derived by the DB — still not a second *writable* truth),
   never a hand-maintained rank.
2. **Inline editing of TASK TYPE is not shipped.** The existing PATCH accepts
   `text/priority/ownerUserId/notes/dueDate/dueTime` and **not** `taskTypeId`, so
   the control would have silently done nothing. Changing a type also
   re-snapshots `channel`, which for a WhatsApp task would orphan a real
   scheduled send. Both belong with the Slice 4 write-path unification.
3. **`next_week` starts `max(next Sunday, today+2)`.** On a Saturday, "מחר" IS
   next week's Sunday; the plan's literal "Sunday…Saturday" would have
   double-counted it and broken the binding mutual-exclusivity rule (decision #4).

#### Known issues (NOT introduced by this work)

- **`client` test suite is RED on main**: `nativeDialogs.scan.test.js` fails on
  `admin/tours/settings/OpenToursSettings.jsx` (L407, L476). It is a **false
  positive** — the scan's regex `(confirm|alert|prompt)\s*\(` matches English
  prose in a *comment* ("require an explicit confirm (the server also enforces
  it)") because it does not strip comments. Pre-existing since `7165e6f`, proven
  by stashing all Tasks work at the slice base. Left alone as unrelated work; the
  fix is either rewording the comment or making the scan comment-aware.
- Slice 3 did fix a **real** violation it exposed: `DealDrawer`'s clipboard
  fallback was a native `window.prompt()`, which only survived because
  `admin/whatsapp/` is outside the scan's `SCOPED_DIRS`. Moving the file into
  `common/` put it in scope. Now uses the in-system `AlertDialog`.

#### Verification gap (honest)

`GET /api/tasks` is verified as *mounted and admin-guarded* (404→401 on deploy)
and its query layer is verified directly against the production database by a
read-only probe (every sortable column executes asc+desc, multi-sort executes,
windows are disjoint over real rows, chip counts equal what the grid returns,
hydration is 2 batch queries per page). A full authenticated HTTP round-trip was
NOT performed: it needs admin credentials, and minting an admin would be a
production write and a security change. The JSON payload gets eyes-on the first
time a human opens the tab.

Note: production currently holds **7 tasks, all terminal (0 open)**, so a default
workspace legitimately renders empty until new tasks exist.

### Isolation for Slices 1–7

Built on branch **`feature/crm-tasks-workspace`** in a dedicated worktree
(`C:/Projects/gos-crm-tasks`), leaving the primary worktree to the active
migration session. `main` may advance concurrently — that is expected and is not
a stop condition. Before every merge: fetch `origin/main`, list files changed on
main since the slice base, list files changed by the slice, and report the
overlap. **Never `git add .`** — stage only the current slice's explicit files.

### Unrelated: production migration-ledger drift (NOT part of this project)

Production's migration ledger contains **`20260626160000_location_meeting_point`**,
which does not exist in `prisma/migrations/` in the repo. `prisma migrate deploy`
ignores applied migrations it does not know about, so this is not blocking and has
not affected any deploy.

**Flagged only — do not fix or remove it as part of the Tasks project.** It belongs
to a separate migration-ledger audit, which should first establish how a migration
came to be applied outside the repo before deciding whether to reconstruct the file
or record it as intentionally retired.

---

## 11. Non-goals

- Virtualization (decision #1 — revisit on measurement).
- Hard delete (decision #2 — never).
- Tags (decision #8) — no column, no model, no placeholder, no infrastructure.
- `Task.priorityRank` or any second writable representation of priority (decision #11).
- Deleting an `AdminUser` who owns tasks (decision #9 — `Restrict`; retire via `isActive`).
- "Last activity" column (§4.5).
- Sorting by customer / phone / email / operational tour (§4.2 — display-only, binding).
- A second realtime system (decision #7).
- A generic Drawer primitive. `DealDrawer` stays Deal-specific; only its location changes.
