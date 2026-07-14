import { wooPendingPatch } from '../tours/woo/service.js';
import { kickWooSync } from '../tours/woo/syncWorker.js';
import { calendarPendingPatch, kickTourCalendarSync } from '../tours/calendar/service.js';
import { cancelTourAssignments } from '../tours/assignmentLifecycle.js';
import { CAPACITY_STATUSES } from '../tours/registrationStatus.js';

// Durable one-time dedupe of RACED duplicate open-tour slots: two generation
// runs raced on 2026-07-13 and materialized the same (template, date, time)
// group slot twice — each duplicate then mirrored its own WooCommerce
// variations, so the storefront listed every combination twice.
//
// Repair: within each duplicate group of SCHEDULED slots, the OLDEST row is
// kept as canonical; every newer twin WITHOUT capacity-holding registrations is
// CANCELLED (never deleted — its Woo variations must stay disable-able and its
// history intact). Cancellation flows through the normal mirrors: Woo pending
// (maintenance origin — the worker hides the twin's variations; the kept slot
// keeps the date public) and Calendar pending (the twin's event is removed).
// A registered twin is NEVER auto-cancelled — it is reported for a human call.
const KEY = 'dedupe_raced_tour_slots_v1';
const STALE_MS = 15 * 60 * 1000;

export async function dedupeRacedTourSlots(client, log = console) {
  const rows = await client.tourEvent.findMany({
    where: { kind: 'group_slot', status: 'scheduled', openTourTemplateId: { not: null }, startTime: { not: null } },
    select: { id: true, openTourTemplateId: true, date: true, startTime: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  const groups = new Map();
  for (const r of rows) {
    const k = `${r.openTourTemplateId}|${r.date}|${r.startTime}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }

  const cancelled = [];
  const keptRegistered = [];
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    // Oldest row (first materialized) is canonical; newer twins are the race artifacts.
    for (const twin of group.slice(1)) {
      const regs = await client.ticketRegistration.count({
        where: { tourEventId: twin.id, status: { in: CAPACITY_STATUSES } },
      });
      if (regs > 0) {
        keptRegistered.push({ key, id: twin.id, regs });
        log?.warn?.(`[maintenance:${KEY}] duplicate ${twin.id} (${key}) has ${regs} registrations — NOT auto-cancelled, needs a human decision`);
        continue;
      }
      await client.tourEvent.update({
        where: { id: twin.id },
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
          ...calendarPendingPatch(),
          ...wooPendingPatch('maintenance'),
        },
      });
      await cancelTourAssignments(client, twin.id, { reason: 'raced_duplicate_dedupe' }).catch(() => {});
      cancelled.push({ key, id: twin.id });
      log?.log?.(`[maintenance:${KEY}] cancelled raced duplicate ${twin.id} (${key}); kept ${group[0].id}`);
    }
  }
  return { ok: true, cancelled, keptRegistered };
}

export async function runDedupeRacedTourSlotsOnce(client, log = console) {
  await client.maintenanceJob.upsert({ where: { key: KEY }, create: { key: KEY }, update: {} });
  const staleBefore = new Date(Date.now() - STALE_MS);
  const claimed = await client.maintenanceJob.updateMany({
    where: {
      key: KEY,
      OR: [{ status: 'pending' }, { status: 'failed' }, { status: 'running', startedAt: { lt: staleBefore } }],
    },
    data: { status: 'running', startedAt: new Date(), attempts: { increment: 1 } },
  });
  if (!claimed.count) return { skipped: true };

  try {
    const summary = await dedupeRacedTourSlots(client, log);
    await client.maintenanceJob.update({
      where: { key: KEY },
      data: { status: 'done', finishedAt: new Date(), summary, error: null },
    });
    if (summary.cancelled.length) {
      kickTourCalendarSync();
      kickWooSync();
    }
    log?.log?.(
      `[maintenance:${KEY}] done — cancelled=${summary.cancelled.length} registeredKept=${summary.keptRegistered.length}`,
    );
    return { done: true, summary };
  } catch (e) {
    await client.maintenanceJob
      .update({ where: { key: KEY }, data: { status: 'failed', error: String(e?.message || e) } })
      .catch(() => {});
    log?.warn?.(`[maintenance:${KEY}] FAILED: ${e?.message || e}`);
    return { failed: true };
  }
}

export function startDedupeRacedTourSlots(client, log = console) {
  runDedupeRacedTourSlotsOnce(client, log).catch((e) =>
    log?.warn?.(`[maintenance:${KEY}] runner error: ${e?.message || e}`),
  );
}
