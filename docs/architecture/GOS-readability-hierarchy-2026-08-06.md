# GOS readability audit — typography hierarchy (2026-08-06)

Not a redesign. No information was removed, no field was hidden, no data model
changed. The only thing that changed is **how much visual weight each piece of
information carries**.

## The finding

A grep across `client/src` returned **322 files** using ad-hoc font sizes, with
this distribution:

| size | occurrences |
|---|---|
| `text-[12px]` | 993 |
| `text-[13px]` | 717 |
| `text-[11px]` | 591 |
| `text-[12.5px]` | 355 |
| `text-[11.5px]` | 174 |
| `text-[13.5px]` | 101 |
| `text-[10.5px]` | 77 |

Every dense component was written independently, and they all converged on the
same three-step pattern:

```
primary    text-[13px]  text-gray-900   (often with NO font-weight at all)
secondary  text-[12px]  text-gray-500
metadata   text-[11px]  text-gray-400
```

A **1px** size step, **no weight step**, and colour doing all the work. That is
why the eye has to consciously read every row: nothing is louder than anything
else. In several components the situation was actively inverted — in the
timeline event rows the coloured kind chip (`10.5px font-semibold` on a tinted
pill) was *visually louder than the sentence describing what happened*, and in
the global search deal row the `#orderNo` — pure technical metadata — sat in
the first position on the title line, where the eye lands first.

## The rule that was introduced

**ONE scale**, declared once in [client/src/index.css](../../client/src/index.css)
under `§GOS READING HIERARCHY`, as CSS custom properties plus `@layer
components` classes. Declared in the components layer on purpose: a Tailwind
utility on the same element still wins, so `class="gos-detail text-green-700"`
recolours level 3 without forking the scale.

| class | role | size | weight | colour |
|---|---|---|---|---|
| `.gos-title` | L1 — the item's identity | 15px | 600 | gray-900 |
| `.gos-title-sm` | L1 in one-line dense rows | 13.5px | 600 | gray-900 |
| `.gos-subject` | L2 — who / which organisation | 13px | 500 | gray-700 |
| `.gos-detail` | L3 — what / when (product, date) | 12.5px | 400 | gray-500 |
| `.gos-meta` | L4 — technical metadata | 11px | 500 | gray-400 |
| `.gos-meta-key` | L4, the one findable token (author) | 11px | 700 | gray-600 |
| `.gos-body` | authored plain-text prose | 14.5px | 400 | gray-800 |
| `.gos-group-label` | label above a group of rows | 10.5px | 700 | gray-500 |

Size **and** weight **and** colour step together. L1 → L4 is a 15px/600/gray-900
→ 11px/500/gray-400 jump instead of the old 13px/400/gray-900 →
11px/400/gray-400.

Two details that do a disproportionate amount of the work:

- `.gos-meta` sets `font-variant-numeric: tabular-nums`. Dates, times and
  `#numbers` now align **column-wise between stacked rows**, so a metadata
  cluster is found by position rather than by reading it.
- `.gos-meta-key` exists because "low emphasis" and "unfindable" are not the
  same thing. The author of a note is metadata, but it is the metadata the
  operator looks for first — it keeps the metadata size and gets a much
  stronger weight.

### Rhythm tokens

| token / class | value | meaning |
|---|---|---|
| `--gos-gap-line` / `.gos-stack` | 3px | between hierarchy levels of the SAME item |
| `--gos-gap-block` / `.gos-stack-block` | 10px | between logical sections of an item |
| `.gos-meta-cluster` | flex, 6px column gap | one metadata cluster |
| `.gos-sep` | gray-300 | the `·` separator — a mark, not a character to read |

Components no longer hardcode `mt-0.5` / `space-y-1` per row. Changing the
rhythm of every dense surface in GOS is now a one-line change.

### One shared row shell

[client/src/admin/common/timeline/EventRowShell.jsx](../../client/src/admin/common/timeline/EventRowShell.jsx)
replaces seven hand-rolled copies of the same markup
(`rounded-xl border border-gray-200 bg-white px-3 py-2` → icon → chip →
statement → stamp). It owns the hierarchy for the whole history feed: the
statement carries L1 from the shell, and `EventStamp` renders WHO
(`.gos-meta-key`) then WHEN (`.gos-meta`, tabular) at the trailing edge, in
that order, on every event kind.

## Components changed

### Part 1 — note cards

`admin/common/timeline/NoteCard.jsx`

- The header became an **identity band** with its own hairline separating it
  from the content. Before, the author + timestamp were a single undifferentiated
  11px grey run jammed against the action buttons at the trailing edge.
- **WHO moved to the leading (right, RTL) edge** — where the eye starts —
  as `.gos-meta-key`. `ActorTag` keeps the typed origin badge (API / אוטומציה /
  מערכת / ייבוא) in front of the name, so a non-human origin is still explicit.
- **WHEN stays at the trailing edge** as `TimeTag`, with date and time as two
  separate tabular tokens instead of one concatenated string — stamps now line
  up down a stack of notes.
- Note body: `.gos-body` for the collapsed preview; the expanded body still
  goes through the canonical `.gos-prose` renderer (project rule §16 — untouched).
- Comment rows: body at `.gos-subject`, stamp as one trailing
  `.gos-meta-cluster`.

Nothing was dropped: badge, author, source label, aggregated-source chip, pin,
date, time, and the "נערך" flag all still render.

### Part 2 — global search results

`shell/search/SearchResultRow.jsx`, `shell/search/GlobalSearch.jsx`

Every row type was restructured onto the four levels:

| | L1 | L2 | L3 | L4 |
|---|---|---|---|---|
| Deal | title + status badge | organisation · unit · contact | product/variant · tour date | `#orderNo` + match reasons |
| Contact | full name (+ EN, + deal count) | organisation · unit | phone · email | recent deals + reasons |
| Organisation | name + type | units | deal count · contact count | reasons |
| Task | title + type | parent deal title | due date/time · owner | `#orderNo` + reasons |
| Timeline | excerpt (`.gos-body`) | parent record | author | `#orderNo` + reasons |

- The **deal number moved off the title line** into the metadata line. It is
  still fully visible on every row and still searchable — it is simply no longer
  the first thing the eye hits when scanning for a deal by name.
- Status badges got **louder**, not quieter: pill shape, `ring-1`, semibold.
  Type/count chips were deliberately separated into a quieter `CountChip` so
  status is the only thing in the row that reads as a state.
- A **hairline between results** (`border-t-gray-100`). Without it, four
  stacked multi-line rows read as one paragraph no matter how good the
  typography inside each one is.
- Group headers use `.gos-group-label` on a darker strip.

### Other components brought onto the scale

| component | what changed |
|---|---|
| `timeline/EventRowShell.jsx` | **new** — the shared shell + `EventChip` + `EventStamp` |
| `timeline/ChangeEventRow.jsx` | on the shell; the **new** value now inherits L1 while the field name and old value drop to L3 — the answer is bold, the context is grey. Multi-change lists get a separator + `.gos-stack` |
| `timeline/CommunicationEventRow.jsx` | on the shell (incl. the amber auto-send-failed variant via `tone="warning"`) |
| `timeline/QuoteEventRow.jsx` | on the shell; the "פתח ↗" link became a real trailing action instead of inline text |
| `timeline/TourEventRow.jsx` | on the shell |
| `timeline/AccountingEventRow.jsx` | levels applied to its own multi-line card shell; the amount is no longer de-emphasised inside the title; stamp split into a tabular timestamp + provenance |
| `deals/tasks/TaskEventRow.jsx` | on the shell |
| `deals/files/FileEventRow.jsx` | on the shell |
| `email/EmailEventRow.jsx` | on the shell; inbound sender and outbound sender now occupy the same actor slot |
| `email/EmailThreadRow.jsx` | subject L1 (unread still adds bold on top), counterparties L2, snippet L3, timestamp L4 |
| `control/IssueCard.jsx` | issue title L1, explanation `.gos-body`, module chip + detected-at recede to metadata |
| `crm/tasks/TaskCards.jsx` | title L1, customer L2, due date L3, `#orderNo` + owner L4 |

## Audited and deliberately NOT changed

- **`admin/whatsapp/ChatListRow.jsx`** — the WhatsApp conversation list already
  has a real hierarchy (avatar, bold-vs-light unread state, emerald count
  bubble, distinct name/preview/meta rows). It is the one dense component in
  GOS that was already doing this correctly. Changing it would have made the
  inbox look different from WhatsApp Desktop for no gain.
- **Data grids** (`common/tableColumns.jsx`, `crm/tasks/columns.jsx`,
  Deals list, Contacts list) — a table already carries its hierarchy in its
  column headers and alignment; the "everything reads as one paragraph" problem
  is specific to multi-line rows and cards. Applying card levels to cells would
  fight the grid.
- **`admin/queue/QueueList.jsx`**, **`admin/collection/CollectionReviewPage.jsx`**
  and the Builder rows — same class of problem, not yet converted. They are the
  obvious next batch and now have a scale to convert *to* rather than a new one
  to invent.

## Rule for new work

New dense-information surfaces use `.gos-title` / `.gos-subject` /
`.gos-detail` / `.gos-meta` and `.gos-stack`. Introducing a second typography
scale — or reaching for `text-[13px] text-gray-500` again — is a violation of
this rule. Timeline event rows go through `EventRowShell`, never hand-rolled.
