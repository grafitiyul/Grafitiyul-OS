# Guide Portal — English language support

**Date:** 2026-08-04
**Status:** implemented, server + client tests green, verified against production data.

The Guide Portal is language-aware. A staff member whose canonical language is
English sees the entire portal in English; a Hebrew staff member sees exactly
what they saw before. There is **one** language resolver, **one** translation
registry, and **zero** machine translation anywhere in the path.

---

## 1. The language decision

`PersonProfile.preferredLanguage` (`he | en`) is the canonical staff language
field. It is resolved **once, on the server**, through the existing shared
resolver `shared/staffName.mjs → staffLanguage()`, in
`server/src/tours/guidePortal/access.js → resolveGuidePortalAccess()`.

Every portal payload carries that one value as `language`. The client
distributes it through `client/src/portal/PortalLanguage.jsx`
(`PortalLanguageProvider` / `usePortalLanguage`), and **no screen makes a
language decision of its own** — no `navigator.language`, no cookie, no URL
parameter, no per-page state.

Two portal surfaces render outside the shell (the full-screen tour gallery and
the install page); both read the same server-resolved value off their own
payload rather than deriving one.

Direction comes from the same value, so wording and text direction cannot
disagree: Hebrew → RTL, English → LTR.

---

## 2. What was audited

Every visible string in the portal was classified. Screens covered: shell
header/nav/menu, upcoming tours, past tours (+ filters), tour detail (header,
team, components, workshop locations, parallel tours, participants, held
reservations, summary section), tour gallery, procedures (+ correction prompt),
pay, profile, training list/tour/station, install page, questionnaire fill
dialog, and every shared component those screens render.

| Class | Meaning | Treatment |
|---|---|---|
| **A** Static UI | buttons, titles, labels, empty states, errors, badges, nav, status words, aria labels | Translated once in the registry |
| **B** Derived, bilingual data | product, city, activity component, ticket type, contact name, staff name, questionnaire content | Resolved from the existing He/En columns |
| **C** Dynamic business values | customer/organization names, phones, addresses, free text, guide notes, office notes, group names | Never translated — shown verbatim |
| **D** No English source | workshop locations, training content, payroll names, procedure titles | Shown verbatim + reported (§6) |

---

## 3. Static UI — one registry

`client/src/portal/i18n.js` holds every static portal string in both languages.
Rules enforced:

* no inline user-visible literal anywhere in the portal
* no `lang === 'en' ? … : …` ternaries in screens
* no duplicated literals — screens read `t.<group>.<key>`
* the registry contains **zero** business data

`client/src/portal/i18n.test.js` is the structural guard: it compares the shape
of the two language trees, so a string added to one language and forgotten in
the other fails the build automatically — no one has to remember to add a test.

Shared components (rendered by both admin and portal) take their words as
props with the **existing Hebrew defaults**, so every admin caller is unchanged:
`ParticipantCardView`, `ProductBreakdown`, `FormActionButton`,
`QuestionnaireFillDialog`, `Dialog`, `GalleryGrid`, `GalleryLightbox`,
`UploadQueuePanel`, `BankDetailsFields`, `AvatarCropDialog`,
`StationContentView`.

---

## 4. Dynamic data — existing English connected

`shared/bilingualText.mjs` is the ONE resolver for He/En catalog pairs. It only
**chooses** between two values a human already authored.

Now resolving English where the data exists:

| Value | Source | Where it shows |
|---|---|---|
| Product name | `Product.nameEn` | tour cards, tour detail, gallery title, breakdown |
| City / location | `Location.nameEn` | tour cards, tour detail, parallel tours |
| Activity component | `ActivityComponent.nameEn` | component chips, workshop rows |
| Ticket type | `TicketType.nameEn` (live by `ticketTypeId`) | participants breakdown |
| Card / product line | `PriceRule → Product.nameEn` (live by `cardGroupId`) | participants breakdown |
| Customer name | `Contact.firstNameEn/lastNameEn` | participant cards, gallery title |
| Staff name (self) | `PersonProfile.firstNameEn/lastNameEn` via `staffName()` | header, profile |
| Staff name (team) | same, via `resolveStaffDisplayName(row, lang)` | tour-detail team |
| Tour summary form | questionnaire engine `resolveActorLanguage` | tour detail |
| Coordination form | new `actorLanguage` on `startSubmission` | participant cards |
| Role / activity / tour-language labels | enum → registry | chips everywhere |

Two notes worth keeping:

* **Frozen ticket snapshots.** `TicketRegistration.ticketBreakdown` froze its
  labels in Hebrew at purchase time and must stay frozen (historical record).
  The snapshot also froze the stable IDs, so for an English reader the CATALOG
  name is re-resolved live by id (`localizeParticipantBreakdown`). The snapshot
  is never rewritten.
* **Parallel tours** previously rendered in the *other tour's customer*
  language. In the portal they now follow the reading guide (`readerLang`);
  admin surfaces are untouched.

Enums never travel as rendered text any more — the DTOs ship keys
(`badgeKey: 'not_final'`, `lifecycleStage`, `badge.key`) and the client owns the
wording in both languages. Names ship under neutral keys (`name`, not `nameHe`),
already resolved, so the client never picks a language.

---

## 5. No fake fallbacks

Where English does not exist, the value is shown **exactly as the canonical
resolver defines**: the authored Hebrew value, unchanged. Explicitly **not**
done: no translation in code, no AI, no invented English, no blanking.

The fallback rule is the one `shared/staffName.mjs` already applied and is now
shared by `bilingualText.mjs`: *requested language → the other language →
nothing*. Falling back to the other language is deliberate — a guide seeing the
Hebrew product name still knows which tour they are on; a nameless card is
unusable in the field. **Every such fallback is a data gap, listed below.**

One deliberate product decision: the guide's own **editable** name field
(`editableName`) stays bound to the legacy `PersonRef.displayName`, separate
from the displayed name, so a portal edit can never silently overwrite the
management-owned bilingual name pair.

---

## 6. Remaining gaps — real production numbers

Produced by `server/scripts/report-portal-english-gaps.mjs` (read-only) against
production on 2026-08-04. Re-run any time:

```
railway run node server/scripts/report-portal-english-gaps.mjs
```

**English-language guides with portal access: 1 of 19 (Rafael Villela).**

### A. Fillable today — the English column exists and is empty

| Entity | Field | Screen | Impact | Missing |
|---|---|---|---|---|
| Product | `nameEn` | tour cards, tour detail, gallery, breakdown | the tour name shows in Hebrew | **1 of 10** (`בר מצווה`) |
| ActivityComponent | `nameEn` | tour detail — component chips, workshop rows | chips show in Hebrew | **4 of 4** (סיור גרפיטי, סדנת תקליטים, סדנת ציור קיר, טעימת אוכל) |
| PersonProfile | `firstNameEn` / `lastNameEn` | header, profile, tour-detail team | staff names show in Hebrew | **20 of 21** |
| Contact | `firstNameEn` / `lastNameEn` | participant cards, gallery title | customer names show in Hebrew | **19,816 of 20,770** |

Already complete, nothing to do: **Location.nameEn**, **TicketType.nameEn**, and
both active **QuestionnaireTemplates** (tour summary + coordination already
declare `en`).

### B. Needs a schema decision — no English column exists anywhere

| Entity | Fields | Screen | Impact | Records |
|---|---|---|---|---|
| WorkshopLocation | `nameHe`, `address`, `instructions` | tour detail — workshop locations | **operationally significant** — this is where the guide is told where to go and how to get in | 6 |
| Tour / TourStation / TourContentBlock | `titleHe`, `descriptionHe`, `bodyHe` | training list + station | the whole training-content domain is single-language | 568 (4 tours, 75 stations, 489 blocks) |
| PayrollComponent / GeneralActivityType / PayrollActivity | `nameHe`, `unitLabel*He`, `titleHe` | pay | line names, unit nouns and activity titles are Hebrew inside English pay cards | 16 |
| Flow (procedures) | `title`, `description` | procedures | procedure titles/descriptions are Hebrew; the runtime content likewise | 1 published |

Each row in B needs an owner decision (add the column + the admin field) before
any translation work can start. **None of these is fixed in code.**

### Recommended order

1. **ActivityComponent.nameEn** — 4 records, visible on every tour detail.
2. **Product.nameEn** — 1 record.
3. **PersonProfile English names** — 20 records; makes the team list coherent.
4. **WorkshopLocation** — schema decision; the highest operational risk in B.
5. Contact names — large but low urgency; a Latin-script customer name is
   often already present in the Hebrew fields.

---

## 7. Verification

* Server suite: **3518 tests, 0 failures.**
* Portal client tests: **36 tests, 0 failures** (incl. the new registry guard and
  the DTO language tests).
* Client build: clean.
* **Production data:** the same real tour
  (`6881e558-71aa-40c3-aa5f-95684ff94a63`) resolves through the real access
  resolver + DTO as
  `סיור וסדנת גרפיטי · תל אביב - פלורנטין` for a Hebrew guide and
  `Graffiti Tour & Workshop · Tel Aviv - Florentine` for Rafael Villela.

Still to do by hand after deploy: open the portal as Rafael Villela and as a
Hebrew guide on a phone and walk every screen. The automated checks cover the
resolution and the string coverage, not the visual RTL/LTR feel.
