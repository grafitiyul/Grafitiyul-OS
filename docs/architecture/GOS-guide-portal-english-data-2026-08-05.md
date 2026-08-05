# Guide Portal — English data completion

**Date:** 2026-08-05
**Status:** schema, resolution, admin editing and tests shipped and deployed.
Only **content entry** remains.

Follows [GOS-guide-portal-english-2026-08-04.md](./GOS-guide-portal-english-2026-08-04.md),
which made the portal's *chrome* bilingual. This round closes the *data* side.

---

## 1. Complete audited field inventory

Every dynamic value the Guide Portal renders, by surface. `A` = English existed
and was populated · `B` = English column existed, data missing · `C` = no English
column (added this round) · `D` = intentionally language-neutral.

### Tour cards / upcoming / past

| Entity | Hebrew field | English field | Class | Screen |
|---|---|---|---|---|
| Product | `nameHe` | `nameEn` | **B** | cards, detail, gallery, breakdown |
| Location | `nameHe` | `nameEn` | **A** | cards, detail, parallel tours |
| TourEvent | `date`, `startTime`, `durationHours` | — | **D** | cards, detail |
| TourEvent | `kind`, `tourLanguage`, assignment `role` | enum → registry | **A** | chips |
| TourEvent | `notes` | — | **D** (operational free text) | detail header |

### Tour detail

| Entity | Hebrew field | English field | Class | Screen |
|---|---|---|---|---|
| ActivityComponent | `nameHe` | `nameEn` | **B** | component chips, workshop rows |
| WorkshopLocation | `nameHe` | **`nameEn`** | **C → added** | workshop locations |
| WorkshopLocation | `address` | **`addressEn`** | **C → added** | workshop locations |
| WorkshopLocation | `instructions` | **`instructionsEn`** | **C → added** | workshop locations |
| Contact | `firstNameHe`/`lastNameHe` | `firstNameEn`/`lastNameEn` | **B** | participant cards |
| PersonProfile | `firstNameHe`/`lastNameHe` | `firstNameEn`/`lastNameEn` | **B** | header, profile, team |
| TicketType | `nameHe` | `nameEn` | **A** | participants breakdown |
| PriceRule → Product | `nameHe` | `nameEn` | **B** | breakdown card titles |
| Organization / OrganizationUnit | `name` | — | **D** | participant cards |
| Deal | `groupName`, `customerInfo` | — | **D** (customer text) | participants |
| Contact | phone, email | — | **D** | participant cards |
| QuestionnaireTemplate/Version | localized JSON | same JSON | **A** | summary + coordination forms |

### Training content

| Entity | Hebrew field | English field | Class |
|---|---|---|---|
| Tour | `titleHe`, `descriptionHe` | **`titleEn`, `descriptionEn`** | **C → added** |
| TourStation | `titleHe`, `descriptionHe`, `heroImageTitle` | **`titleEn`, `descriptionEn`, `heroImageTitleEn`** | **C → added** |
| TourContentBlock | `titleHe`, `bodyHe` | **`titleEn`, `bodyEn`** | **C → added** |
| TourBlockAsset | `titleHe` | **`titleEn`** | **C → added** |
| TourStation | `kind` | enum → registry | **A** |
| TourStationNote / block `internalNote` | — | — | never shipped to guides |

### Pay

| Entity | Hebrew field | English field | Class |
|---|---|---|---|
| PayrollComponent | `nameHe` | **`nameEn`** | **C → added** |
| GeneralActivityType | `nameHe`, `unitLabelSingularHe`, `unitLabelPluralHe` | **`nameEn`, `unitLabelSingularEn`, `unitLabelPluralEn`** | **C → added** |
| GeneralActivity | `titleHe` | **`titleEn`** | **C → added** (snapshot) |
| PayrollActivity | `titleHe` | **`titleEn`** | **C → added** (snapshot) |
| PayrollEntryLine | `componentNameHe` (frozen) | resolved live by `componentId` | **C → solved without a column** |
| PayrollEntry | `officeNote`, conversation text | — | **D** (office free text) |
| amounts, VAT rate, dates | — | — | **D** |

### Procedures · Gallery · Profile

| Entity | Hebrew field | English field | Class |
|---|---|---|---|
| Flow | `title`, `description` | **`titleEn`, `descriptionEn`** | **C → added** |
| FlowAnswer | `adminComment` | — | **D** (reviewer free text) |
| TourGallery title | Product + customer | resolved | **A/B/D** |
| TourMedia | `originalFileName`, `uploadedByLabel` | — | **D** |
| PersonRef | `lifecycleHint` | enum → registry | **A** |
| Bank / branch names | catalog | — | **D** |

### Audited and deliberately NOT in scope

* `Location.meetingPointHe/En`, `marketingDescHe/En`, `logisticsHe/En` — already
  bilingual, **not rendered in the portal**. No work needed; if a future slice
  surfaces them, they resolve through the same picker.
* `ProductVariant` — carries no display text (only `durationHours`); tour
  identity is product · location.
* **Procedure runtime** (`/attempt/:id` — ContentItem, QuestionItem, options):
  a separate module reached *from* the portal. Its content is single-language.
  Making the learning module bilingual is its own project and is **not** covered
  here — the procedures **feed** (titles/descriptions) is.

---

## 2. Schema fields added

One additive migration, `20261004090000_guide_portal_english_fields`:
**19 nullable columns**, nothing renamed, dropped or backfilled, and no Hebrew
copied into an English column.

```
WorkshopLocation     nameEn, addressEn, instructionsEn
Tour                 titleEn, descriptionEn
TourStation          titleEn, descriptionEn, heroImageTitleEn
TourContentBlock     titleEn, bodyEn
TourBlockAsset       titleEn
PayrollComponent     nameEn
GeneralActivityType  nameEn, unitLabelSingularEn, unitLabelPluralEn
GeneralActivity      titleEn
PayrollActivity      titleEn
Flow                 titleEn, descriptionEn
```

`WorkshopLocation.address/instructions` and `Flow.title/description` keep their
unsuffixed names (they predate the convention); `pairFrom()` reads those pairs so
the migration stayed additive.

`TourContentBlock.bodyEn` is **nullable** while `bodyHe` defaults to `''` — that
is deliberate, so "no English written yet" stays distinguishable from
"deliberately empty".

---

## 3. Admin screens updated

No separate translation admin — English editing lives on the screen that already
owns each entity.

| Screen | What became bilingual |
|---|---|
| Settings → Tours → מיקומי סדנה | name, address, arrival/parking/setup instructions + a **"חסר אנגלית"** chip on rows with no English |
| Tour content → tour dialog | tour title, description |
| Tour content → station editor | station title, description |
| Tour content → part editor | part title + **rich body** (`format="html"`) |
| Settings → Finance → רכיבי שכר | component name |
| Settings → Finance → סוגי תוספת כללית | type name + English unit nouns (singular/plural) |
| Procedures → flow editor | flow title (English, in the header) |

Two shared pieces do the work:

* **`BilingualField`** (new) — the canonical He/En pair: side-by-side on lg+,
  stacked below; Hebrew RTL/right-aligned, **English LTR/left-aligned**; the
  shared `TranslateButton` fills the English side for review and never saves.
* **`catalogKit`** — its existing `label`/`labelEn` pair gained the
  `TranslateButton`, so every catalog settings screen got it at once.

No autosave was introduced. Each screen keeps the save behaviour it already had
(the flow header has always autosaved its title, so the English twin matches it).

---

## 4. Guide Portal resolution

Everything goes through the **one** resolver, `shared/bilingualText.mjs` — no new
resolver was created.

* `catalogName` / `catalogTitle` — `nameHe|nameEn`, `titleHe|titleEn`
* `pairFrom(row, heField, enField, lang)` — the unsuffixed-Hebrew models
* `contactFullName` — the four contact name columns
* `pickBilingual` — everything else

Two resolution decisions worth remembering:

1. **Payroll line names resolve LIVE from the catalog by `componentId`**, not
   from a new snapshot column. Editing a component's English name therefore fixes
   every *past* payslip's English without rewriting a single frozen Hebrew
   snapshot.
2. **Title snapshots store English only when English exists.** `tourTitleEn()`
   returns `null` when neither the product nor the city has English — never a
   Hebrew string sitting in an English column.

**Missing English:** the authored value still renders. A tour card with no name
is unusable in the field, so blanking would be worse than honest. Every such case
is a tracked DATA gap — `isBilingualFallback()` makes it detectable in code, the
admin shows it, and the report lists it per record. Nothing is machine-translated
at runtime and nothing is special-cased per record.

**Hebrew guides are unchanged** — pinned by regression tests, including that an
absent/unknown language behaves exactly like `he`.

---

## 5. Tests

`server/src/tours/guidePortal/portalEnglish.test.js` — 16 tests:

1. English guide receives English managed data (incl. workshop name/address/instructions)
2. Hebrew guide receives Hebrew managed data
3. Absent/unknown language ≡ Hebrew
4. Missing English keeps the authored value — never blank, never invented
5. The fallback is *detectable* (`isBilingualFallback`), so it is never silent
6. The picker never mutates or copies into the English column
7. Language-neutral values pass through byte-identically in both languages
8. Every new English column exists in the schema
9. Every new English column is read on the portal server path
10. Every bilingual admin write path accepts the English twin
11. The English snapshot never copies Hebrew
12. Pay: live catalog English + frozen Hebrew untouched
13. No portal renderer hardcodes a business translation
14. The string registry holds no business data
15/16. The shared resolver's contract across all four shapes

Plus `client/src/portal/i18n.test.js` (structural He/En parity) and the updated
`payText` tests for `"per <noun>"` vs `"ל<noun>"`.

**Server 3672 pass · portal client 38 pass · client build clean.**

---

## 6. Production data worklist

Regenerate any time:

```
railway run node server/scripts/report-portal-english-gaps.mjs          # per record
railway run node server/scripts/report-portal-english-gaps.mjs --counts # summary
railway run node server/scripts/report-portal-english-gaps.mjs --json   # machine-readable
```

Each row prints entity, record id, the Hebrew value an English guide currently
sees, the empty field, the screen, the impact, and the **admin URL to fix it**.

See §7 below for the live numbers captured at deploy time.

---

## 7. Production verification — 2026-08-05

Migration `20261004090000_guide_portal_english_fields` applied at
**2026-08-05T11:51:15Z**; 19 English columns live.

`server/scripts/verify-portal-language.mjs` walks **every** portal endpoint over
the live HTTPS API with each guide's real token and reports what they actually
receive:

```
railway run node server/scripts/verify-portal-language.mjs [--values]
```

### Result

| | אבי אטינגר (Hebrew) | Rafael Villela (English) |
|---|---|---|
| stored → resolved | `he` → `he` | `en` → `en` |
| endpoints (home, upcoming, past, procedures, training, pay, profile) | all **200** | all **200** |
| business values seen | 29 (latin 2 / **hebrew 27**) | 29 (**latin 17** / hebrew 12) |

Same data, same endpoints — 17 values flip to English for Rafael and the Hebrew
guide is completely unchanged.

On Rafael's richest real tour (`9024e3fd…`, 2026-08-16):

```
variantName : Graffiti Tour & Workshop · Tel Aviv - Florentine
location    : Tel Aviv - Florentine
team        : Rafael Villela
participants: Anat Lazarov @ Zontravel
components  : סיור גרפיטי | סדנת תקליטים      ← ActivityComponent.nameEn empty
```

The workshop-location path (no production tour has one assigned right now) was
verified against a **real** `WorkshopLocation` row through the real DTO:

```
en, as stored          : {"name":"מחוץ לסטודיו","address":null,"instructions":null}
en, with English filled: {"name":"Studio roof","address":"1 Ha-Am St.","instructions":"Lift to floor 4"}
```

### Every Hebrew value Rafael still sees

Each one maps 1:1 to a content row in §6 — there is no code path left that
forces Hebrew:

| Screen · field | Why |
|---|---|
| Tour detail · component.name | `ActivityComponent.nameEn` empty (4 records) |
| Procedures · task.title | `Flow.titleEn` empty (1 record) |
| Training · tour.title / station.title | `Tour.titleEn` (4) / `TourStation.titleEn` (75) empty |
| Training station · part.title / media.title | `TourContentBlock.titleEn` (487) / `TourBlockAsset.titleEn` (156) empty |

### Remaining untranslated records by entity

| Entity | Missing | Of |
|---|---|---|
| Product | 1 | 10 |
| Flow (procedure) | 1 | 1 |
| ActivityComponent | 4 | 4 |
| Tour (training set) | 4 | 4 |
| WorkshopLocation | 6 | 6 |
| GeneralActivityType | 6 | 6 |
| PayrollComponent | 9 | 9 |
| PersonProfile (staff names) | 20 | 21 |
| TourStation | 75 | 75 |
| TourBlockAsset | 156 | 156 |
| TourContentBlock | 487 | 487 |
| **Total (excluding contacts)** | **769** | |
| Contact (customer names) | 19,806 | 20,783 |

Location, TicketType and both active questionnaire templates are **already
complete** — nothing to do.

### Suggested order

1. **WorkshopLocation** (6) — highest operational risk: where to go, the address, how to get in.
2. **ActivityComponent** (4) + **Product** (1) — visible on every tour screen.
3. **PayrollComponent** (9) + **GeneralActivityType** (6) — fixes past payslips too, since line names resolve live.
4. **PersonProfile** (20) — makes the team list and the header coherent.
5. **Flow** (1).
6. **Training content** (722) — the bulk; the station body is the real work.
7. **Contacts** — opportunistically, as they come up. A Latin name is often already in the Hebrew fields.

### Two data observations (pre-existing, not introduced here)

* Some `TourContentBlock.titleHe` values are literally `build_up` /
  `curiosity_hook` — role-hint keys that leaked in during the content import.
  They render identically for both languages.
* `Flow.description` has **no admin editor in either language**, so its English
  twin has no UI either. Add both together if the field is ever adopted.

---

## 8. Is the Guide Portal structurally ready for English?

**Yes.** Every business value the portal renders now has a canonical English
field, an admin editor on its own screen, and resolution through the one shared
resolver — verified live against production for both a Hebrew and an English
guide, with all seven endpoints healthy.

The only thing standing between today and a fully English portal is **content
entry**: the 769 records in §7, none of which requires code.

Two honest caveats:

* Where English is missing the portal still shows the authored Hebrew rather
  than a blank. That is deliberate — an unnamed tour card is unusable in the
  field — and every instance is tracked, operator-visible and listed per record.
* The **procedure runtime** (`/attempt/:id`) is a separate module reached from
  the portal and remains single-language. Making the learning module bilingual
  is its own project.

Not yet done: a human pass on a phone. The automated checks cover resolution,
string coverage and payload content — not the visual RTL/LTR feel.
