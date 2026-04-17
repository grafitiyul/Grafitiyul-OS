import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import itemsRouter from './routes/items.js';
import flowsRouter from './routes/flows.js';
import attemptsRouter from './routes/attempts.js';
import reviewsRouter from './routes/reviews.js';

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

app.use('/api/items', itemsRouter);
app.use('/api/flows', flowsRouter);
app.use('/api/attempts', attemptsRouter);
app.use('/api/reviews', reviewsRouter);

// Unknown /api/* paths get a real JSON 404 instead of falling through to
// the SPA fallback (which would serve HTML for an API request).
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'not found' });
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

const port = Number(process.env.PORT) || 4000;

app.listen(port, () => {
  console.log(`[grafitiyul-os-server] listening on port ${port}`);
});
