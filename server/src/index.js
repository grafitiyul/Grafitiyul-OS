import 'dotenv/config';
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
import recruitmentRouter from './routes/recruitment.js';
import exportsRouter from './routes/exports.js';
import portalRouter from './routes/portal.js';
import adminUsersRouter from './routes/adminUsers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, '../../client/dist');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

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
    timestamp: new Date().toISOString(),
  });
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
app.use('/api/attempts', attemptsRouter);
app.use('/api/flows', flowsRouter);
app.use('/api/items', itemsRouter);
app.use('/api/media', mediaRouter);

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
app.use('/api/recruitment', requireAdminAuth, recruitmentRouter);
app.use('/api/exports', requireAdminAuth, exportsRouter);
app.use('/api/admin-users', requireAdminAuth, adminUsersRouter);

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
  const startUrl = token
    ? `/launch?p=${encodeURIComponent(token)}`
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

// SPA fallback — serves index.html for any non-API route. Always fresh.
app.get('*', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
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
});
