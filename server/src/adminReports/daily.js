// Daily scheduled admin reports — driven by the EXISTING admin-reports worker
// tick (no second scheduler, no cron dependency).
//
// Scheduling contract: on every tick each scheduled report asks "has today's
// Israel-time slot passed?"; if so it fires with the idempotency key
// `daily:<number>:<YYYY-MM-DD>`. The (reportNumber, idempotencyKey) unique
// index makes that exactly-once per day across restarts, retries and any
// future second instance — the same guarantee the event reports rely on.
//
// Empty-state convention (audited from the module): a report with nothing to
// say sends NO WhatsApp message but still records an auditable `skipped`
// delivery row, exactly like an unconfigured report — so the operator can see
// the report ran and found nothing.

import { prisma } from '../db.js';
import { israelToday } from '../lib/israelDate.js';
import { israelParts } from '../communication/windows.js';
import { scheduledReports, reportByNumber } from './registry.js';
import { fireAdminReport } from './dispatch.js';
import {
  collectCoordinationWindow, collectMissingSummaries, last7DayRange, yesterdayRange,
} from './collectors.js';
import { collectGuideDigests } from './guideDigest.js';

/** Today's Israel date-key for a scheduled report's idempotency. */
export function dailyKey(number, nowMs = Date.now()) {
  return `daily:${number}:${israelToday(nowMs)}`;
}

/** Has today's scheduled slot already passed in Israel time? */
export function slotPassed(schedule, nowMs = Date.now()) {
  const { minutes } = israelParts(nowMs);
  return minutes >= schedule.hour * 60 + schedule.minute;
}

async function alreadyRan(number, key, client) {
  const existing = await client.adminReportDelivery.findUnique({
    where: { reportNumber_idempotencyKey: { reportNumber: number, idempotencyKey: key } },
    select: { id: true },
  });
  return !!existing;
}

/** Record the auditable "ran, nothing to report" row (no message sent). */
async function recordEmpty(number, key, text, client) {
  await client.adminReportDelivery.create({
    data: {
      reportNumber: number, idempotencyKey: key,
      status: 'skipped', skipReason: text, renderedText: null,
    },
  }).catch((e) => { if (e?.code !== 'P2002') throw e; });
}

/**
 * Run one scheduled report for today if its slot has passed and it has not run
 * yet. Returns a short outcome for logging/tests.
 */
export async function runScheduledReport(number, { nowMs = Date.now(), client = prisma, log = console } = {}) {
  const report = reportByNumber(number);
  if (!report?.schedule) return { skipped: 'not_scheduled' };
  if (!slotPassed(report.schedule, nowMs)) return { skipped: 'before_slot' };
  const key = dailyKey(number, nowMs);
  if (await alreadyRan(number, key, client)) return { skipped: 'already_ran' };

  if (number === 6) {
    const items = await collectCoordinationWindow(nowMs, client);
    if (!items.length) {
      await recordEmpty(number, key, report.emptyHe, client);
      return { ran: true, items: 0, sent: false };
    }
    await fireAdminReport({ number, idempotencyKey: key, data: { aggregate: { items } } }, log);
    return { ran: true, items: items.length, sent: true };
  }

  if (number === 7) {
    const items = await collectMissingSummaries({ ...last7DayRange(nowMs), nowMs, client });
    if (!items.length) {
      await recordEmpty(number, key, report.emptyHe, client);
      return { ran: true, items: 0, sent: false };
    }
    await fireAdminReport({ number, idempotencyKey: key, data: { aggregate: { items } } }, log);
    return { ran: true, items: items.length, sent: true };
  }

  if (number === 11) {
    // ONE message per guide, each carrying only that guide's own tours. The
    // per-guide key makes every guide's digest independently deduped, so a
    // crash mid-fan-out resumes exactly where it stopped.
    // Activation floor: no historical catch-up. Only summaries for tours that
    // ended AFTER this notification was switched on are ever reported.
    const cfg = await client.adminReportConfig.findUnique({
      where: { reportNumber: 11 }, select: { activatedAt: true },
    });
    const digests = await collectGuideDigests({
      nowMs, client, activatedAtMs: cfg?.activatedAt?.getTime() ?? null,
    });
    if (!digests.length) {
      await recordEmpty(number, key, report.emptyHe, client);
      return { ran: true, items: 0, sent: false };
    }
    for (const d of digests) {
      await fireAdminReport({
        number,
        idempotencyKey: `daily:11:${israelToday(nowMs)}:${d.recipient.personRefId || d.recipient.name}`,
        recipient: d.recipient,
        data: { guideDigest: d.guideDigest },
      }, log);
    }
    await recordEmpty(number, key, `נשלחו ${digests.length} דיווחים אישיים`, client);
    return { ran: true, items: digests.length, sent: true };
  }

  if (number === 8) {
    // ONE delivery per missing guide/tour (owner requirement: each missing
    // guide independently auditable, and the message format is single-guide).
    // The per-item key keeps every obligation deduped on its own.
    const items = await collectMissingSummaries({ ...yesterdayRange(nowMs), nowMs, client });
    if (!items.length) {
      await recordEmpty(number, key, report.emptyHe, client);
      return { ran: true, items: 0, sent: false };
    }
    for (const item of items) {
      await fireAdminReport({
        number,
        idempotencyKey: `daily:8:${israelToday(nowMs)}:${item.key}`,
        dealId: item.dealId,
        data: {
          summaryReport: {
            guideName: item.guideName, productName: item.productName, cityName: item.cityName,
            tourDate: item.tourDate, tourTime: item.tourTime, tourEventId: item.tourEventId,
          },
        },
      }, log);
    }
    // Day marker so the slot is not re-run for the rest of the day.
    await recordEmpty(number, key, `נשלחו ${items.length} דיווחים נפרדים`, client);
    return { ran: true, items: items.length, sent: true };
  }
  return { skipped: 'no_collector' };
}

/** Called by the admin-reports worker on every tick. */
export async function runDueScheduledReports({ nowMs = Date.now(), client = prisma, log = console } = {}) {
  const out = [];
  for (const r of scheduledReports()) {
    try {
      const result = await runScheduledReport(r.number, { nowMs, client, log });
      if (result.ran) {
        log.info?.(`[admin-reports] daily #${r.number} ran — ${result.items} item(s), sent=${result.sent}`);
        out.push({ number: r.number, ...result });
      }
    } catch (err) {
      log.error?.(`[admin-reports] daily #${r.number} failed: ${err?.message || err}`);
    }
  }
  return out;
}
