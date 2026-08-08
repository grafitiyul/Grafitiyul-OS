// Evaluation metrics — the numbers the dashboard is built from.
//
// The rule this module follows: NEVER invent a metric that looks authoritative
// but is not. Everything here is a plain count over real rows, and every rate
// carries the denominator it came from, so "98%" can never hide "of 4 cases".
//
// The questions the dashboard has to answer, and the metric that answers each:
//   How much is it helping?      → runs, proposals offered, sends
//   Where is it good?            → per-capability accepted-unchanged rate
//   Where is it bad?             → per-capability edited/rejected rate
//   What needs my attention?     → open proposals, escalations, failures
//   What could safely automate?  → readiness, with an explicit, stated rule

import { prisma } from '../db.js';
import { listCapabilities, capabilityDef } from './capabilities/registry.js';
// ONE readiness rule for the whole module (dashboard, home and the capability
// screen). A second copy would eventually disagree with the first, and the
// operator would be told two different things about the same capability.
import { readinessFor, READINESS_RULE } from './readiness.js';

export { READINESS_RULE };

const SENT = ['sent_unchanged', 'sent_edited'];
const HANDLED = [...SENT, 'rejected', 'bypassed'];

function rate(n, d) {
  return d > 0 ? n / d : null;
}

/**
 * @param {number} days window size
 * @returns dashboard payload
 */
export async function agentMetrics({ days = 30 } = {}, db = prisma) {
  const since = new Date(Date.now() - days * 86_400_000);

  const [runsByStatus, escalations, proposalsByStatusCap, openCount, failures, tokenAgg, recentFailures] =
    await Promise.all([
      db.agentRun.groupBy({
        by: ['status'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
      db.agentRun.count({ where: { createdAt: { gte: since }, escalate: true, status: 'succeeded' } }),
      db.agentProposal.groupBy({
        by: ['capabilityKey', 'status'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
      db.agentProposal.count({ where: { status: 'open' } }),
      db.agentRun.count({ where: { createdAt: { gte: since }, status: 'failed' } }),
      db.agentRun.aggregate({
        where: { createdAt: { gte: since }, status: 'succeeded' },
        _sum: { inputTokens: true, outputTokens: true },
        _avg: { latencyMs: true },
        _count: { _all: true },
      }),
      db.agentRun.findMany({
        where: { createdAt: { gte: since }, status: 'failed' },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, errorCode: true, errorMessage: true, createdAt: true },
      }),
    ]);

  const runTotals = { succeeded: 0, failed: 0, skipped: 0, pending: 0 };
  for (const r of runsByStatus) runTotals[r.status] = r._count._all;
  const analysedTotal = runTotals.succeeded + runTotals.failed;

  // Per-capability quality. Only HANDLED proposals count in the denominator:
  // a shadow-mode recording carries no operator verdict, so including it would
  // silently deflate every rate.
  const byCap = new Map();
  for (const row of proposalsByStatusCap) {
    const key = row.capabilityKey || 'other';
    if (!byCap.has(key)) {
      byCap.set(key, { key, total: 0, shadow: 0, open: 0, unchanged: 0, edited: 0, rejected: 0, bypassed: 0, stale: 0, expired: 0, superseded: 0 });
    }
    const bucket = byCap.get(key);
    const n = row._count._all;
    bucket.total += n;
    if (row.status === 'sent_unchanged') bucket.unchanged += n;
    else if (row.status === 'sent_edited') bucket.edited += n;
    else if (row.status === 'rejected') bucket.rejected += n;
    else if (row.status === 'bypassed') bucket.bypassed += n;
    else if (row.status === 'shadow') bucket.shadow += n;
    else if (row.status === 'open') bucket.open += n;
    else if (row.status === 'stale') bucket.stale += n;
    else if (row.status === 'expired') bucket.expired += n;
    else if (row.status === 'superseded') bucket.superseded += n;
  }

  const capabilities = listCapabilities().map((def) => {
    const b = byCap.get(def.key) || { total: 0, shadow: 0, open: 0, unchanged: 0, edited: 0, rejected: 0, bypassed: 0, stale: 0, expired: 0, superseded: 0 };
    // The shared rule, with its human explanation. `ready` is advice for a
    // human — nothing in the codebase reads it and changes a mode.
    const readiness = readinessFor(def, b, def.defaultMode);
    return {
      key: def.key,
      labelHe: def.labelHe,
      risk: def.risk,
      maxMode: def.maxMode,
      observed: b.total,
      handled: readiness.handled,
      unchanged: b.unchanged,
      edited: b.edited,
      rejected: b.rejected,
      bypassed: b.bypassed,
      // Rates are null (not 0) until there is anything to divide by — the UI
      // renders "אין מספיק נתונים" rather than a misleading zero.
      unchangedRate: readiness.unchangedRate,
      rejectRate: readiness.rejectRate,
      readiness,
      ready: readiness.ready && def.maxMode === 'auto',
      readyBlockedByCeiling: readiness.ready && def.maxMode !== 'auto',
    };
  }).sort((a, b) => b.observed - a.observed);

  return {
    windowDays: days,
    runs: {
      ...runTotals,
      analysed: analysedTotal,
      escalations,
      escalationRate: rate(escalations, runTotals.succeeded),
      failures,
      failureRate: rate(failures, analysedTotal),
      avgLatencyMs: tokenAgg._avg?.latencyMs != null ? Math.round(tokenAgg._avg.latencyMs) : null,
      inputTokens: tokenAgg._sum?.inputTokens ?? 0,
      outputTokens: tokenAgg._sum?.outputTokens ?? 0,
    },
    proposals: {
      open: openCount,
      sentUnchanged: sumBy(byCap, 'unchanged'),
      sentEdited: sumBy(byCap, 'edited'),
      rejected: sumBy(byCap, 'rejected'),
      bypassed: sumBy(byCap, 'bypassed'),
      shadow: sumBy(byCap, 'shadow'),
    },
    capabilities,
    readinessRule: READINESS_RULE,
    recentFailures,
  };
}

function sumBy(map, field) {
  let n = 0;
  for (const b of map.values()) n += b[field] || 0;
  return n;
}

/** Escalation reasons, most common first — what knowledge is missing. */
export async function escalationBreakdown({ days = 30, limit = 12 } = {}, db = prisma) {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db.agentRun.findMany({
    where: { createdAt: { gte: since }, escalate: true, status: 'succeeded' },
    select: { capabilityKey: true, escalationReason: true },
    take: 2000,
  });
  const counts = new Map();
  for (const r of rows) {
    const reason = (r.escalationReason || 'ללא סיבה מפורטת').slice(0, 160);
    const key = `${r.capabilityKey || 'other'}::${reason}`;
    if (!counts.has(key)) {
      counts.set(key, {
        capabilityKey: r.capabilityKey || 'other',
        labelHe: capabilityDef(r.capabilityKey)?.labelHe || 'אחר',
        reason,
        count: 0,
      });
    }
    counts.get(key).count += 1;
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}
