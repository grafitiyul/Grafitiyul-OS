import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { attachAuth, requireAdminAuth, buildAuthRoutes } from './auth.js';
import itemsRouter from './routes/items.js';
import flowsRouter from './routes/flows.js';
import attemptsRouter from './routes/attempts.js';
import reviewsRouter from './routes/reviews.js';
import mediaRouter from './routes/media.js';
import businessFieldsRouter from './routes/businessFields.js';
import signersRouter from './routes/signers.js';
import documentsRouter from './routes/documents.js';
import teamsRouter from './routes/teams.js';
import peopleRouter from './routes/people.js';
import exportsRouter from './routes/exports.js';
import portalRouter from './routes/portal.js';
import portalToursRouter from './routes/portalTours.js';
import portalProfileRouter from './routes/portalProfile.js';
import portalPayRouter from './routes/portalPay.js';
import bankCatalogRouter from './routes/bankCatalog.js';
import portalTrainingRouter from './routes/portalTraining.js';
import guideStationAccessRouter from './routes/guideStationAccess.js';
import portalGalleryRouter from './routes/portalGallery.js';
import guidePortalSettingsRouter from './routes/guidePortalSettings.js';
import publicGalleryRouter from './routes/publicGallery.js';
import adminUsersRouter from './routes/adminUsers.js';
import organizationsRouter from './routes/organizations.js';
import organizationTypesRouter from './routes/organizationTypes.js';
import organizationSubtypesRouter from './routes/organizationSubtypes.js';
import contactsRouter from './routes/contacts.js';
import dealsRouter from './routes/deals.js';
import quoteDocumentsRouter from './routes/quoteDocuments.js';
import publicQuoteRouter from './routes/publicQuote.js';
import dealStagesRouter from './routes/dealStages.js';
import dealTasksRouter from './routes/dealTasks.js';
import dealFilesRouter from './routes/dealFiles.js';
import dealTourPlanRouter from './routes/dealTourPlan.js';
import icountDocsRouter from './routes/icountDocs.js';
import taskTypesRouter from './routes/taskTypes.js';
import activityComponentsRouter from './routes/activityComponents.js';
import workshopLocationsRouter from './routes/workshopLocations.js';
import mediaFilesRouter from './routes/mediaFiles.js';
import locationsRouter from './routes/locations.js';
import productsRouter from './routes/products.js';
import activityTypesRouter from './routes/activityTypes.js';
import paymentConfigRouter from './routes/paymentConfig.js';
import priceListsRouter from './routes/priceLists.js';
import priceRulesRouter from './routes/priceRules.js';
import addonsRouter from './routes/addons.js';
import addonPriceRulesRouter from './routes/addonPriceRules.js';
import pricingCalcRouter from './routes/pricingCalc.js';
import pricingSegmentsRouter from './routes/pricingSegments.js';
import ticketTypesRouter from './routes/ticketTypes.js';
import sabbathHoursRouter from './routes/sabbathHours.js';
import lostReasonsRouter from './routes/lostReasons.js';
import dealSourcesRouter from './routes/dealSources.js';
import quoteSectionsRouter from './routes/quoteSections.js';
import quoteTemplateRouter from './routes/quoteTemplate.js';
import quoteImagesRouter from './routes/quoteImages.js';
import timelineRouter from './routes/timeline.js';
import sharedContentRouter from './routes/sharedContent.js';
import tourContentRouter from './routes/tourContent.js';
import toursRouter from './routes/tours.js';
import openToursRouter from './routes/openTours.js';
import tourGalleryRouter from './routes/tourGallery.js';
import tourContentExportRouter from './routes/tourContentExport.js';
import staffEventsRouter from './routes/staffEvents.js';
import staffExportRouter from './routes/staffExport.js';
import icountWebhookRouter from './routes/icountWebhook.js';
import cardcomWebhookRouter from './routes/cardcomWebhook.js';
import payRouter from './routes/pay.js';
import paymentRouter from './routes/payment.js';
import touristPaymentRouter from './routes/touristPayment.js';
import { dealCollectionRouter, collectionRouter } from './routes/collection.js';
import payrollRouter from './routes/payroll.js';
import whatsappRouter from './routes/whatsapp.js';
import emailRouter from './routes/email.js';
import emailTrackingRouter from './routes/emailTracking.js';
import { startScheduledWorker } from './whatsapp/scheduledWorker.js';
import { startEmailSyncWorker } from './email/syncWorker.js';
import { startTourGalleryCleanupWorker } from './tours/gallery/cleanupWorker.js';
import { startTourCalendarSyncWorker } from './tours/calendar/syncWorker.js';
import { startTourCompletionWorker } from './tours/completionWorker.js';
import { startWooSyncWorker } from './tours/woo/syncWorker.js';
import { startHeldExpiryWorker } from './tours/heldExpiryWorker.js';
import { startReconcileOpenTourProducts } from './maintenance/reconcileOpenTourProducts.js';
import questionnairesRouter from './routes/questionnaires.js';
import publicQuestionnaireRouter from './routes/publicQuestionnaire.js';
import controlRouter from './routes/control.js';
import { startControlSweepWorker } from './control/sweepWorker.js';
import './control/detectors/index.js';
import { makeLegacyRedirect } from './legacyRedirect.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, '../../client/dist');

// Running build identity. The client build writes dist/version.json (commit +
// builtAt); the server reads it ONCE at startup and is the source of truth for
// "what's deployed". Open tabs poll /version.json and compare it to the build id
// baked into their bundle — a mismatch means a newer frontend is live. We prefer
// the file (it matches the client's baked id exactly); fall back to the Railway
// commit env, then 'unknown' if the build artefact is somehow missing.
const runningVersion = (() => {
  try {
    const raw = fs.readFileSync(path.join(clientDist, 'version.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.commit) return parsed;
  } catch {
    /* artefact missing — fall through to env */
  }
  const env = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || '';
  return { commit: env ? env.slice(0, 12) : 'unknown', builtAt: null };
})();

const app = express();

// ---------- Legacy-domain 301 redirect (must be FIRST) ----------
//
// Requests still arriving on the OLD Railway public host are permanently
// redirected to the same path+query on the canonical domain, so links already
// in the wild (/pay/<token>, /p/<token>, tracking pixels, bookmarks) keep
// working. Runs before body parsing — a stale POST to the old host is
// redirected without reading its (up to 25mb) body. ONLY the exact legacy
// public host matches; *.railway.internal, the new domain, localhost and the
// health probe all pass through (see src/legacyRedirect.js). Configurable:
//   CANONICAL_ORIGIN     default https://app.grafitiyul.co.il
//   LEGACY_PUBLIC_HOST   default grafitiyul-os-production.up.railway.app
const legacyRedirectTarget = makeLegacyRedirect({
  canonicalOrigin: process.env.CANONICAL_ORIGIN || 'https://app.grafitiyul.co.il',
  legacyHost: process.env.LEGACY_PUBLIC_HOST || 'grafitiyul-os-production.up.railway.app',
});
app.use((req, res, next) => {
  const target = legacyRedirectTarget(req.headers.host, req.path, req.originalUrl);
  if (!target) return next();
  res.set('Cache-Control', 'no-store');
  return res.redirect(301, target);
});

app.use(cors());
// 25mb: WhatsApp voice notes are uploaded from the composer as base64 JSON.
// Everything else stays far below this; admin-authed surface.
app.use(express.json({ limit: '25mb' }));

// Money is stored as BigInt minor units (see Deal module). JSON.stringify can't
// serialize BigInt, so convert it to a Number on the way out. Our money values
// (agorot) are far below Number.MAX_SAFE_INTEGER, so this is lossless. No other
// model returns BigInt today.
app.set('json replacer', (_key, value) =>
  typeof value === 'bigint' ? Number(value) : value,
);

// ---------- Cache-Control policy (see CLAUDE.md §15) ----------
//
// API responses must always be fresh — they carry user-visible app state.
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.get('/health', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    status: 'ok',
    service: 'grafitiyul-os-server',
    commit: runningVersion.commit,
    builtAt: runningVersion.builtAt,
    timestamp: new Date().toISOString(),
  });
});

// Deployed-frontend identity, polled by open tabs (see client lib/version.js).
// Tiny + no-store so the version check always reflects the truly-live build.
// Declared before the static handlers so it can never be shadowed by the
// dist/version.json file (which is also served, but without guaranteed headers).
app.get('/version.json', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(runningVersion);
});

// Attach auth state to every request (req.adminAuth = { userId } | null).
// `attachAuth` never blocks — it only annotates. `requireAdminAuth`
// is the gate, applied per-router below for routes that are admin-only.
app.use(attachAuth);

// Public auth endpoints (login / logout / status). Login is the only
// way to acquire the session cookie, so the route itself MUST be
// reachable without auth.
app.use('/api/auth', buildAuthRoutes(express));

// ── Public routes (no auth) ────────────────────────────────────
//
// Used by the guide portal + learner runtime. The portal is gated on
// its own (token in the URL); the runtime + flow + items endpoints
// are accessed via attempt / flow / item ids that are effectively
// unguessable. Locking these behind admin auth would break every
// existing public guide link, which is exactly what the spec calls
// out as forbidden.
app.use('/api/portal', portalRouter);
// Guide Portal → Tours (home bootstrap, upcoming/past feeds, tour detail).
// Same portal-token credential; dedicated guide DTOs — no Deal payloads.
app.use('/api/portal', portalToursRouter);
// Guide Portal → פרטים אישיים (view + permission-gated profile editing).
app.use('/api/portal', portalProfileRouter);
// Guide Portal → שכר (viewPay-gated: office-approved entries, per-entry guide
// approval, inquiry comments → בבירור).
app.use('/api/portal', portalPayRouter);
// Guide Portal → מערכי הדרכה (permitted training stations; double server
// gate: viewTraining permission + explicit GuideStationAccess rows).
app.use('/api/portal', portalTrainingRouter);
// Israeli bank catalog — static bundled data, public (admin + portal).
app.use('/api/bank-catalog', bankCatalogRouter);
// Guide Portal → Tour Gallery (assigned-tours list, direct-to-R2 uploads,
// settings-gated delete/share). Same portal-token credential; separate router
// so the task-feed router stays focused.
app.use('/api/portal', portalGalleryRouter);
// PUBLIC customer tour gallery — capability-URL token (/g/<token> page).
// View/upload/download only; identity always derives from the token.
app.use('/api/gallery', publicGalleryRouter);
// Public customer quote page — token-gated (QuoteDocument.publicToken), no auth.
app.use('/api/public', publicQuoteRouter);
// Public questionnaire fill (coordination forms etc.) — token-gated
// (QuestionnaireLink.token), no auth. Same capability-URL philosophy.
app.use('/api/public', publicQuestionnaireRouter);
app.use('/api/attempts', attemptsRouter);
app.use('/api/flows', flowsRouter);
app.use('/api/items', itemsRouter);
app.use('/api/media', mediaRouter);
// Tour Content export — server-to-server READ API for the recruitment system to
// consume GOS-owned tour content. NOT cookie-gated: it carries its own shared-
// secret middleware (x-internal-export-secret). GOS is the source of truth.
app.use('/api/tour-content-export', tourContentExportRouter);
// Staff lifecycle events (recruitment → GOS ingest). Secret-gated
// (x-staff-event-secret), not cookie-gated. training_started/accepted_to_team
// upsert; training_rejected revokes access + hard-deletes the PersonRef.
app.use('/api/staff-events', staffEventsRouter);
// Staff roster export (GOS → recruitment READ). Secret-gated. GOS owns the roster.
app.use('/api/staff-export', staffExportRouter);
// iCount IPN receiver — URL-secret gated (not cookie-gated; iCount calls it).
// Audit-log only in this slice: persists raw payloads, changes NO deal state.
app.use('/api/webhooks', icountWebhookRouter);
// Cardcom webhook receiver — URL-secret gated (Cardcom calls it). Logs the raw
// payload, re-verifies server-side (GetLpResult), marks the request paid once,
// and triggers the iCount document. Idempotent against retries.
app.use('/api/webhooks', cardcomWebhookRouter);
// PUBLIC canonical payment URLs — /payment/<provider>/<token> (Cardcom + iCount).
// Provider is visible in the URL. Must be mounted before the SPA fallback.
app.use('/payment', paymentRouter);
// LEGACY /pay/<token> + /pay/c/<token> — 301-redirect to the canonical
// /payment/icount/... URLs above (keeps old links in the wild working).
app.use('/pay', payRouter);
// Email open-tracking pixel — PUBLIC (the recipient's mail client fetches it),
// gated only by the per-message unguessable tracking id. attachAuth above lets
// it skip counting self-opens from logged-in GOS sessions.
app.use('/api/track', emailTrackingRouter);

// ── Admin-only routes ──────────────────────────────────────────
//
// Reviews + people + teams + documents + business fields + signers +
// recruitment + exports are all admin tools — no public consumer
// hits these. requireAdminAuth runs before each router, so an
// unauthenticated request gets a 401 JSON before any handler logic.
app.use('/api/reviews', requireAdminAuth, reviewsRouter);
app.use('/api/business-fields', requireAdminAuth, businessFieldsRouter);
app.use('/api/signers', requireAdminAuth, signersRouter);
app.use('/api/documents', requireAdminAuth, documentsRouter);
app.use('/api/teams', requireAdminAuth, teamsRouter);
app.use('/api/people', requireAdminAuth, peopleRouter);
// Guide → training-Station permissions (הרשאות למערכי הדרכה) — explicit
// per-station grant rows; same /api/people surface, separate router.
app.use('/api/people', requireAdminAuth, guideStationAccessRouter);
app.use('/api/exports', requireAdminAuth, exportsRouter);
app.use('/api/admin-users', requireAdminAuth, adminUsersRouter);

// ── CRM foundation (Phase 1) ───────────────────────────────────
//
// Organizations / units / types / subtypes / contacts. Reference data
// for the future Deals + Activities workflow (the Pipedrive replacement).
// Admin-only; no public consumer. Deals, Activities, and all external
// integrations (WhatsApp / Gmail / iCount / automation) are NOT built yet.
app.use('/api/organizations', requireAdminAuth, organizationsRouter);
app.use('/api/organization-types', requireAdminAuth, organizationTypesRouter);
app.use('/api/organization-subtypes', requireAdminAuth, organizationSubtypesRouter);
app.use('/api/contacts', requireAdminAuth, contactsRouter);

// Deal module (commercial core): deals + pipeline stages. Admin-only. Quotes /
// payments / tours / activities are NOT built yet.
app.use('/api/deals', requireAdminAuth, dealsRouter);
// Deal Tasks (משימות) + Deal Files — nested under /api/deals/:id/*. Mounted after
// dealsRouter (no path overlap; deals owns /:id, these own /:id/tasks|files).
app.use('/api/deals', requireAdminAuth, dealTasksRouter);
app.use('/api/deals', requireAdminAuth, dealFilesRouter);
// Deal Tour PLANNING (pre-WON) — /:id/tour-plan* (same nested pattern). The
// internal planning layer; materialized into a real tour by the WON transition.
app.use('/api/deals', requireAdminAuth, dealTourPlanRouter);
// iCount accounting documents + custom payment links — /:id/icount/*,
// /:id/custom-payment-links (same nested-under-deals pattern as tasks/files).
app.use('/api/deals', requireAdminAuth, icountDocsRouter);
// Cardcom tourist payment requests — /:id/tourist-payment[/*] (same
// nested-under-deals pattern). Cardcom clears; iCount stays the doc provider.
app.use('/api/deals', requireAdminAuth, touristPaymentRouter);
// Collection (גבייה) — server-side source of truth for paid/balance math:
// /:id/collection (Deal card) + /api/collection/deals (Collection screen).
app.use('/api/deals', requireAdminAuth, dealCollectionRouter);
app.use('/api/collection', requireAdminAuth, collectionRouter);
// Payroll (שכר צוות) — day screen + activity drawer. Math lives in
// payroll/engine.js (pure), writes in payroll/service.js.
app.use('/api/payroll', requireAdminAuth, payrollRouter);
// WhatsApp module — account/connection admin (proxies live actions to the
// per-number bridge services over Railway's private network).
app.use('/api/whatsapp', requireAdminAuth, whatsappRouter);
// Email module — Gmail integration (accounts/OAuth, read-only sync mirror,
// inbox, send, CRM linking). The OAuth callback rides the admin session cookie
// (top-level GET navigation → SameSite=Lax sends it), so the whole router is
// cookie-gated; the public tracking pixel lives separately under /api/track.
app.use('/api/email', requireAdminAuth, emailRouter);
app.use('/api/deal-stages', requireAdminAuth, dealStagesRouter);
// CRM Task Types catalog (configurable task types behind the Deal task composer).
app.use('/api/task-types', requireAdminAuth, taskTypesRouter);
app.use('/api/activity-components', requireAdminAuth, activityComponentsRouter);
app.use('/api/workshop-locations', requireAdminAuth, workshopLocationsRouter);
// Quote Module — Slice 1 (quote document foundation). Admin-only. Draft
// metadata only; no produce/render/public page/signature/PDF/delivery yet.
app.use('/api/quote-documents', requireAdminAuth, quoteDocumentsRouter);

// Products & Pricing — Slice 1 (catalog + R2 files + payment config). Admin
// only. Pricing engine, add-ons, and Deal integration are NOT built yet.
app.use('/api/media-files', requireAdminAuth, mediaFilesRouter);
app.use('/api/locations', requireAdminAuth, locationsRouter);
app.use('/api/products', requireAdminAuth, productsRouter);
app.use('/api/activity-types', requireAdminAuth, activityTypesRouter);
app.use('/api/payment-config', requireAdminAuth, paymentConfigRouter);

// Products & Pricing — Slice 2 (pricing engine + add-ons). Admin only. NOT
// wired to Deals; no DealLineItem, no Quotes. /api/pricing/calculate is a
// read-only test endpoint for the engine.
app.use('/api/price-lists', requireAdminAuth, priceListsRouter);
app.use('/api/price-rules', requireAdminAuth, priceRulesRouter);
app.use('/api/addons', requireAdminAuth, addonsRouter);
app.use('/api/addon-price-rules', requireAdminAuth, addonPriceRulesRouter);
app.use('/api/pricing', requireAdminAuth, pricingCalcRouter);
app.use('/api/pricing-segments', requireAdminAuth, pricingSegmentsRouter);
app.use('/api/ticket-types', requireAdminAuth, ticketTypesRouter);
app.use('/api/sabbath-hours', requireAdminAuth, sabbathHoursRouter);

// CRM settings catalogs — Lost Reasons & Quote Content Sections. Admin only.
// Content/config only; NOT wired to Deals or quote generation yet.
app.use('/api/lost-reasons', requireAdminAuth, lostReasonsRouter);
app.use('/api/deal-sources', requireAdminAuth, dealSourcesRouter);
app.use('/api/quote-sections', requireAdminAuth, quoteSectionsRouter);
// CRM settings → Quote Layout & Sections: global default quote composition.
app.use('/api/quote-template', requireAdminAuth, quoteTemplateRouter);
app.use('/api/quote-images', requireAdminAuth, quoteImagesRouter);
// Reusable Timeline / Activity-Feed (notes V1). Scoped by (subjectType, subjectId).
app.use('/api/timeline', requireAdminAuth, timelineRouter);
// Shared Content Library — platform-wide reusable content (meeting/ending point…).
app.use('/api/shared-content', requireAdminAuth, sharedContentRouter);
// Tour Content (Phase 1a foundation) — GOS-owned internal tour content
// (Tour → Station → ordered Steps → reusable ContentBlocks). Admin-only. No
// recruitment migration, no permissions/access, no R2 uploads yet.
app.use('/api/tour-content', requireAdminAuth, tourContentRouter);
// Tours OPERATIONAL module ("סיורים") — TourEvent/Booking. Distinct from the
// tour CONTENT routes above; see server/src/routes/tours.js for the ownership
// contract (group slots managed here, private/business mirror their deal).
app.use('/api/tours', requireAdminAuth, toursRouter);
app.use('/api/open-tours', requireAdminAuth, openToursRouter);
// Tour Gallery — per-TourEvent media (photos/videos) on R2. Staff surface;
// objects are private (presigned GETs only). The public customer gallery is a
// separate token-derived router mounted with the other public routes.
app.use('/api/tour-gallery', requireAdminAuth, tourGalleryRouter);
// Guide Portal permissions — the server-backed singleton behind Settings →
// Tours → הרשאות מדריכים. Enforced by the /api/portal guide routes.
app.use('/api/guide-portal-settings', requireAdminAuth, guidePortalSettingsRouter);
// Questionnaire Engine (generic — blueprint: docs/architecture/questionnaire-
// engine-design.md). Admin builder + staff submission flows. Public
// token-link routes are a separate, later-mounted public router (Slice 3).
app.use('/api/questionnaires', requireAdminAuth, questionnairesRouter);
// בקרה (Operations Control) — THE canonical operational-issue surface. Every
// subsystem reports problems into OperationalIssue (server/src/control/);
// this router serves the dashboard + acknowledge/recheck/server actions.
app.use('/api/control', requireAdminAuth, controlRouter);

// Unknown /api/* paths get a real JSON 404 instead of falling through to
// the SPA fallback (which would serve HTML for an API request).
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'not found' });
});

// ---------- Token-aware PWA manifest ----------
//
// Mounted BEFORE express.static so it intercepts /manifest.webmanifest
// requests instead of the static file in client/dist. The static file
// still exists as a fallback if this route ever fails / is removed,
// but the dynamic version is the one the GuidePortal page references
// (with ?p=<token>) so that "Add to Home Screen" captures the
// guide's specific token in the manifest's start_url.
//
// Why this matters: a PWA's start_url is captured at install time
// from the manifest the browser fetched at that moment. Once
// installed, the PWA always launches at that captured URL. So if the
// guide visits /p/:token and the page references
// /manifest.webmanifest?p=<token>, the browser captures
// start_url=/launch?p=<token>, and every future launch from the home
// screen replays the token directly. No reliance on cross-context
// localStorage, no reliance on the user revisiting /p/:token.
//
// Public route: never auth-gated. Returns no-store so a future token
// rotation isn't masked by a stale cached manifest.
app.get('/manifest.webmanifest', (req, res) => {
  const rawToken = String(req.query?.p || '');
  // Same character class as the rest of the codebase — anything off
  // this set is treated as "no token" and the manifest falls back to
  // the bare /launch start_url.
  const token = /^[A-Za-z0-9_-]+$/.test(rawToken) ? rawToken : null;
  // Path-based start_url for the per-token manifest. iOS Safari has
  // historically had trouble preserving query strings through PWA
  // standalone launches; path segments survive consistently. Older
  // installs that captured /launch?p=<token> still resolve through
  // Landing's query-aware fallback, so this is purely a hardening of
  // future installs.
  const startUrl = token
    ? `/launch/${encodeURIComponent(token)}`
    : '/launch';
  res.set('Cache-Control', 'no-store');
  res.set('Content-Type', 'application/manifest+json; charset=utf-8');
  res.json({
    name: 'Grafitiyul Team',
    short_name: 'Grafitiyul Team',
    description: 'מערכת התפעול והלמידה של גרפיתי-יול',
    lang: 'he',
    dir: 'rtl',
    start_url: startUrl,
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f9fafb',
    theme_color: '#2563eb',
    // The two icons mirror the static manifest. SVG works on every
    // modern install target; iOS picks up the apple-touch-icon link
    // in index.html separately.
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icon-maskable.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  });
});

// ---------- Static client assets ----------
//
// Built assets at /assets/* have content-hashed filenames (Vite). They are
// immutable for a given URL, so they may be cached aggressively. This is the
// "safe caching" case allowed by CLAUDE.md §15.
app.use(
  '/assets',
  express.static(path.join(clientDist, 'assets'), {
    maxAge: '1y',
    immutable: true,
  }),
);

// Any other static file from clientDist (index.html, favicon, etc.). HTML
// must never be cached: browsers must always fetch the latest app shell so
// they never end up running against missing asset hashes.
app.use(
  express.static(clientDist, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.set('Cache-Control', 'no-store');
      }
    },
  }),
);

// ── SPA fallback with token-aware manifest rewrite ─────────────────
//
// The audit established that iOS Safari fetches the manifest at HTML
// parse time and caches it. Any post-mount JS that mutates the
// <link rel="manifest"> href is ignored at "Add to Home Screen"
// time. So we MUST serve HTML whose initial manifest link already
// points at the per-token manifest URL.
//
// Strategy:
//   * Read index.html ONCE at startup into a string template.
//   * On every SPA request, decide whether the requested path
//     contains a guide token (matches /p/:token, /install-guide/:token,
//     or /launch/:token).
//   * If yes, replace the <link rel="manifest" ...> tag with one
//     pointing at /manifest.webmanifest?p=<token>. The dynamic
//     manifest endpoint then returns start_url=/launch/<token> and
//     iOS captures that correctly, regardless of any JS that runs
//     later.
//   * If no, serve the unmodified HTML.
//
// The replacement is done with a flexible regex so attribute order /
// quoting changes from Vite don't silently break the rewrite. The
// regex matches the FULL `<link ... rel="manifest" ...>` tag.

const indexHtmlPath = path.join(clientDist, 'index.html');
let indexHtmlTemplate = '';
try {
  indexHtmlTemplate = fs.readFileSync(indexHtmlPath, 'utf-8');
} catch (e) {
  // Build artefact missing at startup is a deploy problem — log
  // loudly. Requests will fall through to the original sendFile path
  // below as a last-ditch attempt.
  console.warn('[spa] could not preload index.html', e?.message);
}

const TOKEN_PATH_RE =
  /^\/(?:p|install-guide|launch)\/([A-Za-z0-9_-]+)\/?$/;
const MANIFEST_LINK_RE =
  /<link\b[^>]*\brel\s*=\s*["']manifest["'][^>]*>/i;

function htmlForRequest(reqPath) {
  if (!indexHtmlTemplate) return null;
  const m = reqPath.match(TOKEN_PATH_RE);
  if (!m) return indexHtmlTemplate;
  const token = m[1];
  // Build the replacement tag from scratch so we don't carry over
  // any unrelated attributes that might be in the original link.
  const replacement = `<link rel="manifest" href="/manifest.webmanifest?p=${encodeURIComponent(
    token,
  )}" />`;
  if (MANIFEST_LINK_RE.test(indexHtmlTemplate)) {
    return indexHtmlTemplate.replace(MANIFEST_LINK_RE, replacement);
  }
  // Defensive: if the regex didn't match (unlikely but possible if
  // the template format changes), inject a manifest link in <head>.
  return indexHtmlTemplate.replace(
    /<head>/i,
    `<head>\n    ${replacement}`,
  );
}

app.get('*', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  const html = htmlForRequest(req.path);
  if (html) {
    res.set('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  }
  // Last-ditch fallback if the template wasn't loaded.
  res.sendFile(indexHtmlPath, (err) => {
    if (err) next();
  });
});

// Global error handler. Keeps the server alive on DB or handler errors
// and returns a structured JSON 500 instead of crashing the Node process
// (which would make Railway return 502 until the next restart).
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error('[server error]', err);
  res.set('Cache-Control', 'no-store');
  if (res.headersSent) return;
  res.status(500).json({
    error: 'internal_error',
    message: err?.message || 'unknown error',
  });
});

// Last-resort safety net: never let an unhandled promise rejection or
// uncaught exception take the process down. Errors from route handlers
// already flow through the handler above; this is defence in depth.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

const port = Number(process.env.PORT) || 4000;

app.listen(port, () => {
  console.log(`[grafitiyul-os-server] listening on port ${port}`);
  // Scheduled WhatsApp messages (Slice 7) — claim-based 60s tick; no-op when
  // no bridges are configured (local dev without WHATSAPP_BRIDGE_URLS).
  startScheduledWorker(console);
  // Gmail read-only sync mirror — 60s tick; no-op until GOOGLE_CLIENT_ID/SECRET
  // + EMAIL_TOKEN_KEY are configured and an account is connected.
  startEmailSyncWorker(console);
  // Tour Gallery R2 purge (cancelled/deleted tours) + abandoned-upload sweep —
  // claim-based 60s tick; verifies the prefix is empty before marking done.
  startTourGalleryCleanupWorker(console);
  // Tours → Google Calendar mirror — 60s tick; reconciles pending tours to
  // the org account's calendar (TourEvent stays the SSOT). No-op until the
  // Google account is connected with the calendar scope.
  startTourCalendarSyncWorker(console);
  // Tour completion sweep — flips scheduled tours whose date passed (business
  // TZ midnight) into the explicit Completed state; 5m tick, idempotent.
  startTourCompletionWorker(console);
  // GOS → WooCommerce mirror — reconciles pending sellable TourEvents to their
  // WooCommerce variations (one per tour × mapped card). 60s tick; no-op until
  // WOO_STORE_URL/WOO_CONSUMER_KEY/WOO_CONSUMER_SECRET are configured.
  startWooSyncWorker(console);
  // Held-reservation expiry — flips lapsed HELD registrations to EXPIRED
  // (releases capacity + writes an audit event); 60s tick, idempotent.
  startHeldExpiryWorker(console);
  // One-time automatic reconciliation of stale open-tour operational products —
  // marker-gated (runs exactly once across restarts/instances), concurrency-safe,
  // non-destructive. Heals already-materialized tours so the workshop-derivation
  // fix applies to existing rows, then normal recomputation keeps them correct.
  startReconcileOpenTourProducts(prisma, console);
  // בקרה detectors — re-derive operational issues from live domain state
  // (raise missing, auto-resolve fixed); 60s tick.
  startControlSweepWorker(console);
});
