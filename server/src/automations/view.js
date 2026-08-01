// The registry's read model — the ONE place the screen's data is assembled.
//
// Every field here comes from exactly one of:
//   1. the definition module the runtime executes (trigger, condition, actions);
//   2. a LIVE read of the owning subsystem (dependencies, communication rules);
//   3. execution facts the runtime wrote (AutomationRun / AutomationChange).
//
// There is deliberately no writable field that describes behaviour, so there is
// nowhere for a stale description to live. That is the whole reason the registry
// can be trusted as an operational screen rather than documentation.

import { prisma } from '../db.js';
import { listRegistryEntries, automationById, automationTriggerType } from './registry.js';
import { resolveHealth, STATUS_LABELS_HE } from './health.js';
import { actionKind } from './actionKinds.js';
import { CATEGORIES } from './registry.js';
import { retiredEntry } from './ledger.js';

/** Compact row for the list screen. */
export async function listView({ db = prisma } = {}) {
  const entries = listRegistryEntries();
  const rows = await Promise.all(entries.map(async ({ id, def, retired }) => {
    const health = await resolveHealth(id, { db });
    const rules = def ? await communicationRulesFor(def, { db }) : [];
    return {
      id,
      nameHe: def?.nameHe || retired?.reasonHe || id,
      categoryHe: def ? CATEGORIES[def.category] : null,
      status: health.status,
      statusHe: health.statusHe,
      reasonHe: health.reasonHe,
      secondary: health.secondary,
      triggerHe: def ? triggerLabel(def) : null,
      questionnaireKey: def?.trigger?.templateKey || null,
      mainActionHe: def ? (actionKind(def.actions[0]?.kind)?.labelHe || def.actions[0]?.kind) : null,
      communicationRuleCount: rules.reduce((n, r) => n + r.messages.length, 0),
      lastRunAt: health.stats.lastRunAt,
      lastRunStatus: health.stats.lastRunStatus,
      totalRuns: health.stats.totalRuns,
      failedInWindow: health.stats.failedInWindow,
      retired: !!retired,
    };
  }));
  return rows;
}

/** Everything the detail screen renders. */
export async function detailView(id, { db = prisma, runLimit = 50 } = {}) {
  const def = automationById(id);
  const retired = retiredEntry(id);
  if (!def && !retired) return null;

  const [health, runs, changes] = await Promise.all([
    resolveHealth(id, { db }),
    db.automationRun.findMany({ where: { autId: id }, orderBy: { startedAt: 'desc' }, take: runLimit }),
    db.automationChange.findMany({ where: { autId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
  ]);

  const communicationRules = def ? await communicationRulesFor(def, { db }) : [];

  return {
    id,
    retired: retired ? { ...retired } : null,
    definition: def ? {
      nameHe: def.nameHe,
      descriptionHe: def.descriptionHe,
      notesHe: def.notesHe || null,
      categoryHe: CATEGORIES[def.category],
      defaultEnabled: def.defaultEnabled,
      triggerHe: triggerLabel(def),
      questionnaireKey: def.trigger?.templateKey || null,
      purpose: def.trigger?.purpose || null,
      firstSubmitOnly: def.trigger?.firstSubmitOnly !== false,
      // The condition in plain Hebrew, plus the raw expression for anyone who
      // wants the exact keys.
      conditionHe: describeCondition(def.when),
      condition: def.when || null,
      idempotencyHe: 'מפתח אידמפוטנטיות לכל הגשה — הגשה חוזרת של אותו טופס לא תשלח פעמיים.',
      actions: def.actions.map((a, i) => {
        const kind = actionKind(a.kind);
        return {
          order: i + 1,
          kind: a.kind,
          labelHe: kind?.labelHe || a.kind,
          ownerLabelHe: kind?.ownerLabelHe || null,
          ownerLink: kind?.ownerLink || null,
          retryHe: kind?.retryHe || null,
          config: Object.fromEntries(Object.entries(a).filter(([k]) => k !== 'kind')),
        };
      }),
    } : null,
    health: {
      status: health.status,
      statusHe: health.statusHe,
      reasonHe: health.reasonHe,
      enabled: health.enabled,
      secondary: health.secondary,
    },
    dependencies: health.dependencies.map((d) => ({
      kind: d.dep.kind,
      ok: d.ok,
      severity: d.severity,
      labelHe: d.labelHe,
      detailHe: d.detailHe,
      link: d.link,
    })),
    // The execution chain, resolved LIVE from the Communication Center — never
    // copied into the definition, so a deleted or disabled rule shows as such.
    communicationRules,
    stats: health.stats,
    runs: runs.map((r) => ({
      id: r.id,
      status: r.status,
      reasonHe: r.reasonHe,
      stoppedAt: r.stoppedAt,
      input: r.input,
      actionResults: r.actionResults,
      dealId: r.dealId,
      tourEventId: r.tourEventId,
      submissionId: r.submissionId,
      durationMs: r.durationMs,
      startedAt: r.startedAt,
    })),
    changes: changes.map((c) => ({
      kind: c.kind, summaryHe: c.summaryHe, actorName: c.actorName, createdAt: c.createdAt,
    })),
    statusLabels: STATUS_LABELS_HE,
  };
}

/**
 * Which Communication Center rules this automation actually invokes, read live.
 * This is the execution-chain visibility requirement: the registry shows WHICH
 * rules fire, by their real #N numbers and current status; it never shows or
 * edits WHAT they say.
 */
export async function communicationRulesFor(def, { db = prisma } = {}) {
  if (!def.actions.some((a) => a.kind === 'communication')) return [];
  const events = await db.communicationEvent.findMany({
    where: { triggerType: automationTriggerType(def.id) },
    select: {
      id: true, internalName: true, status: true,
      messages: {
        select: { id: true, publicNumber: true, internalName: true, channel: true, status: true, publishedVersionId: true },
        orderBy: { publicNumber: 'asc' },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
  return events.map((e) => ({
    id: e.id,
    internalName: e.internalName,
    status: e.status,
    link: `/admin/settings/communication/events/${e.id}`,
    messages: e.messages.map((m) => ({
      id: m.id,
      number: m.publicNumber,
      internalName: m.internalName,
      channel: m.channel,
      status: m.status,
      live: m.status === 'active' && !!m.publishedVersionId,
    })),
  }));
}

function triggerLabel(def) {
  if (def.trigger?.kind !== 'questionnaire_submitted') return def.trigger?.kind || '—';
  const first = def.trigger.firstSubmitOnly !== false ? ' (הגשה ראשונה בלבד)' : '';
  return `הגשת שאלון "${def.trigger.templateKey}"${first}`;
}

const OP_HE = {
  eq: 'שווה ל', neq: 'שונה מ', in: 'אחד מ', nin: 'לא אחד מ',
  gt: 'גדול מ', gte: 'גדול או שווה ל', lt: 'קטן מ', lte: 'קטן או שווה ל',
  answered: 'נענתה', empty: 'ריקה', contains: 'מכילה',
};

/**
 * A condition in readable Hebrew, WITHOUT inventing question text — the keys are
 * the identity and the builder is where the wording lives. Showing a label here
 * would be a second, drifting copy of the questionnaire's content.
 */
export function describeCondition(expr) {
  if (!expr) return 'ללא תנאי — כל הגשה מפעילה';
  const walk = (node) => {
    if (!node || typeof node !== 'object') return '';
    if (Array.isArray(node.all)) return `(${node.all.map(walk).join(' וגם ')})`;
    if (Array.isArray(node.any)) return `(${node.any.map(walk).join(' או ')})`;
    if (node.not !== undefined) return `לא ${walk(node.not)}`;
    const op = OP_HE[node.op] || node.op;
    if (['answered', 'empty'].includes(node.op)) return `שאלה ${node.q} ${op}`;
    const value = Array.isArray(node.value) ? node.value.join(', ') : node.value;
    return `שאלה ${node.q} ${op} ${value}`;
  };
  return walk(expr);
}
