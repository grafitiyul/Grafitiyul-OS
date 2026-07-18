# GOS Migration — Content Mapping Matrix (enrichment pass, 2026-07-21)

Field-by-field disposition of every relevant source field, measured against
Snapshot #1 (`snap-20260714T125052Z-aaaa`) production data. Decision order:
existing canonical field → related canonical entity → timeline/note model →
structured legacy evidence (card) → new field only if reusable → explicit
exclusion. Population counts are real (audit script
`server/scripts/migration/audit-enrichment-sources.mjs`).

Destinations: **CANON** = canonical GOS field · **TL** = TimelineEntry ·
**TASK** = active Task · **CARD** = LegacyRecord.cardData (rendered by the new
"מידע ממערכת קודמת" card) · **XW** = crosswalk/identifier · **EXCL** = excluded.

## Pipedrive — record types

| Source | Pop. | Destination | Rule |
|---|---|---|---|
| Notes (deal-linked) | 71,741 on 21,696 deals | **TL** kind `note`, editable | original UTC timestamp, author label `Pipedrive · <name>`, sanitized HTML, crosswalked by note id |
| Notes (person-only) | 1,595 | **TL** on Contact | same |
| Notes (org-only) | 230 | **TL** on Organization | same |
| Activities, done | 147,315 (57.8k deal / rest person-org) | **TL** kind `note`, `isSystem` (not editable) | timestamped at completion; header = type · subject; body = note HTML. Person/org rows WITHOUT content (bare "call logged") are **EXCL** — zero information, would bury contact timelines (407 skipped; 27,967 belong to excluded/spam identities) |
| Activities, open, deal OPEN+non-archived | 68 | **TASK** (status open, owner = admin, real due date/time) | rule D7a — live work becomes live tasks; no messaging path exists for channel `none` (verified) |
| Activities, open, elsewhere | 4,228 | **TL** `isSystem`, header "משימה פתוחה (לא הושלמה)" | historical evidence, never re-activated |
| Deal stage-change flow history | not in snapshot | deferred | requires new Pipedrive API calls — explicitly out of scope until owner approves (post-cutover timeline slice) |
| Files metadata | 170,412 | deferred (**gated Files slice**, unchanged decision) | bodies stay in Pipedrive/Drive; metadata snapshot exists |

## Pipedrive — Deal custom fields (24,359 deals)

| Field | Pop. | Destination | Rule |
|---|---|---|---|
| מקור (varchar) | 19,741 | **CANON** `Deal.source` | fill-null-only |
| מקור-רשימה סגורה (enum) | 16,940 | **CANON** `Deal.dealSourceId` | exact catalog-label match after suffix/alias normalization (19,180 matched incl. free-text matches); unmatched values live on in `Deal.source` |
| תוכן הפנייה (text) | 14,161 | **TL** system note at deal creation time | "תוכן הפנייה המקורית" |
| תאריך פנייה (date) | 20,024 | **EXCL** | duplicates the deal's own preserved creation time |
| פעילות גרפיטי/אוכל, סוג פעילות | 18,572 / 13,092 | already **CANON**/`CARD` (Wave 1: activityType + card) | — |
| כמות משתתפים, תאריך/שעת הסיור | 12.5k / 10.8k / 9.4k | already **CANON** (participants, tourDate, tourTime) | Wave 1 |
| מידע חשוב על הלקוח | 8,503 | already **CANON** (customerInfo) | Wave 1 |
| תיקייה בדרייב + all URL-valued fields (טפסים, סליקה, הצעת מחיר…) | 8,521 + | **CARD** (Wave 1) — now VISIBLE via the new card UI; links render clickable | Drive/Photos stay external (approved) |
| שאלון לקראת פעילות (Google-Doc ids) | 7,761 | **EXCL** from live UI | bare doc ids of a retired form flow; recoverable from the archive payload |
| cal_event_id | 7,373 | **XW/EXCL** | measured non-adoptable (0/77); evidence in archive |
| פולואפ אוטומטי הבא, עודכן בגאנט, וואטסאפ לשליחה, ביצוע פעולות, won, שולם, טופס החלפת סיור, לינק לסליקה/מסמך חשבונאי | 2.5k–11.7k | **EXCL** | dead Make.com/automation machinery — no business meaning in GOS |
| מיקום הסיור, תנאי/אמצעי תשלום, הערות לחשבונית, דרך הסגירה, קמפיין, מי טיפלה/אחראי, שפת הדרכה, דילים מקושרים, מס הזמנה מהאתר, last_doc_id | 0.1k–6.1k | **CARD** (Wave 1) | historical truth, not live fields |
| מידע על הלקוח: למדריך ליומן | 6,002 | **CARD** (Wave 1 card extras) | operational history |
| תוכן אישי לתחילת המייל | 4,383 | **EXCL** | email-automation opener text, no ongoing value |
| איש קשר שנוכח בפעילות (people) | 5,765 | **EXCL** as live link | deal participants already imported from deal_participants; raw value in archive |
| תאריך צפי/תשלום לקבלה | 177 / 64 | **CARD** | collection module is GOS-native now |

## Pipedrive — Person custom fields (32,475)

| Field | Pop. | Destination | Reason |
|---|---|---|---|
| לינק לצ'אט וואטסאפ בווסנג'ר | 6,716 | **EXCL** | retired Wassenger tool; GOS has its own WhatsApp mirror |
| עודכן פורמט טלפון | 3,262 | **EXCL** | automation bookkeeping |
| ביצוע פעולות / שפה לטופס / לינקים אישיים (סוכנים) | 393–649 | **EXCL** | replaced by GOS Agent Reservations links |

## Pipedrive — Organization custom fields (2,905)

| Field | Pop. | Destination | Rule |
|---|---|---|---|
| סוג העסק (enum) | 2,851 | **CANON** `organizationTypeId` | deterministic table (all 10 live values): עסקים קטנים + תאגידים → חברות וארגונים · all בית ספר variants → בתי ספר (subtype is deal-level by design) · סוכנויות → סוכנויות תיירות ונסיעות · הפקה → הפקה · עמותות → עמותות · אוניברסיטאות → אוניבסיטאות/מכללות · **לא עסק-לקוח פרטי → deliberately NO type** (52). Original value always also on CARD. Unknown future values: never guessed — surfaced for review |
| iCount_id | 2,165 | **CARD** | iCount linkage is per-document in GOS; id preserved as evidence |
| ח.פ/עוסק מורשה | 29 | **CANON** `taxId` (fill-null) | |
| תנאי/אמצעי תשלום, קישור קבוע לטופס, למי לשלוח חשבוניות, איש כספים | 26–213 | **CARD** | payment config is catalog-driven in GOS |

## Airtable — Tours (3,508) & Participants (4,413)

| Field | Pop. | Destination | Rule |
|---|---|---|---|
| לינק לתיקייה בדרייב (mostly Photos albums) | 3,224 | **CARD** "תמונות/דרייב (מערכת קודמת)" | links stay external (approved); clickable in the tour card |
| מיקום טקסט / עיר / שפה / סוג פעילות / משך | 1.3k–3.1k | **CARD** | tour operational facts; TourEvent location/product FKs are deliberately not guessed for history |
| סיכום סיור split fields (איך היה / חיובי / חריגים / הצעות / על הקבוצה) | 1,653 | **CARD** (full text, replacing the 500-char slice) | guide summary — historical |
| הערות משיחת תיאום (tour + participant level) | 656 + 755 | **CARD** | coordination history |
| Participant per-deal blocks: קצת על הקבוצה, מידע חשוב, מגבלות, feedback scores | 0.5k–2.9k | **CARD**, prefixed `דיל <n> · ` | ties the group context to its deal on the tour card |
| מזהה ארוע ביומן, Tour_ID, statuses, formulas (214 derived fields) | all | **CARD**/XW (Wave 1) or **EXCL** (formulas) | derived fields never migrate |
| פייפ דיל ID, מוצרים links, guide links | all | already consumed by Wave-1 relationships | |

## Identifiers & routing (Part G2/H/J)

- **Deal**: orderNo = Pipedrive id (Wave 1, live).
- **Organization**: new `orgNo Int? @unique` — legacy Pipedrive org id backfilled via crosswalk (smallest id wins on merges); new rows auto-number from `org_no_seq` (start 10,000 > max legacy 3,053). URL `/admin/crm/organizations/<orgNo>`; cuid URLs still work.
- **Contact**: new `contactNo Int? @unique` — legacy person id; `contact_no_seq` start 50,000 > max legacy 37,636. URL `/admin/crm/contacts/<contactNo>`.
- Search: numeric queries match orderNo/orgNo/contactNo; names, normalized phones, emails, taxId and legacy cardData were already searchable.

## Explicitly excluded record classes (reasons on record)

Dead automation fields (Make/Integromat hooks, gantt flags, WhatsApp triggers),
formula/derived Airtable columns, Wassenger chat links, agent form links
(superseded by GOS Agent Reservations), bare person call-logs without content,
retired questionnaire doc-ids, legacy base "מוצרים ושירותים" (archive-only,
prior decision), passwords table (never read). Everything excluded remains in
the immutable snapshot payload archive.
