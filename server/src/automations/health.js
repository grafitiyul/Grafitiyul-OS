// Live operational health — what makes the registry a control center rather
// than a catalog.
//
// An automation that CANNOT run must say so on the list screen, with the
// specific reason, before anyone has to ask why nothing happened. Silence is
// the failure mode this module exists to remove.
//
// Status is COMPUTED ON READ, never stored. A status column would be one more
// thing that can go stale — exactly the drift the whole design prevents.
// Recomputing is cheap (a handful of indexed lookups per automation) and can
// never be wrong.

import { prisma } from '../db.js';
import { automationById, listRegistryEntries } from './registry.js';
import { resolveDependencies } from './dependencies.js';
import { retiredEntry } from './ledger.js';

export const STATUS = {
  retired: 'retired',
  disabled: 'disabled',
  broken: 'broken',
  waiting_dependency: 'waiting_dependency',
  error: 'error',
  active: 'active',
};

export const STATUS_LABELS_HE = {
  retired: 'הוסרה',
  disabled: 'מושבתת',
  broken: 'שבורה',
  waiting_dependency: 'ממתינה לתלות',
  error: 'שגיאה',
  active: 'פעילה',
};

// Precedence, most severe first. A disabled automation that is ALSO broken
// reports 'disabled' — the operator turned it off deliberately — but the
// breakage still appears as a secondary chip, never hidden.
export const STATUS_ORDER = ['retired', 'disabled', 'broken', 'waiting_dependency', 'error', 'active'];

/** Failures inside this window make an otherwise-healthy automation 'error'. */
export const ERROR_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Resolved on/off: the operator override wins, else the definition default. */
export function resolveEnabled(def, state) {
  if (state && typeof state.enabled === 'boolean') return state.enabled;
  return !!def?.defaultEnabled;
}

/**
 * Full health for ONE automation id.
 *
 * Returns { id, status, statusHe, reasonHe, enabled, dependencies, secondary,
 *           stats } — everything the list row and the detail header need.
 */
export async function resolveHealth(id, { db = prisma } = {}) {
  const def = automationById(id);
  const retired = retiredEntry(id);

  if (!def) {
    // Retired: history stays visible, and the id is never reused.
    return {
      id,
      status: STATUS.retired,
      statusHe: STATUS_LABELS_HE.retired,
      reasonHe: retired
        ? `הוסרה ב-${retired.retiredOn} · ${retired.reasonHe}`
        : 'האוטומציה אינה רשומה במערכת',
      enabled: false,
      dependencies: [],
      secondary: [],
      stats: await runStats(id, { db }),
    };
  }

  const [state, dependencies, stats] = await Promise.all([
    db.automationState.findUnique({ where: { autId: id } }),
    resolveDependencies(def, { db }),
    runStats(id, { db }),
  ]);

  const enabled = resolveEnabled(def, state);
  const failed = dependencies.filter((d) => !d.ok);
  const hardFailures = failed.filter((d) => d.severity === 'hard');
  const softFailures = failed.filter((d) => d.severity !== 'hard');
  const recentErrors = stats.failedInWindow > 0;

  // Every condition that is true, in precedence order. The first is the primary
  // status; the rest become chips so nothing is masked.
  const conditions = [];
  if (!enabled) {
    conditions.push({
      status: STATUS.disabled,
      reasonHe: state?.updatedByName ? `הושבתה על ידי ${state.updatedByName}` : 'האוטומציה מושבתת',
    });
  }
  if (hardFailures.length) {
    conditions.push({ status: STATUS.broken, reasonHe: hardFailures[0].detailHe });
  }
  if (softFailures.length) {
    conditions.push({ status: STATUS.waiting_dependency, reasonHe: softFailures[0].detailHe });
  }
  if (recentErrors) {
    conditions.push({
      status: STATUS.error,
      reasonHe: `${stats.failedInWindow} הרצות נכשלו בשבוע האחרון${stats.lastError ? ` · ${stats.lastError}` : ''}`,
    });
  }
  if (!conditions.length) {
    conditions.push({
      status: STATUS.active,
      reasonHe: stats.totalRuns > 0 ? 'פעילה' : 'פעילה · טרם רצה',
    });
  }

  conditions.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
  const [primary, ...secondary] = conditions;

  return {
    id,
    status: primary.status,
    statusHe: STATUS_LABELS_HE[primary.status],
    reasonHe: primary.reasonHe,
    enabled,
    dependencies,
    secondary: secondary.map((c) => ({ ...c, statusHe: STATUS_LABELS_HE[c.status] })),
    stats,
  };
}

/**
 * Execution facts for one automation — the SOLE source of "last execution",
 * run count and the error indicator. Nothing here is maintained by hand.
 */
export async function runStats(id, { db = prisma, now = Date.now() } = {}) {
  const since = new Date(now - ERROR_WINDOW_MS);
  const [totalRuns, failedInWindow, last, lastSuccess, lastFailure] = await Promise.all([
    db.automationRun.count({ where: { autId: id } }),
    db.automationRun.count({ where: { autId: id, status: 'failed', startedAt: { gte: since } } }),
    db.automationRun.findFirst({ where: { autId: id }, orderBy: { startedAt: 'desc' } }),
    db.automationRun.findFirst({ where: { autId: id, status: 'ran' }, orderBy: { startedAt: 'desc' } }),
    db.automationRun.findFirst({ where: { autId: id, status: 'failed' }, orderBy: { startedAt: 'desc' } }),
  ]);
  return {
    totalRuns,
    failedInWindow,
    lastRunAt: last?.startedAt || null,
    lastRunStatus: last?.status || null,
    lastSuccessAt: lastSuccess?.startedAt || null,
    lastFailureAt: lastFailure?.startedAt || null,
    lastError: lastFailure?.reasonHe || null,
  };
}

/** Health for every registry entry — the list screen's one query path. */
export async function resolveAllHealth({ db = prisma } = {}) {
  const entries = listRegistryEntries();
  return Promise.all(entries.map((e) => resolveHealth(e.id, { db })));
}

/** True when an automation is in a state a human must look at. */
export function needsAttention(health) {
  return health.status === STATUS.broken || health.status === STATUS.error;
}
