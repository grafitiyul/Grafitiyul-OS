// Internal HTTP API of the bridge — called only by the GOS server (Railway
// private network), never by browsers. One bridge process = one account, so
// no :accountId in paths; the GOS server picks the right bridge by URL.
//
// Auth: Authorization: Bearer <BRIDGE_INTERNAL_SECRET> on everything except
// /health (Railway probe + reachability test must work without a secret).
//
// Endpoints (Slice 1):
//   GET  /health              honest health: 200 = restart would NOT help
//                             (healthy / boot grace / reconnecting / waiting
//                             on QR); 503 = restart MIGHT help (up, not in
//                             transition, still not connected).
//   GET  /status              persisted account row + live readiness snapshot
//                             + QR rendered as a data URL for direct <img> use.
//   POST /restart-socket      rebuild the socket, keep creds (zombie recovery).
//   POST /hard-reset-session  wipe auth + fresh QR (corrupt session).
//   POST /sign-out            logout on WhatsApp's side + wipe creds.

import express from 'express';
import pino from 'pino';
import qrcode from 'qrcode';
import { config } from './config.js';
import { prisma } from './db.js';
import { accountState } from './accountState.js';

const log = pino({ level: config.logLevel, name: 'http' });

const HEALTH_BOOT_GRACE_MS = 5 * 60_000;
const HEALTH_SNAPSHOT_CACHE_MS = 5_000;

function errSummary(err) {
  if (err instanceof Error) return err.message.split('\n')[0]?.slice(0, 240) ?? 'unknown';
  return String(err).slice(0, 240);
}

export function startHttpServer(client) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  const processStartedAt = new Date();
  let healthSnapshotCache = null;

  // Request log (health at debug so a 5s probe cadence doesn't drown the log).
  app.use((req, _res, next) => {
    if (req.path === '/health') log.debug({ method: req.method, url: req.url }, 'incoming /health');
    else log.info({ method: req.method, url: req.url }, `incoming method=${req.method} url=${req.url}`);
    next();
  });

  // Auth — everything except /health.
  app.use((req, res, next) => {
    if (req.path === '/health') return next();
    const header = req.headers.authorization ?? '';
    if (header !== `Bearer ${config.internalSecret}`) {
      log.warn({ path: req.path, method: req.method, hasHeader: !!req.headers.authorization }, 'bridge auth rejected');
      return res.status(401).json({ error: 'bridge_auth_failed' });
    }
    next();
  });

  app.get('/health', async (_req, res) => {
    const readiness = client.getReadiness();
    const uptimeMs = Date.now() - processStartedAt.getTime();
    const inBootGrace = uptimeMs < HEALTH_BOOT_GRACE_MS;
    const isReconnecting = readiness.reason === 'reconnecting';

    // Cheap happy path — most probes land here; skip the DB call.
    if (readiness.ok) {
      return res.status(200).json({ ok: true, connected: true, reason: null, bridgeStatus: 'connected', uptimeMs, accountId: config.accountId });
    }

    let persistedStatus = null;
    try {
      const now = Date.now();
      if (healthSnapshotCache && now - healthSnapshotCache.fetchedAt < HEALTH_SNAPSHOT_CACHE_MS) {
        persistedStatus = healthSnapshotCache.status;
      } else {
        const row = await accountState.snapshot(prisma);
        persistedStatus = row?.status ?? null;
        healthSnapshotCache = { fetchedAt: now, status: persistedStatus };
      }
    } catch (err) {
      // DB hiccup — conservative: treat as "in transition" so we never
      // trigger a restart on incomplete information.
      log.warn({ err: errSummary(err) }, '[/health] snapshot failed; treating as transitional');
      persistedStatus = null;
    }

    const isAwaitingHuman =
      persistedStatus === 'qr_required' || persistedStatus === 'pairing' || persistedStatus === 'connecting';

    if (inBootGrace || isReconnecting || isAwaitingHuman) {
      return res.status(200).json({
        ok: true, connected: false, reason: readiness.reason,
        bridgeStatus: persistedStatus, uptimeMs, inBootGrace, accountId: config.accountId,
      });
    }

    log.warn({ readiness, bridgeStatus: persistedStatus, uptimeMs }, '[/health] unhealthy (503) — up but not connected and not in transition');
    return res.status(503).json({
      ok: false, connected: false, reason: readiness.reason,
      bridgeStatus: persistedStatus, uptimeMs, accountId: config.accountId,
    });
  });

  app.get('/status', async (_req, res) => {
    // Persisted row (what Baileys last reported) + LIVE readiness (what a
    // send would see right now — covers zombie sockets where the persisted
    // 'connected' is stale). The admin UI keys "usable" off readiness.ok.
    const readiness = client.getReadiness();
    const row = await accountState.snapshot(prisma);
    if (!row) {
      return res.json({ accountId: config.accountId, status: 'disconnected', qrDataUrl: null, readiness });
    }
    // Render the QR string into a data URL so the admin UI shows it as an
    // <img> without a frontend QR library.
    let qrDataUrl = null;
    if (row.qr) {
      try {
        qrDataUrl = await qrcode.toDataURL(row.qr, { margin: 1, width: 320, errorCorrectionLevel: 'L' });
      } catch (err) {
        log.warn({ err: errSummary(err) }, 'qrcode.toDataURL failed; returning without image');
      }
    }
    res.json({
      accountId: row.id,
      label: row.label,
      status: row.status,
      qrDataUrl,
      phoneJid: row.phoneJid,
      deviceName: row.deviceName,
      lastQrAt: row.lastQrAt?.toISOString() ?? null,
      lastConnectedAt: row.lastConnectedAt?.toISOString() ?? null,
      lastDisconnectAt: row.lastDisconnectAt?.toISOString() ?? null,
      lastDisconnectReason: row.lastDisconnectReason,
      lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
      lastInboundMessageAt: row.lastInboundMessageAt?.toISOString() ?? null,
      reconnectAttempts: row.reconnectAttempts,
      readiness,
    });
  });

  // Recovery actions are fire-and-forget (the reset can take seconds); the
  // admin UI re-polls /status and the new state appears within one cycle.
  app.post('/restart-socket', (_req, res) => {
    log.warn('[/restart-socket] requested');
    void client.restartSocket().catch((err) => {
      log.error({ err: errSummary(err) }, '[/restart-socket] async failure');
    });
    res.status(202).json({ ok: true, restart_started: true, readiness: client.getReadiness() });
  });

  app.post('/hard-reset-session', (_req, res) => {
    log.warn('[/hard-reset-session] requested');
    void client.hardResetSession().catch((err) => {
      log.error({ err: errSummary(err) }, '[/hard-reset-session] async failure');
    });
    res.status(202).json({ ok: true, hard_reset_started: true, readiness: client.getReadiness() });
  });

  app.post('/sign-out', async (_req, res) => {
    log.warn('[/sign-out] requested');
    try {
      await client.signOut();
      res.json({ ok: true, signed_out: true });
    } catch (err) {
      log.error({ err: errSummary(err) }, '[/sign-out] failed');
      res.status(500).json({ error: 'sign_out_failed', detail: errSummary(err) });
    }
  });

  // Explicit 404 with the route list — distinguishes "request never reached
  // the app" (proxy/port mismatch) from "wrong path" when reading logs.
  app.use((req, res) => {
    log.warn({ method: req.method, url: req.url }, `404 not_found method=${req.method} url=${req.url}`);
    res.status(404).json({
      error: 'not_found',
      method: req.method,
      url: req.url,
      registeredRoutes: ['GET /health', 'GET /status', 'POST /restart-socket', 'POST /hard-reset-session', 'POST /sign-out'],
    });
  });

  return new Promise((resolve) => {
    const server = app.listen(config.httpPort, config.httpHost, () => {
      log.info({ host: config.httpHost, port: config.httpPort }, 'bridge http listening');
      resolve(server);
    });
  });
}
