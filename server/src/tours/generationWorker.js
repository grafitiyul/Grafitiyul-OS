import { prisma } from '../db.js';
import { ensureOpenTourSlots } from './openTourGeneration.js';

// Scheduled Open-Tour generation. Until now occurrences only materialised when
// someone READ a Tours screen (ensureTourSlots on GET /api/tours,/calendar) —
// unacceptable as the primary mechanism. This worker makes generation autonomous:
// every hour it runs the SAME canonical path (ensureOpenTourSlots →
// ensureCanonicalSlot), so the configured horizon (TourSettings.generateDaysAhead,
// the single source of truth) is always filled ahead — no admin visit required.
// Read-triggered generation stays as a harmless immediate fallback.
//
// FREQUENCY: hourly. The horizon's far edge advances one calendar day per day,
// so at most one new occurrence per rule per day enters the window; an hourly
// tick fills it long before it is imminent, and each tick is a near-no-op thanks
// to the per-rule generatedThrough cursor. Idempotent + concurrency-safe by
// construction: ensureCanonicalSlot keys on the canonical identity and the
// partial unique index rejects any duplicate active occurrence, so overlapping
// ticks (this worker + a read-trigger, or two instances) never duplicate,
// never recreate cancelled twins, and honour rules/exceptions/replacements.
//
// HEALTH: each tick records its result on a MaintenanceJob row (HEALTH_KEY). The
// בקרה detector (control/detectors/openTourGeneration.js) reads it and surfaces a
// persistent failure (transients self-heal on the next tick).

const TICK_MS = 60 * 60_000; // hourly
const BOOT_DELAY_MS = 8_000;
export const GENERATION_HEALTH_KEY = 'open_tour_generation';

let started = false;
let inFlight = false;

// One generation pass + health bookkeeping. Exported for tests and manual runs.
export async function runGenerationTick(client = prisma, log = console) {
  if (inFlight) return { skipped: true }; // in-process re-entrancy guard
  inFlight = true;
  try {
    const created = await ensureOpenTourSlots(client, { log });
    if (created) log?.log?.(`[open-tour-gen] created ${created} occurrence(s)`);
    await recordHealth(client, { ok: true, created }).catch(() => {});
    return { ok: true, created };
  } catch (e) {
    log?.warn?.(`[open-tour-gen] tick failed: ${e?.message}`);
    await recordHealth(client, { ok: false, error: String(e?.message || e) }).catch(() => {});
    return { ok: false, error: String(e?.message || e) };
  } finally {
    inFlight = false;
  }
}

async function recordHealth(client, { ok, created = 0, error = null }) {
  const existing = await client.maintenanceJob.findUnique({ where: { key: GENERATION_HEALTH_KEY } });
  const prevSummary = existing?.summary || {};
  const consecutiveFailures = ok ? 0 : (prevSummary.consecutiveFailures || 0) + 1;
  const nowIso = new Date().toISOString();
  const summary = {
    consecutiveFailures,
    lastCreated: ok ? created : (prevSummary.lastCreated ?? 0),
    lastRunAt: nowIso,
    lastSuccessAt: ok ? nowIso : (prevSummary.lastSuccessAt ?? null),
  };
  await client.maintenanceJob.upsert({
    where: { key: GENERATION_HEALTH_KEY },
    create: { key: GENERATION_HEALTH_KEY, status: ok ? 'done' : 'failed', finishedAt: new Date(), error, summary },
    update: { status: ok ? 'done' : 'failed', finishedAt: new Date(), error, summary },
  });
}

export function startTourGenerationWorker(log = console) {
  if (started) return;
  started = true;
  setInterval(() => runGenerationTick(prisma, log), TICK_MS).unref?.();
  // First pass shortly after boot so a fresh deploy fills the horizon immediately.
  setTimeout(() => runGenerationTick(prisma, log), BOOT_DELAY_MS).unref?.();
  log?.log?.('[open-tour-gen] generation worker started (hourly)');
}
