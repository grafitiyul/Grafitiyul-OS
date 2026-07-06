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

  await prisma.$connect();
  log.info('prisma connected');

  await ensureAccountRow(prisma);
  log.info({ accountId: config.accountId }, 'account row ensured');

  await loadBaileys();
  log.info('baileys module loaded');

  const client = new WaClient(config.accountId);
  await client.start();

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
