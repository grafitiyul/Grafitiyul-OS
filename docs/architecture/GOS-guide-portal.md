# Guide Portal — architecture & contracts

Status: shipped (Slices A–F, July 2026). This document records the security
model, the DTO contract, and the intentionally-deferred pieces.

## What it is

The guide's daily operational app at `/p/:token` — mobile-first PWA shell
with bottom navigation:

| Surface | Route | Notes |
| --- | --- | --- |
| סיורים (primary) | `/p/:token` | upcoming assigned tours, soonest first |
| סיורי עבר | `/p/:token/past` | ended tours, newest first, server-gated |
| שכר | `/p/:token/pay` | honest shell — no pay model exists yet |
| Tour detail | `/p/:token/tour/:id` | read-only admin-modal hierarchy |
| Tour gallery | `/p/:token/tour/:id/gallery` | existing gallery module |
| נהלים | `/p/:token/procedures` | the original procedures task feed |
| פרטים אישיים | `/p/:token/profile` | view + gated phone/email edit |
| משובים / מערכי הדרכה | placeholders | no source module yet |

## Token / session model (unchanged, deliberately)

`PersonRef.portalToken` (24 random bytes, base64url) in the URL is the whole
credential. Kill switches: `portalEnabled=false` (set automatically on
lifecycle exit) and `status='blocked'`. Unknown token → 404 (no enumeration);
valid-but-disabled → 403. Rotation via the People admin invalidates the old
URL instantly. PWA continuity comes from the server-rewritten manifest
(`start_url=/launch/:token`) — see `server/src/index.js`.

## Permissions — server-enforced

`GuidePortalSettings` (singleton row, seeded on first read) holds 13 switches
edited in Settings → Tours → הרשאות מדריכים. Gallery delete/share stay on
`TourGallerySettings` (their original SSOT). Resolution happens in
`server/src/tours/guidePortal/access.js`:

- `resolveGuidePortalAccess` — token → person + merged permission set.
- `resolveGuideTourAccess` — the above + a `TourAssignment` on THIS tour.
  Cancelled tours still resolve (read-only with a clear state); the gallery
  keeps its stricter no-cancelled rule.

Every `/api/portal` data route re-resolves permissions; the client's
`/home` bootstrap payload only decides which tabs/menu items render.
`useTourGallery=false` is additionally enforced inside
`resolveGuideGalleryAccess`, so all gallery routes 403 as one unit.

## DTO contract (the security core)

`server/src/tours/guidePortal/dto.js` builds every payload. The portal never
receives Deal/Booking rows:

- participant cards carry: org/customer title, seats, phone/email/field-rep/
  customer-info (each behind its permission), coordination status, and
  `orderNo` — display only, never a link, no deal id anywhere.
- never exposed: deal value, quotes, collection, payments, email/WhatsApp,
  tasks, internal notes, tax ids, CRM timeline, unrelated contacts.

## Questionnaire reuse (one engine)

- Tour summary: portal routes (`/summary`, `/summary/answers`, `/summary/
  submit`, `/summary/void`, `/summary/upload`) call the SAME questionnaire
  service; the submission is always resolved server-side from
  (tour_event, tourId, tour_summary) — the client never sends ids.
  Client-side, `QuestionnaireFillDialog` gained a `transport` prop; the flow
  (start/resume → autosave → submit → view → redo) is shared verbatim.
- Coordination: the guide receives the SAME public capability link the
  customer uses (`/form/:token`), minted per booking after an assignment
  check. No second fill flow exists.
- New drafts are refused on cancelled tours (existing submissions stay
  viewable).

## שכר — future model (documented, not built)

No pay data exists (TourAssignment has no rate fields; schema notes
"Pay/attendance are a future phase"). When built, it should be derived —
never stored per screen — from:

1. `TourAssignment` (who worked which tour, in which role), joined to
2. `ProductVariant.baseGuidePaymentMinor` / `travelPaymentMinor` (already in
   schema) with per-role/per-person overrides as a new table, and
3. a monthly aggregation endpoint under `/api/portal/:token/pay`, gated on
   `viewPay`, exposing only the current guide's rows.

Do not compute pay ad-hoc in the client, and do not surface other guides'
figures.

## Intentionally deferred

- משובים / מערכי הדרכה portal pages — placeholder until their modules exist
  (questionnaire engine can back משובים via a new purpose + registry entry).
- Profile photo upload + name changes from the portal (office-managed).
- `bankDetails` exposure/editing in the portal.
- A "rescheduled" visual state — TourEvent has no rescheduled flag; cards
  always show current date/time.
- Per-guide (rather than global) permission overrides.
