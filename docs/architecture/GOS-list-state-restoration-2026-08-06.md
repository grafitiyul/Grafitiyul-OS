# Durable list state — "return me to where I was"

**Date:** 2026-08-06
**Scope:** every admin list/table screen + the record pages they open.

## 1. The problem

An operator on page 4 of דילים opened a deal, pressed Back, and landed on
page 1 at the top of the list, with the sort reset.

Root cause — every list held its position in plain React state:

```js
const [page, setPage] = useState(1);          // ← lost on unmount
const [sort, setSort] = useState({ … });      // ← lost on unmount
useEffect(() => { setPage(1); }, [filters]);  // ← and reset again on mount
```

Filters were persisted (localStorage), but **page, sort and scroll were not**,
and nothing about the operator's position was in the URL. Navigating to a
record unmounts the list; coming back constructs a brand-new one at its
defaults. The `useEffect(() => setPage(1), …)` made it unrecoverable even if
the page had been remembered — it fires on mount too.

## 2. The architecture

Three small shared modules, one rule each. Two are pure (no React), so the
rules are unit-tested rather than clicked.

| File | Concern |
|---|---|
| `client/src/admin/common/listState.js` | **The URL owns durable list state.** Encode/decode page · search · filters · sort · view ⇄ query string, with per-module "sticky" defaults in localStorage. Pure. |
| `client/src/admin/common/listNav.js` | **Scroll memory + navigation origin.** Scroll offset per exact list URL in sessionStorage; where a record's Back button should actually go. Pure. |
| `client/src/admin/common/useListState.js` | The React/router bindings: `useListState`, `useListScrollRestore`, `useListOrigin`, `useListReturn`. |

### 2.1 URL is the primary owner

A list declares its fields once:

```js
const LIST_FIELDS = {
  q:      { default: '',    sticky: true },
  status: { default: 'all', sticky: true },
  sort:   { type: 'sort', default: { key: 'updatedAt', dir: 'desc' }, sticky: true },
  page:   { type: 'int',  default: 1 },
};
const list = useListState({ key: 'deals', fields: LIST_FIELDS });
```

Consequences, all covered by tests:

* Back returns to the exact list URL → the list simply re-reads it.
* Refresh reproduces the list.
* A pasted link reproduces what the sender saw.
* A second tab has its own URL and its own sessionStorage — it cannot move the
  first tab.
* Params are scoped to a pathname, so one list cannot leak into another. There
  is **no global mutable table state**.
* Default values are omitted from the URL, so links stay short.
* Query params this list does not declare are preserved untouched.

**Page reset lives in the setter, not in an effect.** `list.set({...})` returns
to page 1 whenever it touches anything other than the page; `list.setPage(n)`
does not. This is the specific change that makes restoration possible.

**History semantics:** filter/search/sort changes `replace` (a refinement of the
same view — typing must not fill the history); a page change `push`es, so
browser Back walks back a page.

### 2.2 Sticky filters vs deep links

localStorage keeps the last filters the operator *deliberately chose* per
module, so returning tomorrow lands in the same workspace. Sticky values seed
the state **only on a first mount whose URL carries no list params at all** — a
deep link is never contaminated by someone else's preferences. After seeding,
the URL is canonicalised (replace) so the address bar shows what is on screen.

### 2.3 Scroll

The URL restores *which* rows are shown; it cannot restore how far down them
the operator was. `useListScrollRestore(ready)` returns a ref you attach to the
list root; it discovers the real scrolling ancestor (the admin shell scrolls
`<main>`, but CRM/People/Finance layouts add their own `overflow-y-auto`
wrapper), records the offset continuously, and restores it once the rows are on
screen — keyed by the full list URL, so a filter change correctly starts at the
top. sessionStorage, so a second tab is isolated.

### 2.4 Back-button precedence

Required precedence, implemented in `resolveListReturn`:

1. a valid in-app origin (`/admin/*`, handed over as router `state` when a list
   opens a record) → **history back**, which restores URL *and* scroll;
2. otherwise the canonical list root.

`<BackButton {...useListReturn('/admin/crm/deals', 'חזרה לדילים')} />`. The
control still renders a real `href`, so ctrl/⌘/middle-click opens the list in a
new tab and leaves this one alone. `PersonProfile` previously called
`window.history.back()` blindly — which walked *out of the app* when the profile
was opened from a pasted link; that is fixed.

### 2.5 "עבור לסוף"

Added to the shared `Pager`, so every server-paginated list gets it at once:
first · prev · `n / N` · next · **last**, each with a Hebrew tooltip and
`aria-label`. The last-page button sets the page straight to the computed last
page → **exactly one fetch**, no walking through intermediate pages, and the
active search/filters/sort are untouched because they live in the URL. Both
jump controls disable at their end.

## 3. Inventory

### Migrated to the shared contract

| Screen | URL-owned state | Scroll restore | Origin → record | Last-page |
|---|---|---|---|---|
| דילים `DealsList` | search, status, stage, org, min, max, sort, page | ✅ | ✅ | ✅ |
| אנשי קשר `ContactsList` | search, page | ✅ | ✅ | ✅ |
| ארגונים `OrganizationsList` | search, page | ✅ | ✅ | ✅ |
| צוות `PeopleList` | search, lifecycle, access, page | ✅ | ✅ | numbered pager (see below) |
| גבייה `CollectionPage` | search, status, queue, sort | ✅ | ✅ | n/a (single page) |
| בקרה `ControlPage` | category tab | ✅ | ✅ | n/a |
| סיורים `ToursPage` | sort | ✅ | n/a (nested modal) | n/a |

Record pages using `useListReturn`: `DealDetail` (a Back control was added — it
had none), `ContactDetail`, `OrganizationDetail`, `PersonProfile`.

### Intentionally excluded — and why

| Screen | Why |
|---|---|
| משימות `TasksWorkspace` | **Already URL-owned** by its own tested contract (`taskQuery` + SavedViews), and it opens deals in an in-page drawer, so the list never unmounts. Re-plumbing it would be churn with no behaviour change. |
| `ToursPage` filters/tabs | Search, kind, status set, advanced tree and view tab already persist through `tours.filters.v1` + the unit-tested `viewPrefs.js` (which exists because of an earlier calendar-anchor regression). The tour page opens as a nested route **on top of** the list, so the list never unmounts. Only `sort` was genuinely lost — that is what moved to the URL. |
| Advanced filter TREES (Tours, Collection) | Declared `url: false`. Serialising a whole boolean condition tree into the query string produces unreadable, unshareable links; they keep their existing per-browser persistence. |
| `DeliveryLogDialog` | A dialog, not a screen. It has no URL of its own and is destroyed with its parent. Gets the new first/last pager controls for free. |
| `CommunicationPage`, `AdminReportDeliveries` | Read-only log tables inside settings; they do not navigate to records, so there is nothing to return from. Get the new pager controls for free. |
| `ReservationsList`, `QueuePage` | Small single-page lists with one status filter and no pagination — nothing durable to lose. |

## 4. Tests

* `client/src/admin/common/listState.test.js` — 22 pure tests: precedence
  (URL → sticky → default), explicit-empty params, garbage input, sort
  round-trip, `url:false`, deep-link isolation, foreign-param preservation,
  page-reset rules, sticky scoping (no cross-module leaks), corrupted-store
  degradation, page-count/clamp maths, scroll-store keying + bounding,
  `findScrollParent`, and the back-origin precedence incl. refusing a
  non-admin origin.
* `client/src/admin/common/listRestore.smoke.test.js` — 14 tests that **render
  the real screens** (only the network is faked): page 4 restored, filters +
  sort surviving a remount at the same URL, deep link not contaminated,
  remembered workspace restored + canonicalised, "עבור לסוף" in one fetch,
  jump-controls keeping filters, disabled at the ends, filter change → page 1,
  fast typing not dropped by the URL round-trip, Contacts behaving identically,
  no leak between modules, scroll recorded/restored/reset, and the record-origin
  fallback.

Rendering (rather than only unit-testing the hook) is deliberate: the original
regression was an innocent-looking `useEffect(() => setPage(1), [filters])` that
no pure test could have caught.

## 5. Known behaviour change

The legacy per-module filter keys (`deals.filters.v1`, `collection.filters.v1`'s
search/status/queue) are superseded by the namespaced `gos.list.<module>.v2`
store. On first load after this deploy an operator's remembered filters reset
once to their defaults; every subsequent choice sticks. Column layouts, page
size and the advanced filter trees are untouched.
