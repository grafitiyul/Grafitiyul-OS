// The Home read projection.
//
// One composed READ over services that already exist — settings, the capability
// matrix, the configuration tables, run/proposal counts. It stores nothing,
// decides nothing, and adds no new concept: it exists so the operator's first
// screen is one round-trip instead of six, and so "what should I do today" is
// answered by the server rather than assembled by guesswork in the client.
//
// Every number here must be something the architecture can truthfully produce.
// Nothing is invented for the sake of a nicer-looking dashboard.

import { prisma } from '../db.js';
import { loadSettings, loadCapabilityMatrix } from './config.js';
import { safetySummary } from './safety.js';
import { onboardingState } from './onboarding.js';
import { readinessFor } from './readiness.js';
import { providerConfigured } from './provider/index.js';
import { capabilityDef } from './capabilities/registry.js';

export async function agentHome({ days = 30 } = {}, db = prisma) {
  const since = new Date(Date.now() - days * 86_400_000);

  const [
    settings, matrix, knowledge, playbook, styles,
    runsByStatus, escalatedCount, proposalGroups, openProposals,
    insightOpen, insightTotal, recentEscalations, lastRun,
  ] = await Promise.all([
    loadSettings(db),
    loadCapabilityMatrix(db),
    db.agentKnowledgeItem.findMany({
      where: { archivedAt: null }, select: { id: true, status: true, category: true },
    }),
    db.agentPlaybookRule.findMany({
      where: { archivedAt: null }, select: { id: true, status: true },
    }),
    db.agentStyleProfile.findMany({
      where: { archivedAt: null },
      select: { id: true, key: true, name: true, language: true, audience: true, status: true, rules: true },
    }),
    db.agentRun.groupBy({ by: ['status'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    db.agentRun.count({ where: { createdAt: { gte: since }, escalate: true, status: 'succeeded' } }),
    db.agentProposal.groupBy({
      by: ['capabilityKey', 'status'], where: { createdAt: { gte: since } }, _count: { _all: true },
    }),
    db.agentProposal.count({ where: { status: 'open' } }),
    db.agentInsight.count({ where: { status: 'open' } }),
    db.agentInsight.count(),
    // WHY it escalates — the operator's shopping list for the Knowledge screen.
    db.agentRun.findMany({
      where: { createdAt: { gte: since }, escalate: true, status: 'succeeded' },
      select: { capabilityKey: true, escalationReason: true },
      take: 500,
    }),
    db.agentRun.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true, status: true } }),
  ]);

  const runTotals = { succeeded: 0, failed: 0, skipped: 0, pending: 0 };
  for (const r of runsByStatus) runTotals[r.status] = r._count._all;

  // Per-capability proposal outcomes.
  const counts = new Map();
  const bucket = (k) => {
    if (!counts.has(k)) {
      counts.set(k, { observed: 0, shadow: 0, open: 0, unchanged: 0, edited: 0, rejected: 0, bypassed: 0 });
    }
    return counts.get(k);
  };
  for (const row of proposalGroups) {
    const b = bucket(row.capabilityKey || 'other');
    const n = row._count._all;
    b.observed += n;
    if (row.status === 'sent_unchanged') b.unchanged += n;
    else if (row.status === 'sent_edited') b.edited += n;
    else if (row.status === 'rejected') b.rejected += n;
    else if (row.status === 'bypassed') b.bypassed += n;
    else if (row.status === 'shadow') b.shadow += n;
    else if (row.status === 'open') b.open += n;
  }

  const handledTotal = [...counts.values()].reduce(
    (n, b) => n + b.unchanged + b.edited + b.rejected + b.bypassed, 0,
  );

  const capabilities = matrix.map((c) => {
    const b = counts.get(c.key) || { observed: 0, shadow: 0, open: 0, unchanged: 0, edited: 0, rejected: 0, bypassed: 0 };
    return { ...c, counts: b, readiness: readinessFor(c, b, c.mode) };
  });

  const safety = safetySummary(settings, matrix);
  const onboarding = onboardingState({
    settings, matrix, knowledge, playbook, styles,
    runCount: runTotals.succeeded + runTotals.failed,
    proposalCount: [...counts.values()].reduce((n, b) => n + b.observed, 0),
    handledCount: handledTotal,
    insightCount: insightTotal,
  });

  // Escalation reasons, most common first. This is the honest answer to
  // "what does the agent NOT know" — it comes from real runs, not a guess.
  const reasonCounts = new Map();
  for (const r of recentEscalations) {
    const reason = (r.escalationReason || 'ללא סיבה מפורטת').slice(0, 160);
    const key = `${r.capabilityKey || 'other'}::${reason}`;
    if (!reasonCounts.has(key)) {
      reasonCounts.set(key, {
        capabilityKey: r.capabilityKey || 'other',
        labelHe: capabilityDef(r.capabilityKey)?.labelHe || 'אחר',
        reason,
        count: 0,
      });
    }
    reasonCounts.get(key).count += 1;
  }
  const missingKnowledge = [...reasonCounts.values()].sort((a, b) => b.count - a.count).slice(0, 8);

  // "What should I do today" — every entry must be clickable into a real,
  // filtered view, and must be a number the backend can truthfully produce.
  const attention = [
    {
      key: 'open_proposals',
      labelHe: 'ממתינות לאישור',
      count: openProposals,
      to: '/admin/ai-agent/review?status=open',
      tone: openProposals > 0 ? 'amber' : 'neutral',
      emptyHe: 'אין הצעות שממתינות לך',
    },
    {
      key: 'open_insights',
      labelHe: 'תובנות חדשות',
      count: insightOpen,
      to: '/admin/ai-agent/learning',
      tone: insightOpen > 0 ? 'purple' : 'neutral',
      emptyHe: 'אין תובנות חדשות',
    },
    {
      key: 'escalations',
      labelHe: 'הועברו אליך כי חסר ידע',
      count: escalatedCount,
      to: '/admin/ai-agent/history?escalated=1',
      tone: escalatedCount > 0 ? 'orange' : 'neutral',
      emptyHe: 'הסוכן לא נתקע על שום שיחה',
    },
    {
      key: 'failures',
      labelHe: 'תקלות טכניות',
      count: runTotals.failed,
      to: '/admin/ai-agent/history?status=failed',
      tone: runTotals.failed > 0 ? 'rose' : 'neutral',
      emptyHe: 'אין תקלות',
    },
  ];

  const readyForPromotion = capabilities.filter((c) => c.readiness.ready);

  return {
    windowDays: days,
    settings: {
      enabled: settings.enabled,
      model: settings.model,
      effort: settings.effort,
    },
    providerConfigured: providerConfigured(settings.provider),
    safety,
    onboarding,
    attention,
    activity: {
      analysed: runTotals.succeeded + runTotals.failed,
      succeeded: runTotals.succeeded,
      failed: runTotals.failed,
      escalations: escalatedCount,
      handled: handledTotal,
      lastRunAt: lastRun?.createdAt || null,
    },
    brain: {
      knowledgeApproved: knowledge.filter((k) => k.status === 'approved').length,
      knowledgeDraft: knowledge.filter((k) => k.status === 'draft').length,
      playbookApproved: playbook.filter((r) => r.status === 'approved').length,
      playbookDraft: playbook.filter((r) => r.status === 'draft').length,
      styleApproved: styles.filter((s) => s.status === 'approved').length,
      styleTotal: styles.length,
    },
    missingKnowledge,
    readyForPromotion: readyForPromotion.map((c) => ({
      key: c.key, labelHe: c.labelHe, mode: c.mode,
      nextMode: c.readiness.nextMode, reasonHe: c.readiness.reasonHe,
    })),
    capabilities,
  };
}
