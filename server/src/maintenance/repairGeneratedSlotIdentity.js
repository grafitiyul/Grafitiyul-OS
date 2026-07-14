import { israelToday, addDays, getTourSettings, weekdayOf } from '../tours/slotGeneration.js';
import { TEMPLATE_GEN_INCLUDE, baseProductOf } from '../tours/openTourGeneration.js';
import { ensureCanonicalSlot, owningRuleId, requiredSlotsForDate } from '../tours/canonicalSlot.js';
import { kickWooSync } from '../tours/woo/syncWorker.js';
import { kickTourCalendarSync } from '../tours/calendar/service.js';

// Durable one-time repair of the generated-slot identity mess left by the
// 2026-07 rule delete+recreate:
//   (a) RE-ATTRIBUTION — the live scheduled Thursdays point at the DELETED rule
//       (the earlier dedupe kept the older twin, which belonged to the now-dead
//       rule); ruleEdit queries slots by rule id, so those slots are invisible to
//       the current Thursday rule and a future edit would re-duplicate them.
//       Re-point every scheduled slot at the rule that currently owns its
//       (date, startTime).
//   (b) REOPEN MISSING — 16/07 had its cancel exception deleted but never
//       returned (the delete route did nothing). For every date a current rule
//       requires that has NO active occurrence at all, reopen the cancelled
//       occurrence (or create it). Gated per-DATE, so 17/07 — served by a manual
//       13:00 replacement while its 10:45 stays cancelled WITH registrations — is
//       left completely untouched.
// Idempotent + claim-guarded. Runs after the tour_canonical_slot_identity
// migration (old unique dropped), so re-attribution can't collide.
const KEY = 'repair_generated_slot_identity_v1';
const STALE_MS = 15 * 60 * 1000;

const ACTIVE = ['scheduled', 'completed'];

// The pure core, exported for tests. deps: { log }.
export async function repairGeneratedSlotIdentity(client, log = console) {
  const today = israelToday();
  const settings = await getTourSettings(client);
  const target = addDays(today, settings.generateDaysAhead);

  const templates = await client.openTourTemplate.findMany({
    where: { active: true },
    include: TEMPLATE_GEN_INCLUDE,
  });

  const summary = { reattributed: [], reopened: [], created: [], skippedDates: [] };

  for (const tpl of templates) {
    const rules = tpl.scheduleRules || [];
    const exceptions = tpl.exceptions || [];
    const cancelDates = new Set(exceptions.filter((e) => e.type === 'cancel').map((e) => e.date));
    const timeOverrides = new Map(
      exceptions.filter((e) => e.type === 'time_override' && e.time).map((e) => [e.date, e.time]),
    );
    const base = baseProductOf(tpl);
    const capacity = tpl.capacity != null ? tpl.capacity : settings.defaultCapacity;
    const locationId = tpl.locationId || base?.variantLocationId || null;

    // (a) Re-attribution — scheduled future slots whose owning rule differs.
    const scheduled = await client.tourEvent.findMany({
      where: { openTourTemplateId: tpl.id, kind: 'group_slot', status: 'scheduled', date: { gte: today } },
      select: { id: true, date: true, startTime: true, generatedByRuleId: true },
    });
    for (const s of scheduled) {
      if (s.generatedByRuleId && s.generatedByRuleId.startsWith('exc:')) continue; // one-off add slot
      const owner = owningRuleId(s.date, s.startTime, rules, timeOverrides);
      if (owner && owner !== s.generatedByRuleId) {
        await client.tourEvent.update({ where: { id: s.id }, data: { generatedByRuleId: owner } });
        summary.reattributed.push({ id: s.id, date: s.date, startTime: s.startTime, from: s.generatedByRuleId, to: owner });
        log?.log?.(`[repair:${KEY}] re-attributed ${s.id} ${s.date} ${s.startTime} → ${owner}`);
      }
    }

    // (b) Reopen missing — per required DATE, only when the date has NO active
    //     occurrence (so a retimed/replacement slot on that date is never
    //     duplicated).
    for (let d = today; d <= target; d = addDays(d, 1)) {
      if (cancelDates.has(d)) continue;
      const required = requiredSlotsForDate(rules, d, timeOverrides);
      if (!required.length) continue;
      const activeOnDate = await client.tourEvent.count({
        where: { openTourTemplateId: tpl.id, kind: 'group_slot', date: d, status: { in: ACTIVE } },
      });
      if (activeOnDate > 0) {
        // date already served (possibly by a manual replacement at another time)
        continue;
      }
      for (const row of required) {
        const spec = {
          openTourTemplateId: tpl.id,
          date: row.date,
          startTime: row.startTime,
          generatedByRuleId: row.generatedByRuleId,
          productId: base?.productId || null,
          productVariantId: base?.productVariantId || null,
          locationId,
          tourLanguage: tpl.tourLanguage,
          capacity,
        };
        const res = await ensureCanonicalSlot(client, spec, { log });
        if (res.outcome === 'reopened') summary.reopened.push({ id: res.id, date: row.date, startTime: row.startTime });
        else if (res.outcome === 'created') summary.created.push({ id: res.id, date: row.date, startTime: row.startTime });
      }
    }
  }

  return { ok: true, ...summary };
}

export async function runRepairGeneratedSlotIdentityOnce(client, log = console) {
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
    const summary = await repairGeneratedSlotIdentity(client, log);
    await client.maintenanceJob.update({
      where: { key: KEY },
      data: { status: 'done', finishedAt: new Date(), summary, error: null },
    });
    if (summary.reopened.length || summary.reattributed.length || summary.created.length) {
      kickTourCalendarSync();
      kickWooSync();
    }
    log?.log?.(
      `[repair:${KEY}] done — reattributed=${summary.reattributed.length} reopened=${summary.reopened.length} created=${summary.created.length}`,
    );
    return { done: true, summary };
  } catch (e) {
    await client.maintenanceJob
      .update({ where: { key: KEY }, data: { status: 'failed', error: String(e?.message || e) } })
      .catch(() => {});
    log?.warn?.(`[repair:${KEY}] FAILED: ${e?.message || e}`);
    return { failed: true };
  }
}

export function startRepairGeneratedSlotIdentity(client, log = console) {
  runRepairGeneratedSlotIdentityOnce(client, log).catch((e) =>
    log?.warn?.(`[repair:${KEY}] runner error: ${e?.message || e}`),
  );
}
