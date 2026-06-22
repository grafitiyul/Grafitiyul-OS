# Grafitiyul OS — Public Website & Tours/Booking Architecture Audit

> Status: **Approved architecture direction.** Implementation not started.
> Scope: the new Public Website + Tours/Booking domain inside GOS.
> Last reviewed: 2026-06-22.

---

## 0. Purpose

This document is the reference we build the public website and the tours/booking
domain against. It captures the approved architecture, the source-of-truth model,
the domain design, the API boundary, the build order, and the open decisions.

It is intentionally a **living document**: open decisions are tracked in §9 and
resolved over time.

---

## 1. Core principle — GOS is the control center

- **GOS manages and publishes. The public website consumes a filtered public projection.**
- The public website is a **sales / display layer**. It must **never** become a
  second admin or a second source of truth.
- All business rules — pricing, capacity, visibility, availability, order/payment
  status — live **server-side** in GOS.
- Tours, ticket types, instances/dates, prices, capacity, visibility, bookings and
  content are all managed **inside GOS admin**.
- GOS is intended to grow into the central operating system of the business over
  time (progressively replacing tools such as Airtable, Pipedrive, Make, Cognito
  Forms). We build the tours/website domain now; we keep the architecture modular
  and expandable, and we **do not overbuild** the rest yet.

---

## 2. The Publish Gate (the rule that keeps the website a consumer)

A tour instance is **purchasable** only if ALL of the following are true,
evaluated **in the backend** (never in the browser):

```
isPurchasable(instance) =
      Tour.visibility   = PUBLIC          // admin toggled "show on website"
  AND Tour.status       = ACTIVE          // not draft / archived
  AND Tour.bookingEnabled = true          // selling is switched on for this tour
  AND instance.status   = OPEN            // not closed / cancelled
  AND now BETWEEN instance.bookingOpensAt AND bookingClosesAt   // sales window
  AND instance.availableSeats > 0         // capacity − confirmed seats (computed)
```

- The **public API only ever returns rows that pass this gate.** Drafts, hidden
  tours, closed dates and sold-out instances are filtered **in the query/service**.
- "Show but not bookable" (e.g. a full date shown greyed-out) is an **explicit flag**
  the API returns — not a guess the client makes.
- `availableSeats` and `isPurchasable` are **computed server-side**, never stored as
  the source of truth and never trusted from the client.

This single predicate is the structural guarantee that the website can display and
sell, but can never manage.

---

## 3. Approved platform decisions

| Decision | Approved direction |
|---|---|
| Codebase | **One codebase, one service, one database.** |
| Public website | A **separate public *surface*** inside the same repo/service — **not** a detached external app. |
| Backend/domain | Tours/booking = new Prisma models + new routers in the existing `server/`. |
| GOS admin | The single place that manages tours, ticket types, instances, prices, visibility, bookings, content. |
| Rendering | Public routes must be **SEO-safe** — they must **not** stay a pure client-side SPA when replacing WordPress. Admin/learner/portal stay SPA. The public site gets a distinct **rendering path** (not a distinct app). Exact tech = open decision (§9.1). |
| Language | **Hebrew-first for V1.** English prepared structurally (the codebase already does he/en at the data layer) but not required for first launch. |
| Payments | Provider **not chosen**. Booking is built so payment can be **mocked/stubbed** until a provider is selected. |
| WordPress migration | **No risky big-bang.** Prepare the new site, then cut over only after SEO checks, redirects, sitemap, metadata and staging crawl are ready. |
| Media | Public galleries are **not** stored as Postgres `Bytes`. Use object storage + CDN (simplest path proposed in §9.4). Not implemented yet. |

---

## 4. Repository reality (what we reuse, not rebuild)

Single-service monorepo: `server/` (Express + Prisma 5 + Postgres, ESM, Node 20+)
serves the built `client/` (React 18 + Vite + Tailwind + React Router 6). One Railway
service.

Reusable existing patterns:

- **Auth** (`server/src/auth.js`): `AdminUser` + scrypt, session cookie,
  `attachAuth` (annotate) + `requireAdminAuth` (gate), first-user bootstrap.
  Admin auth **already exists** (supersedes the stale CLAUDE.md §12 note). Tours
  admin routes go behind `requireAdminAuth`; public routes stay unauthenticated.
- **Public vs admin API split** (`server/src/index.js`): already the shape of the
  Publish-Gate boundary.
- **Cache policy**: `/api` → `no-store`, HTML → `no-store`, hashed `/assets` →
  `immutable 1y`. Matches CLAUDE.md §15. The public site keeps this.
- **Routing convention**: `server/src/routes/*.js` per domain + `asyncHandler.js`
  + `db.js` Prisma singleton + `services/*`.
- **Client surfaces**: `client/src/` split into `admin/` (guarded), `learner/`,
  `portal/`, `preview/`, `shell/`. The public website becomes a new `public/`
  surface alongside these.
- **Snapshot-on-finalize** (`DocumentInstance` freezes its data): the exact pattern
  for an **Order** snapshotting its lines/prices/instance at purchase, so later
  admin price edits never rewrite order history.
- **Source-of-truth split** (`PersonRef` mirror vs `PersonProfile` owned): same
  mental model as GOS-owns-truth vs external projection.
- **Bilingual** (`BusinessField.valueHe/valueEn`): he/en already a codebase pattern.
- **Visibility gate precedent** (`Flow.status` draft/published): tours
  visibility/status gate is the same proven idea.

The one gap: the whole client is **client-rendered** (the SPA shell is returned for
all non-API paths — no SSR). Fine for behind-login surfaces; not fine for an
SEO-critical public site → see §9.1.

---

## 5. Domain model (target)

Catalog (Step 1 — built first):

```
Tour          (id, slug, title, summary, description, type, category,
               locationName, durationMinutes, languages[], coverImageUrl,
               galleryImageUrls[], visibility, status, bookingEnabled,
               sortOrder, seoTitle, seoDescription, seoImageUrl)
TicketType    (id, tourId, label, variant, priceAmount, currency, isActive, sortOrder)
TourInstance  (id, tourId, startsAt, endsAt, capacity, status,
               bookingOpensAt, bookingClosesAt, guidePersonId)
              → derived (server, once bookings exist): availableSeats, isPurchasable
```

Booking & content (later modules — listed for shape, not built in Step 1):

```
Voucher       (code, kind[percent|fixed], value, validFrom/To, usageLimit, used, isActive)
Customer      (id, firstName, lastName, phone, email, address{street,city}, consentAt, marketingOptIn)
Order         (id, tourInstanceId, customerId, status[pending|paid|cancelled|refunded],
               subtotal, discount, total, currency, voucherId?, linesSnapshot, createdAt)
OrderLine     (id, orderId, ticketTypeId, qty, unitPrice, lineTotal)
Payment       (id, orderId, provider, providerRef, amount, status, paidAt)
ContentBlock  (id, key, type, payloadJson, seo{...})   // marketing / legal / FAQ
```

Server-owned business rules (never in the frontend):
- The Publish Gate (`isPurchasable`) and `availableSeats`.
- **Price** = `Σ(line.qty × unitPrice) − voucher`, computed server-side at order
  creation; client-posted prices are recomputed/ignored.
- **Capacity** enforced inside a **DB transaction** at booking time (atomic
  check-and-reserve → no overselling).
- **Order/payment status** transitions only via backend services + payment webhooks.
- **Money** stored as integer minor units (agorot) to avoid floating-point money bugs.

---

## 6. API boundary (GOS ↔ public website)

Two API surfaces on **one backend**, sharing the same domain services and database.

### Public API — read + single write, gated, no auth
```
GET  /api/public/tours                  → only gated tours (list + filters)
GET  /api/public/tours/:slug            → tour detail (gated)
GET  /api/public/tours/:slug/instances  → only visible/purchasable instances
GET  /api/public/content/:key           → marketing / legal / FAQ blocks
POST /api/public/orders                 → create booking (server validates gate + capacity + price)
POST /api/public/orders/:id/payment     → start payment (provider-agnostic; mockable)
POST /api/public/payments/webhook       → gateway → confirm/refund (server only)
GET  /api/public/orders/:id?token=…     → read own order (confirmation)
```
Returns only gate-passing data. Never exposes drafts, hidden tours, capacity
internals or other customers' orders. The only state it creates is an
order/payment, fully re-validated server-side.

### Admin API — full CRUD, authenticated (GOS only, `requireAdminAuth`)
```
/api/admin/tours          (CRUD + visibility/status/bookingEnabled)
/api/admin/ticket-types   (CRUD)
/api/admin/instances      (CRUD: dates, capacity, status, booking window)
/api/admin/vouchers       (CRUD)
/api/admin/orders         (read, status changes, refund)
/api/admin/customers      (read)
/api/admin/content        (CRUD + SEO)
/api/admin/reports        (occupancy, revenue)
```

**In one line:** Admin API *defines* truth; Public API *exposes a filtered,
read-only projection of it and accepts orders against it.*

---

## 7. Screens & pages

### GOS admin screens
Tour Catalog · Visibility & Availability · Ticket Types · Instance Scheduler ·
Pricing · Bookings/Orders · Customers (CRM-basic) · Vouchers · Content & SEO ·
Reviews moderation (optional V1) · Dashboard/Reporting.

Minimum for the model to work: Tour Catalog, Ticket Types, Instance Scheduler,
Pricing, Visibility, Bookings/Orders.

### Public website pages (pure consumers)
Home · `/tours` · `/events` · tour/event detail · `/checkout/:instanceId` ·
`/checkout/success` · Reviews · About · Blog/Article · Help/FAQ · Contact (+success)
· Legal · 404 + system states (Loader, No-Results, Empty).

The only write the public site can make is "create order / start payment", fully
re-validated server-side.

---

## 8. Build order (modules)

| Module | Scope |
|---|---|
| **M0 — Domain & gate** | Schema + `isPurchasable` + capacity logic + public/admin API skeletons |
| **M1 — GOS catalog admin** | Tour Catalog, Ticket Types, Instance Scheduler, Pricing, Visibility |
| **M2 — Design system + shell** | Tokens (from Figma), primitives, NavBar/Footer, RTL, routing |
| **M3 — Public catalog** | `/tours`, `/events`, detail — reading the **gated** public API |
| **M4 — Booking & checkout** | Ticket select → billing → payment (mocked) → success; server price + capacity; vouchers |
| **M5 — Orders admin** | Bookings, Customers, Dashboard |
| **M6 — Content/SEO admin + static pages** | Content service + About/Reviews/Blog/FAQ/Contact/Legal/404 |
| **M7 — SEO migration & launch** | Redirect map, sitemap, structured data, perf, staging crawl, WordPress cutover |

Page-by-page within the public site (highest-value conversion path first):
Tours list → Tour detail → Checkout → Success → Home → About/Reviews →
Blog/Article → FAQ/Help → Contact → Legal → 404.

---

## 9. Open decisions

### 9.1 Public-site rendering technology
SPA = SEO regression vs WordPress. One-service-friendly options:
(a) **Astro** public front (islands, SSG/SSR, minimal JS) — current lean;
(b) Vite SSR/prerender for public routes only;
(c) Next.js with controlled caching (per CLAUDE.md §15).
**Needed before M2/M3.**

### 9.2 Payment provider
Israeli gateway (Tranzila / Cardcom / PayPlus / Meshulam) vs Stripe. Booking is built
provider-agnostic with a **mock provider** until chosen. **Needed before M4 go-live.**

### 9.3 WordPress cutover
No big-bang. Prepare new site in parallel; cut over only after redirects, sitemap,
metadata, structured data and staging crawl pass. **Drives M7.**

### 9.4 Media hosting (simplest proposed path)
Do not store public galleries as Postgres `Bytes`. Simplest path: an **S3-compatible
object store + CDN** (e.g. **Cloudflare R2** — no egress fees, or AWS S3 +
CloudFront). Admin uploads → object store; DB stores only the **URL** (already
reflected as `coverImageUrl` / `galleryImageUrls[]` in the Tour model). Keep
content-hashed/immutable filenames so the CDN can cache safely (CLAUDE.md §15).
**Not implemented yet.**

### 9.5 Misc to confirm during build
hreflang/i18n routing when EN ships; reviews source (Google API vs curated);
which marketing content is admin-editable vs static for V1.

---

## 10. Risk log

- **SEO/SSR** — pure SPA would lose WordPress ranking → public routes need SSR/SSG.
- **Payments** — provider undecided → build mockable, isolate the integration.
- **Media** — image-heavy public site must not stream from Postgres → object storage + CDN.
- **WordPress cutover** — must be staged with redirects + crawl, never big-bang.
- **Admin auth before go-live** — auth exists; ensure all admin tours/booking routes
  are gated and bookings/payments are never reachable unauthenticated for management.
- **No duplicate source of truth** — WordPress must stop owning tours/bookings the
  moment GOS owns a page type; the website never writes business truth.

---

## 11. First implementation step (pending model approval)

**Step 1 = a purely additive Prisma migration adding the catalog read-model only:
`Tour`, `TicketType`, `TourInstance`. Nothing else.**

- Additive only — `CREATE TABLE` for three new tables; **zero `ALTER`** on existing
  tables; existing GOS modules untouched.
- Reversible; deploys via the existing `prisma migrate deploy` flow.
- Independent of all open decisions (rendering, payments, media), so it unblocks
  progress without forcing premature choices.

Then: admin CRUD + tours admin screen → gated public read API → public catalog pages
(after §9.1) → booking/checkout (payment mocked) → orders admin → SEO migration.
