// The controlled learning loop.
//
//   REAL WORK → detect repeated pattern → PROPOSED insight → human reviews →
//   approve/edit/reject → only an approved insight becomes an active rule.
//
// Three properties keep this safe:
//
//   1. THE AI NEVER REWRITES ITS OWN INSTRUCTIONS. Generation only ever writes
//      AgentInsight rows with status='open'. Nothing in this file can change
//      knowledge, playbook or style.
//
//   2. ONE EDIT IS NOT A LESSON. A single operator edit is RAW EVIDENCE. Only a
//      REPEATED pattern (MIN_EVIDENCE) is even eligible to become a proposal.
//
//   3. HISTORICAL ≠ APPROVED. Operator messages are evidence about how we
//      write, not a source of business truth. An insight is a suggestion for a
//      human to judge, and approving one writes a DRAFT row — never an active
//      rule directly.
//
// Strength is a WORD, not a percentage, because the underlying evidence is a
// small count and dressing it as "87% confidence" would be dishonest.

import { prisma } from '../db.js';
import { proposeInsights, providerConfigured } from './provider/index.js';
import { loadSettings } from './config.js';
import { capabilityDef } from './capabilities/registry.js';

const MIN_EVIDENCE = 5;
const MAX_EVIDENCE_SAMPLES = 40;

export function strengthFor(count) {
  if (count >= 20) return 'strong';
  if (count >= 10) return 'moderate';
  return 'initial';
}

export const STRENGTH_TEXT = Object.freeze({
  initial: 'ראשוני',
  moderate: 'בינוני',
  strong: 'חזק',
});

const INSIGHT_SCHEMA = {
  type: 'object',
  properties: {
    insights: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['knowledge', 'playbook', 'style'] },
          title: { type: 'string' },
          proposedChange: { type: 'string' },
          rationale: { type: 'string' },
          evidenceProposalIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['category', 'title', 'proposedChange', 'rationale', 'evidenceProposalIds'],
        additionalProperties: false,
      },
    },
  },
  required: ['insights'],
  additionalProperties: false,
};

const SYSTEM = [
  'You analyse how a human sales/service team EDITED or REJECTED an AI assistant\'s drafted WhatsApp replies, and propose improvements to that assistant\'s configuration.',
  '',
  'You are proposing changes for a HUMAN to review. You are not changing anything.',
  '',
  'Rules:',
  '- Propose a change ONLY when the same pattern appears across SEVERAL different cases. One edit is noise.',
  '- category "knowledge" = a business FACT the assistant did not have. category "playbook" = a WAY OF WORKING. category "style" = HOW WE PHRASE things.',
  '- NEVER propose a business fact you cannot see evidence for in the operators\' actual sent text. If operators consistently added a specific detail, propose exactly that detail — do not generalise it, extend it, or fill in adjacent facts.',
  '- Quote what operators actually wrote. Do not invent a policy.',
  '- Write titles and proposed changes in HEBREW; the operators read Hebrew.',
  '- proposedChange must be concrete enough to paste into a knowledge item or a rule — not "improve the tone".',
  '- If the evidence does not support any confident proposal, return an empty list. That is a correct answer.',
].join('\n');

/**
 * Gather raw evidence: proposals a human actually acted on, where the outcome
 * carries a signal (edited / rejected / bypassed). Sends-unchanged are the
 * control group and are counted, not analysed.
 */
export async function gatherEvidence({ days = 30 } = {}, db = prisma) {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db.agentProposal.findMany({
    where: {
      createdAt: { gte: since },
      status: { in: ['sent_edited', 'rejected', 'bypassed'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 400,
    select: {
      id: true, capabilityKey: true, status: true,
      proposedText: true, finalText: true, rejectReason: true,
      run: { select: { id: true, escalationReason: true, guardFindings: true } },
    },
  });
  const unchangedCount = await db.agentProposal.count({
    where: { createdAt: { gte: since }, status: 'sent_unchanged' },
  });
  return { rows, unchangedCount, since };
}

/** Group evidence by capability; only groups with enough repetition qualify. */
export function eligibleGroups(rows, { minEvidence = MIN_EVIDENCE } = {}) {
  const byCap = new Map();
  for (const r of rows) {
    const key = r.capabilityKey || 'other';
    if (!byCap.has(key)) byCap.set(key, []);
    byCap.get(key).push(r);
  }
  return [...byCap.entries()]
    .filter(([, list]) => list.length >= minEvidence)
    .map(([key, list]) => ({ capabilityKey: key, samples: list.slice(0, MAX_EVIDENCE_SAMPLES) }));
}

function renderGroup(group) {
  const label = capabilityDef(group.capabilityKey)?.labelHe || group.capabilityKey;
  const lines = group.samples.map((s, i) => {
    const parts = [`CASE ${i + 1} [id ${s.id}] outcome=${s.status}`];
    if (s.proposedText) parts.push(`  AI DRAFT: ${s.proposedText.slice(0, 600)}`);
    if (s.finalText) parts.push(`  OPERATOR SENT: ${s.finalText.slice(0, 600)}`);
    if (s.rejectReason) parts.push(`  REJECT REASON: ${s.rejectReason.slice(0, 300)}`);
    if (s.run?.escalationReason) parts.push(`  ESCALATION: ${s.run.escalationReason.slice(0, 200)}`);
    return parts.join('\n');
  });
  return `SITUATION CATEGORY: ${label} (${group.capabilityKey}) — ${group.samples.length} cases\n${lines.join('\n')}`;
}

/**
 * Generate PROPOSED insights. Writes only status='open' rows.
 * Safe to call repeatedly: a near-duplicate open proposal is not re-created.
 */
export async function generateInsights({ days = 30 } = {}, { db = prisma, log = console, provider = null } = {}) {
  const settings = await loadSettings(db);
  if (!providerConfigured(settings.provider)) {
    return { ok: false, reason: 'provider_not_configured', created: 0 };
  }

  const { rows, unchangedCount } = await gatherEvidence({ days }, db);
  const groups = eligibleGroups(rows);
  if (!groups.length) {
    return { ok: true, created: 0, reason: 'not_enough_evidence', evidence: rows.length, unchangedCount };
  }

  const user = [
    `Evidence window: last ${days} days.`,
    `${unchangedCount} drafts were sent completely unchanged (the control group — do not propose changes to what already works).`,
    '',
    ...groups.map(renderGroup),
    '',
    'Propose at most 6 changes in total, strongest evidence first.',
  ].join('\n\n');

  let out;
  try {
    out = await proposeInsights(
      { system: SYSTEM, user, schema: INSIGHT_SCHEMA, model: settings.model, effort: 'medium', providerClient: provider },
      { provider: settings.provider },
    );
  } catch (err) {
    log.error?.(`[agent-insights] generation failed: ${err?.code || err?.message}`);
    return { ok: false, reason: err?.code || 'ai_failed', created: 0 };
  }

  const existing = await db.agentInsight.findMany({
    where: { status: 'open' },
    select: { title: true },
  });
  const seen = new Set(existing.map((e) => normalizeTitle(e.title)));

  let created = 0;
  for (const i of out.result.insights) {
    const norm = normalizeTitle(i.title);
    if (seen.has(norm)) continue; // already waiting for the same decision
    seen.add(norm);
    const evidenceIds = i.evidenceProposalIds.filter((id) => rows.some((r) => r.id === id));
    const count = evidenceIds.length || 0;
    await db.agentInsight.create({
      data: {
        category: i.category,
        title: i.title,
        proposedChange: i.proposedChange,
        rationale: i.rationale,
        strength: strengthFor(count),
        evidenceCount: count,
        evidenceRefs: evidenceIds.map((id) => {
          const row = rows.find((r) => r.id === id);
          return {
            proposalId: id,
            runId: row?.run?.id || null,
            outcome: row?.status || null,
            excerpt: (row?.finalText || row?.proposedText || '').slice(0, 300) || null,
          };
        }),
      },
    });
    created += 1;
  }
  return { ok: true, created, evidence: rows.length, unchangedCount };
}

const normalizeTitle = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * APPROVE an insight — the ONE path from proposed to active configuration.
 *
 * It writes a DRAFT row, never an approved one. Two human decisions are
 * therefore required before agent behaviour changes: "this insight is worth
 * acting on", and then "this rule is correct as written". `editedChange` lets
 * the reviewer fix the wording without losing the original proposal.
 */
export async function approveInsight({ insightId, actorId, editedChange = null, title = null, category = null }, { db = prisma } = {}) {
  const insight = await db.agentInsight.findUnique({ where: { id: insightId } });
  if (!insight) return { ok: false, reason: 'not_found' };
  if (insight.status !== 'open') return { ok: false, reason: 'already_reviewed', status: insight.status };

  const finalCategory = ['knowledge', 'playbook', 'style'].includes(category) ? category : insight.category;
  const body = (typeof editedChange === 'string' && editedChange.trim()) ? editedChange.trim() : insight.proposedChange;
  const finalTitle = (typeof title === 'string' && title.trim()) ? title.trim() : insight.title;

  let recordId = null;
  if (finalCategory === 'knowledge') {
    const row = await db.agentKnowledgeItem.create({
      data: {
        title: finalTitle, body, category: 'general', language: 'both',
        status: 'draft', createdById: actorId || null, sourceInsightId: insight.id,
      },
      select: { id: true },
    });
    recordId = row.id;
  } else if (finalCategory === 'playbook') {
    const row = await db.agentPlaybookRule.create({
      data: {
        title: finalTitle,
        whenText: insight.rationale || 'ראה נימוק בתובנה',
        thenText: body,
        category: 'service', language: 'both',
        status: 'draft', createdById: actorId || null, sourceInsightId: insight.id,
      },
      select: { id: true },
    });
    recordId = row.id;
  } else {
    // A style insight does not mint a profile — profiles are fixed by
    // (language, audience). It lands as a note on the reviewer's screen, which
    // then edits the real profile field. Recording it as 'approved' with no
    // appliedRecordId is the honest state.
    recordId = null;
  }

  await db.agentInsight.update({
    where: { id: insight.id },
    data: {
      status: 'approved',
      appliedRecordId: recordId,
      reviewedById: actorId || null,
      reviewedAt: new Date(),
    },
  });
  return { ok: true, category: finalCategory, recordId };
}

export async function rejectInsight({ insightId, actorId, note = null }, { db = prisma } = {}) {
  const res = await db.agentInsight.updateMany({
    where: { id: insightId, status: 'open' },
    data: {
      status: 'rejected',
      reviewNote: note ? String(note).slice(0, 500) : null,
      reviewedById: actorId || null,
      reviewedAt: new Date(),
    },
  });
  return res.count === 1 ? { ok: true } : { ok: false, reason: 'already_reviewed' };
}
