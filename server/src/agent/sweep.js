// The Shadow-mode sweep — how the agent learns that a customer wrote to us.
//
// WHY A SWEEP AND NOT A HOOK (the same reasoning as whatsapp/activitySweep.js):
// WhatsApp messages are written by the BRIDGE services, which run as separate
// Railway processes and deliberately hold no CRM logic. The agent is CRM policy
// and belongs on the server, so the server watches the mirror instead of the
// bridge reaching across into it. It also means no bridge deploy — and
// therefore no WhatsApp socket restart — is needed to change agent behaviour.
//
// One pass every 60s:
//   1. take inbound messages mirrored since the last pass (bounded overlap),
//   2. reduce them to ONE newest eligible message per chat — a burst of five
//      messages is one customer turn, not five runs,
//   3. run at most maxRunsPerSweep of them, sequentially.
//
// Idempotency is structural (AgentRun's unique (chatId, triggerMessageId)), so
// the watermark can live in memory: the worst case after a restart is a few
// duplicate claims that lose the insert race and stop.

import { prisma } from '../db.js';
import { loadSettings } from './config.js';
import { runAgentOnce } from './runner.js';
import { providerConfigured } from './provider/index.js';

const TICK_MS = 60_000;
const OVERLAP_MS = 5 * 60_000;
const BOOT_LOOKBACK_MS = 10 * 60_000;
const SCAN_LIMIT = 2000;

/**
 * V1 ELIGIBILITY — deliberately narrow. Everything excluded here is excluded
 * because it cannot be analysed SAFELY yet, not because it is uninteresting:
 *
 *   • outgoing messages — our own message is not a customer turn. (An operator
 *     replying is handled separately: it marks a pending proposal 'bypassed'.)
 *   • groups — multi-party context, unclear who is being answered. Behind a
 *     setting, default off.
 *   • non-text messages — an image with no caption carries no question. The
 *     context pack still SHOWS the placeholder to a run triggered by a later
 *     text message, so nothing is hidden; it just cannot trigger on its own.
 *   • internal conversations with our OWN business numbers — never a customer.
 *   • stale messages — a history sync backfills months of messages at once and
 *     must not queue thousands of runs. maxMessageAgeMinutes is that fuse.
 *   • Status/broadcast/channel traffic — already excluded at ingest.
 */
export async function eligibleTriggers(since, settings, { db = prisma, now = Date.now() } = {}) {
  const ageFloor = new Date(now - settings.maxMessageAgeMinutes * 60_000);

  const rows = await db.whatsAppMessage.findMany({
    where: {
      createdAt: { gt: since },
      direction: 'incoming',
      messageType: 'text',
      textContent: { not: null },
      timestampFromSource: { gte: ageFloor },
    },
    orderBy: { createdAt: 'asc' },
    take: SCAN_LIMIT,
    select: { id: true, chatId: true, timestampFromSource: true, textContent: true },
  });
  if (!rows.length) return [];

  // Newest message per chat — one customer turn, one run.
  const newestByChat = new Map();
  for (const r of rows) {
    if (!r.textContent?.trim()) continue;
    const prev = newestByChat.get(r.chatId);
    if (!prev || r.timestampFromSource > prev.timestampFromSource) newestByChat.set(r.chatId, r);
  }
  if (!newestByChat.size) return [];

  const chats = await db.whatsAppChat.findMany({
    where: { id: { in: [...newestByChat.keys()] } },
    select: {
      id: true, type: true, accountId: true, phoneNumber: true,
      providerDeletedAt: true, hiddenAt: true,
    },
  });

  // Our own business numbers are never customers (the #26316 class of bug).
  const accounts = await db.whatsAppAccount.findMany({ select: { phoneJid: true } });
  const ownDigits = new Set(
    accounts
      .map((a) => /^(\d+)(?::\d+)?@/.exec(String(a.phoneJid || ''))?.[1])
      .filter(Boolean),
  );

  const out = [];
  for (const chat of chats) {
    if (!settings.includeGroups && chat.type !== 'private') continue;
    if (chat.providerDeletedAt || chat.hiddenAt) continue;
    const digits = String(chat.phoneNumber || '').replace(/\D/g, '');
    if (digits && ownDigits.has(digits)) continue;
    const msg = newestByChat.get(chat.id);
    if (msg) out.push({ chatId: chat.id, triggerMessageId: msg.id, at: msg.timestampFromSource });
  }
  // Oldest turn first — a customer who has been waiting longest is analysed
  // first when the per-pass cap bites.
  out.sort((a, b) => new Date(a.at) - new Date(b.at));
  return out;
}

export async function sweepOnce(since, { db = prisma, log = console, now = Date.now() } = {}) {
  const settings = await loadSettings(db);
  if (!settings.enabled) return { skipped: 'agent_disabled', runs: 0 };
  if (!providerConfigured(settings.provider)) {
    return { skipped: 'provider_not_configured', runs: 0 };
  }

  const triggers = await eligibleTriggers(since, settings, { db, now });
  if (!triggers.length) return { runs: 0, candidates: 0 };

  const batch = triggers.slice(0, Math.max(1, settings.maxRunsPerSweep));
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  // Sequential on purpose: a burst must not fan out into N concurrent provider
  // calls. Latency here is irrelevant — nothing is waiting on this worker.
  for (const t of batch) {
    try {
      const res = await runAgentOnce(t, { db, log });
      if (res.status === 'succeeded') succeeded += 1;
      else if (res.status === 'failed') failed += 1;
      else skipped += 1;
    } catch (err) {
      failed += 1;
      log.error?.(`[agent-sweep] run failed chat=${t.chatId}: ${err?.message || err}`);
    }
  }

  return {
    candidates: triggers.length,
    runs: batch.length,
    succeeded,
    failed,
    skipped,
    deferred: Math.max(0, triggers.length - batch.length),
  };
}

export function startAgentSweep(log = console) {
  let watermark = new Date(Date.now() - BOOT_LOOKBACK_MS);
  let inFlight = false;
  const timer = setInterval(async () => {
    if (inFlight) return;
    inFlight = true;
    const passStart = new Date();
    try {
      const out = await sweepOnce(watermark, { log });
      // Only advance past a pass that actually ran: while the agent is off, the
      // watermark must not walk forward or turning it on would start with a
      // blind spot.
      if (!out.skipped) {
        watermark = new Date(passStart.getTime() - OVERLAP_MS);
        if (out.runs > 0) {
          log.info(
            `[agent-sweep] ${out.candidates} candidate(s) → ${out.runs} run(s) `
            + `(ok ${out.succeeded}, failed ${out.failed}, skipped ${out.skipped}, deferred ${out.deferred})`,
          );
        }
      }
    } catch (err) {
      // Leave the watermark where it is so the next pass retries this window.
      log.error(`[agent-sweep] pass failed: ${err?.message || err}`);
    } finally {
      inFlight = false;
    }
  }, TICK_MS);
  timer.unref?.();
  log.info('[agent-sweep] AI agent shadow sweep started (60s tick, disabled until enabled in settings)');
  return timer;
}
