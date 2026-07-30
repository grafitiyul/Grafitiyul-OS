// GOS WhatsApp bridge — entry point. One process = one WhatsApp account
// (WHATSAPP_ACCOUNT_ID env). Deployed as gos-whatsapp-main and
// gos-whatsapp-office: same code, same Postgres, different env.
//
// Boot order:
//   1. Validate env (config.js throws on missing required vars).
//   2. Connect Prisma. The bridge NEVER runs migrations — the GOS server
//      service owns `prisma migrate deploy`; this process only reads/writes.
//   3. Ensure this account's WhatsAppAccount row exists (deployment identity
//      = account identity).
//   4. Load Baileys (v7, load-once) and start the client: with persisted
//      creds it reconnects without pairing; otherwise it emits a QR that the
//      GOS admin UI renders.
//   5. Start the internal HTTP server (/health, /status, recovery actions).
//
// Fail-fast on uncaught errors: log, then exit non-zero so Railway restarts
// the container cleanly — a fresh process re-reads creds from Postgres and
// takes the same boot path we already know works. (A process that limps on
// after an uncaught error keeps passing healthchecks while sends fail.)

import pino from 'pino';
import { config } from './config.js';
import { prisma, shutdownPrisma } from './db.js';
import { loadBaileys } from './baileysLib.js';
import { ensureAccountRow } from './accountState.js';
import { WaClient } from './waClient.js';
import { startHttpServer } from './httpServer.js';
import { ffmpegAvailable } from './voice.js';
import { startAvatarWorker } from './avatarWorker.js';

const log = pino({ level: config.logLevel, name: 'bridge' });

async function main() {
  log.info(
    { accountId: config.accountId, httpPort: config.httpPort, reconnectMaxDelayMs: config.reconnectMaxDelayMs },
    'gos-whatsapp-bridge starting',
  );

  // Voice notes require the bundled ffmpeg binary — announce its state at
  // boot so a missing/failed download is visible in the deploy log, not
  // discovered on the first send.
  if (ffmpegAvailable()) log.info('ffmpeg available — voice-note transcoding enabled');
  else log.error('ffmpeg binary MISSING — /send-voice will fail until the ffmpeg-static install is fixed');

  // Stand-down mode: serve health so the platform stays happy, and touch
  // NOTHING. Deliberately before $connect — a disabled bridge must not hold a
  // database connection, and must not re-create the account row of a number
  // that has been retired (ensureAccountRow upserts, so a running bridge would
  // silently resurrect a deleted account).
  if (config.disabled) {
    log.warn({ accountId: config.accountId }, 'BRIDGE_DISABLED=true — standing down: no socket, no account row, no writes');
    // A stub rather than null: /health needs no client, but the other routes
    // dereference one, and a disabled bridge should answer "disabled" instead
    // of crashing if something still calls it.
    const stub = {
      getReadiness: () => ({ ready: false, status: 'disabled', reason: 'BRIDGE_DISABLED' }),
      restartSocket: async () => { throw new Error('bridge_disabled'); },
      hardResetSession: async () => { throw new Error('bridge_disabled'); },
      markRead: async () => { throw new Error('bridge_disabled'); },
      signOut: async () => { throw new Error('bridge_disabled'); },
    };
    const idle = await startHttpServer(stub);
    const stop = (signal) => {
      log.warn({ signal }, 'shutdown requested (disabled bridge)');
      idle.close(() => process.exit(0));
    };
    process.on('SIGINT', () => stop('SIGINT'));
    process.on('SIGTERM', () => stop('SIGTERM'));
    return;
  }

  // ── Boot-time DB access: retry transient failures, never crash-loop ──────
  // Proven failure (2026-07-30): a push redeploys the GOS server and both
  // bridges SIMULTANEOUSLY; the server runs `prisma migrate deploy` on start,
  // and the bridges — regenerated against the new schema — booted ten seconds
  // BEFORE the migration finished. ensureAccountRow hit P2022 (column does not
  // exist), the process exited 1, and Railway did NOT restart it: both bridges
  // stayed dead until a manual redeploy. The same shape follows a brief
  // Postgres blip at boot.
  //
  // Transient = the DB isn't ready YET (unreachable, mid-migration schema
  // mismatch). Those retry with exponential backoff for up to ~5 minutes —
  // far longer than any migration. Anything else (bad credentials, corrupt
  // data, programming errors) still fails fast and loud.
  const TRANSIENT_PRISMA_CODES = new Set([
    'P1001', // can't reach database server
    'P1002', // server reached but timed out
    'P1008', // operations timed out
    'P1017', // server closed the connection
    'P2021', // table does not exist (migration not applied yet)
    'P2022', // column does not exist (migration not applied yet)
  ]);
  const isTransientBootError = (err) =>
    TRANSIENT_PRISMA_CODES.has(err?.code) ||
    /ECONNREFUSED|ECONNRESET|ETIMEDOUT|Connection (refused|reset|closed|terminated)/i.test(String(err?.message || ''));

  async function bootStep(label, fn, { maxWaitMs = 5 * 60_000 } = {}) {
    const started = Date.now();
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const transient = isTransientBootError(err);
        const elapsed = Date.now() - started;
        if (!transient || elapsed >= maxWaitMs) {
          log.error(
            { step: label, attempt, code: err?.code, err: err?.message, transient },
            transient ? `${label}: still failing after ${Math.round(elapsed / 1000)}s — giving up` : `${label}: non-transient failure`,
          );
          throw err;
        }
        const delay = Math.min(30_000, 1000 * 2 ** attempt);
        log.warn(
          { step: label, attempt, code: err?.code, err: err?.message, retryInMs: delay },
          `${label}: transient failure (DB not ready yet?) — retrying`,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  await bootStep('prisma connect', () => prisma.$connect());
  log.info('prisma connected');

  await bootStep('ensure account row', () => ensureAccountRow(prisma));
  log.info({ accountId: config.accountId }, 'account row ensured');

  await loadBaileys();
  log.info('baileys module loaded');

  const client = new WaClient(config.accountId);
  await client.start();

  // Slow background enrichment (1 chat/minute) — see avatarWorker.js.
  startAvatarWorker(client);

  const server = await startHttpServer(client);

  const shutdown = async (signal) => {
    log.warn({ signal }, 'shutdown requested');
    try {
      await new Promise((resolve) => server.close(resolve));
    } catch (err) {
      log.warn({ err: err?.message }, 'http server close failed');
    }
    try {
      await shutdownPrisma();
    } catch (err) {
      log.warn({ err: err?.message }, 'prisma disconnect failed');
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    log.error({ reason: reason instanceof Error ? reason.message : String(reason) }, 'unhandledRejection — exiting so Railway restarts the container');
    setTimeout(() => process.exit(1), 250).unref();
    process.exitCode = 1;
  });
  process.on('uncaughtException', (err) => {
    log.error({ err: err?.message }, 'uncaughtException — exiting so Railway restarts the container');
    setTimeout(() => process.exit(1), 250).unref();
    process.exitCode = 1;
  });
}

main().catch((err) => {
  console.error('[bridge] fatal:', err);
  process.exit(1);
});
