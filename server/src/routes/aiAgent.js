// סוכן AI — admin API.
//
// Mounted behind requireAdminAuth. Every mutation that could ever reach a
// customer additionally requires an identified session (requireAdminUser), so a
// bootstrap-mode install can never send a message with a null actor.
//
// Route groups:
//   /settings /capabilities         configuration + authority
//   /knowledge /playbook /style     what the agent is made of
//   /runs /proposals                audit + operator decisions
//   /insights                       the learning inbox
//   /metrics /escalations           evaluation

import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { requireAdminUser } from '../auth.js';
import {
  loadSettings, saveSettings, loadCapabilityMatrix,
} from '../agent/config.js';
import {
  listCapabilities, clampMode, isKnownCapability, MODES, MODE_LABELS, MODE_HELP,
  CAPABILITY_GROUPS, modeImpactHe,
} from '../agent/capabilities/registry.js';
import { agentHome } from '../agent/home.js';
import { readinessFor, READINESS_RULE, READINESS_STATE_LABELS } from '../agent/readiness.js';
import { providerConfigured } from '../agent/provider/index.js';
import { STYLE_FIELDS, normalizeStyleRules, seedStyleProfiles } from '../agent/style.js';
import { listTools } from '../agent/tools/registry.js';
import {
  loadProposal, sendProposal, rejectProposal, approveAction, actionPreviews, STALE_REASONS,
} from '../agent/proposals.js';
import { agentMetrics, escalationBreakdown } from '../agent/metrics.js';
import {
  generateInsights, approveInsight, rejectInsight, STRENGTH_TEXT,
} from '../agent/insights.js';
import { runAgentOnce } from '../agent/runner.js';
import { GUARD_TEXT } from '../agent/guards.js';

const router = Router();

const actor = (req) => req.adminAuth?.userId || null;
const str = (v, max = 4000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// ── Settings ────────────────────────────────────────────────────────────────

router.get('/settings', handle(async (_req, res) => {
  const settings = await loadSettings();
  res.json({
    settings,
    providerConfigured: providerConfigured(settings.provider),
    modes: MODES.map((m) => ({ key: m, labelHe: MODE_LABELS[m], helpHe: MODE_HELP[m] })),
    tools: listTools(),
    guardCodes: Object.entries(GUARD_TEXT).map(([code, textHe]) => ({ code, textHe })),
  });
}));

router.put('/settings', requireAdminUser, handle(async (req, res) => {
  const settings = await saveSettings(req.body || {}, { actorId: actor(req) });
  res.json({ settings, providerConfigured: providerConfigured(settings.provider) });
}));

// ── Home ────────────────────────────────────────────────────────────────────
// ONE composed read for the operator's landing screen. Adds no storage and no
// new concept — it exists so "what is happening and what should I do" is one
// round-trip and one truthful answer.

router.get('/home', handle(async (req, res) => {
  const days = Math.min(180, Math.max(1, Number(req.query.days) || 30));
  res.json(await agentHome({ days }));
}));

// ── Authority ───────────────────────────────────────────────────────────────

router.get('/capabilities', handle(async (req, res) => {
  const days = Math.min(180, Math.max(1, Number(req.query.days) || 30));
  // The capability screen needs the same readiness evidence the home screen
  // shows, so the decision and the evidence for it live on one page.
  const home = await agentHome({ days });
  res.json({
    capabilities: home.capabilities,
    groups: CAPABILITY_GROUPS,
    modes: MODES.map((m) => ({ key: m, labelHe: MODE_LABELS[m], helpHe: MODE_HELP[m] })),
    readinessRule: READINESS_RULE,
    readinessLabels: READINESS_STATE_LABELS,
    safety: home.safety,
  });
}));

// What ACTUALLY changes if this capability moves to `mode` — the sentence the
// confirmation shows before anything is written. A GET, so previewing an
// authority change can never itself be an authority change.
router.get('/capabilities/:key/impact', handle(async (req, res) => {
  const { key } = req.params;
  if (!isKnownCapability(key)) return res.status(404).json({ error: 'unknown_capability' });
  const mode = String(req.query.mode || '');
  const clamped = clampMode(key, mode);
  if (!clamped) return res.status(400).json({ error: 'invalid_mode' });
  res.json({
    key,
    mode: clamped,
    allowed: clamped === mode,
    impactHe: modeImpactHe(key, clamped),
  });
}));

router.put('/capabilities/:key', requireAdminUser, handle(async (req, res) => {
  const { key } = req.params;
  if (!isKnownCapability(key)) return res.status(404).json({ error: 'unknown_capability' });

  // The code ceiling is enforced HERE as well as in the resolver: an API client
  // must not be able to store a mode the UI would never offer.
  const requested = String(req.body?.mode || '');
  const mode = clampMode(key, requested);
  if (!mode) return res.status(400).json({ error: 'invalid_mode' });
  if (mode !== requested) {
    return res.status(422).json({
      error: 'mode_above_ceiling',
      message: `הקטגוריה הזו לא יכולה לעבור למצב "${MODE_LABELS[requested] || requested}".`,
      allowed: mode,
    });
  }

  const conditions = req.body?.conditions && typeof req.body.conditions === 'object'
    ? req.body.conditions : null;

  await prisma.agentCapabilityState.upsert({
    where: { key },
    create: { key, mode, conditions, updatedById: actor(req) },
    update: { mode, conditions, updatedById: actor(req) },
  });
  res.json({ capabilities: await loadCapabilityMatrix() });
}));

// ── Knowledge / Playbook: same shape, one generic handler pair ──────────────

const COLLECTIONS = {
  knowledge: {
    model: () => prisma.agentKnowledgeItem,
    fields: ['title', 'body', 'category', 'language', 'sortOrder'],
    required: ['title', 'body'],
    defaults: { category: 'general', language: 'both', sortOrder: 0 },
  },
  playbook: {
    model: () => prisma.agentPlaybookRule,
    fields: ['title', 'whenText', 'thenText', 'category', 'language', 'priority'],
    required: ['title', 'whenText', 'thenText'],
    defaults: { category: 'service', language: 'both', priority: 100 },
  },
};

function pickFields(body, spec) {
  const out = {};
  for (const f of spec.fields) {
    if (body[f] === undefined) continue;
    out[f] = typeof body[f] === 'number' ? Math.round(body[f]) : str(body[f]);
  }
  return out;
}

for (const [name, spec] of Object.entries(COLLECTIONS)) {
  router.get(`/${name}`, handle(async (req, res) => {
    const includeArchived = req.query.includeArchived === '1';
    const rows = await spec.model().findMany({
      where: includeArchived ? {} : { archivedAt: null },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
    res.json({ items: rows });
  }));

  router.post(`/${name}`, requireAdminUser, handle(async (req, res) => {
    const data = { ...spec.defaults, ...pickFields(req.body || {}, spec) };
    for (const f of spec.required) {
      if (!data[f]) return res.status(400).json({ error: 'missing_field', field: f });
    }
    const row = await spec.model().create({
      data: { ...data, status: 'draft', createdById: actor(req) },
    });
    res.status(201).json({ item: row });
  }));

  router.put(`/${name}/:id`, requireAdminUser, handle(async (req, res) => {
    const patch = pickFields(req.body || {}, spec);
    // Editing an APPROVED row returns it to draft on purpose: a change to
    // active agent behaviour must be re-approved, and the previously approved
    // wording lives on inside every config snapshot that used it.
    const current = await spec.model().findUnique({ where: { id: req.params.id } });
    if (!current) return res.status(404).json({ error: 'not_found' });
    if (current.status === 'approved') {
      patch.status = 'draft';
      patch.approvedById = null;
      patch.approvedAt = null;
    }
    const row = await spec.model().update({ where: { id: req.params.id }, data: patch });
    res.json({ item: row });
  }));

  // Approve / unapprove / archive. Archive, never delete — historical runs
  // reference these rows and their provenance must stay readable.
  router.post(`/${name}/:id/status`, requireAdminUser, handle(async (req, res) => {
    const status = String(req.body?.status || '');
    if (!['draft', 'approved', 'archived'].includes(status)) {
      return res.status(400).json({ error: 'invalid_status' });
    }
    const data = { status };
    if (status === 'approved') { data.approvedById = actor(req); data.approvedAt = new Date(); data.archivedAt = null; }
    if (status === 'archived') data.archivedAt = new Date();
    if (status === 'draft') { data.approvedById = null; data.approvedAt = null; data.archivedAt = null; }
    const row = await spec.model().update({ where: { id: req.params.id }, data });
    res.json({ item: row });
  }));
}

// ── Style ───────────────────────────────────────────────────────────────────

router.get('/style', handle(async (_req, res) => {
  let profiles = await prisma.agentStyleProfile.findMany({
    where: { archivedAt: null },
    orderBy: [{ language: 'asc' }, { audience: 'asc' }],
  });
  // Materialize the four canonical profiles on first read. They ship EMPTY and
  // as drafts — we never fabricate a brand voice.
  if (!profiles.length) {
    await prisma.agentStyleProfile.createMany({
      data: seedStyleProfiles().map((p) => ({ ...p, status: 'draft' })),
      skipDuplicates: true,
    });
    profiles = await prisma.agentStyleProfile.findMany({
      where: { archivedAt: null },
      orderBy: [{ language: 'asc' }, { audience: 'asc' }],
    });
  }
  res.json({ profiles, fields: STYLE_FIELDS });
}));

router.put('/style/:id', requireAdminUser, handle(async (req, res) => {
  const current = await prisma.agentStyleProfile.findUnique({ where: { id: req.params.id } });
  if (!current) return res.status(404).json({ error: 'not_found' });
  const data = { rules: normalizeStyleRules(req.body?.rules) };
  if (str(req.body?.name)) data.name = str(req.body.name, 120);
  if (current.status === 'approved') {
    data.status = 'draft';
    data.approvedById = null;
    data.approvedAt = null;
  }
  const row = await prisma.agentStyleProfile.update({ where: { id: req.params.id }, data });
  res.json({ profile: row });
}));

router.post('/style/:id/status', requireAdminUser, handle(async (req, res) => {
  const status = String(req.body?.status || '');
  if (!['draft', 'approved', 'archived'].includes(status)) {
    return res.status(400).json({ error: 'invalid_status' });
  }
  const data = { status };
  if (status === 'approved') { data.approvedById = actor(req); data.approvedAt = new Date(); }
  if (status === 'draft') { data.approvedById = null; data.approvedAt = null; }
  if (status === 'archived') data.archivedAt = new Date();
  const row = await prisma.agentStyleProfile.update({ where: { id: req.params.id }, data });
  res.json({ profile: row });
}));

// ── Runs (history / audit) ──────────────────────────────────────────────────

router.get('/runs', handle(async (req, res) => {
  const take = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
  const where = {};
  if (req.query.status) where.status = String(req.query.status);
  if (req.query.capabilityKey) where.capabilityKey = String(req.query.capabilityKey);
  if (req.query.escalated === '1') where.escalate = true;
  const runs = await prisma.agentRun.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true, trigger: true, status: true, chatId: true, dealId: true,
      capabilityKey: true, intent: true, confidence: true, escalate: true,
      escalationReason: true, authorityMode: true, model: true, promptVersion: true,
      configSnapshotId: true, latencyMs: true, inputTokens: true, outputTokens: true,
      errorCode: true, errorMessage: true, skipReason: true, createdAt: true,
      contextSources: true,
      proposals: { select: { id: true, status: true }, take: 1, orderBy: { createdAt: 'desc' } },
    },
  });
  res.json({ runs });
}));

// Full provenance for ONE run — the "למה?" view. Deliberately returns the
// context pack and the configuration counts, never chain-of-thought (there is
// none stored, by design).
router.get('/runs/:id', handle(async (req, res) => {
  const run = await prisma.agentRun.findUnique({
    where: { id: req.params.id },
    include: {
      proposals: { orderBy: { createdAt: 'desc' } },
      configSnapshot: { select: { id: true, hash: true, itemCounts: true, createdAt: true } },
    },
  });
  if (!run) return res.status(404).json({ error: 'not_found' });
  res.json({ run });
}));

// Manual re-analysis of a conversation — the operator asking "what would you
// say here?". Same runner, same guards, same authority. Never sends.
router.post('/runs/replay', requireAdminUser, handle(async (req, res) => {
  const chatId = str(req.body?.chatId, 40);
  if (!chatId) return res.status(400).json({ error: 'missing_chatId' });
  const last = await prisma.whatsAppMessage.findFirst({
    where: { chatId, direction: 'incoming', messageType: 'text' },
    orderBy: { timestampFromSource: 'desc' },
    select: { id: true },
  });
  if (!last) return res.status(422).json({ error: 'no_inbound_text' });
  const result = await runAgentOnce(
    { chatId, triggerMessageId: `manual:${last.id}:${Date.now()}`, trigger: 'manual' },
  );
  res.json(result);
}));

// ── Proposals ───────────────────────────────────────────────────────────────

router.get('/proposals', handle(async (req, res) => {
  const take = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
  const status = req.query.status ? String(req.query.status) : 'open';
  const rows = await prisma.agentProposal.findMany({
    where: status === 'all' ? {} : { status },
    orderBy: { createdAt: 'desc' },
    take,
    include: {
      run: {
        select: {
          id: true, chatId: true, dealId: true, capabilityKey: true, intent: true,
          confidence: true, escalate: true, escalationReason: true, guardFindings: true,
          authorityMode: true, contextPack: true, contextSources: true, createdAt: true,
        },
      },
    },
  });
  res.json({ proposals: rows });
}));

// Everything a conversation surface needs to render the suggestion card.
router.get('/proposals/for-chat/:chatId', handle(async (req, res) => {
  const row = await prisma.agentProposal.findFirst({
    where: { status: { in: ['open', 'shadow'] }, run: { chatId: req.params.chatId } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (!row) return res.json({ proposal: null });
  const proposal = await loadProposal(row.id);
  res.json({
    proposal: proposal && {
      ...proposal,
      actions: actionPreviews(proposal),
      staleReasonHe: proposal.staleness.stale ? STALE_REASONS[proposal.staleness.reason] : null,
    },
  });
}));

router.get('/proposals/:id', handle(async (req, res) => {
  const proposal = await loadProposal(req.params.id);
  if (!proposal) return res.status(404).json({ error: 'not_found' });
  res.json({
    proposal: {
      ...proposal,
      actions: actionPreviews(proposal),
      staleReasonHe: proposal.staleness.stale ? STALE_REASONS[proposal.staleness.reason] : null,
    },
  });
}));

// THE send. An identified operator, an explicit proposal id, and nothing else
// in the codebase can reach a customer through the agent.
router.post('/proposals/:id/send', requireAdminUser, handle(async (req, res) => {
  const result = await sendProposal({
    proposalId: req.params.id,
    actorId: actor(req),
    text: typeof req.body?.text === 'string' ? req.body.text : null,
  });
  if (!result.ok) {
    const status = result.reason === 'not_found' ? 404 : 422;
    return res.status(status).json({ error: result.reason, message: result.detail || null });
  }
  res.json(result);
}));

router.post('/proposals/:id/reject', requireAdminUser, handle(async (req, res) => {
  const result = await rejectProposal({
    proposalId: req.params.id,
    actorId: actor(req),
    reason: str(req.body?.reason, 500),
  });
  if (!result.ok) return res.status(422).json({ error: result.reason });
  res.json(result);
}));

router.post('/proposals/:id/actions/:toolKey', requireAdminUser, handle(async (req, res) => {
  const result = await approveAction({
    proposalId: req.params.id,
    toolKey: req.params.toolKey,
    input: req.body?.input || {},
    actorId: actor(req),
  });
  if (!result.ok) return res.status(422).json({ error: result.reason, message: result.detail || null });
  res.json(result);
}));

// ── Learning ────────────────────────────────────────────────────────────────

router.get('/insights', handle(async (req, res) => {
  const status = req.query.status ? String(req.query.status) : 'open';
  const insights = await prisma.agentInsight.findMany({
    where: status === 'all' ? {} : { status },
    orderBy: [{ createdAt: 'desc' }],
    take: 100,
  });
  res.json({ insights, strengthLabels: STRENGTH_TEXT });
}));

router.post('/insights/generate', requireAdminUser, handle(async (req, res) => {
  const days = Math.min(180, Math.max(7, Number(req.body?.days) || 30));
  const result = await generateInsights({ days });
  if (!result.ok) return res.status(422).json({ error: result.reason });
  res.json(result);
}));

router.post('/insights/:id/approve', requireAdminUser, handle(async (req, res) => {
  const result = await approveInsight({
    insightId: req.params.id,
    actorId: actor(req),
    editedChange: typeof req.body?.proposedChange === 'string' ? req.body.proposedChange : null,
    title: typeof req.body?.title === 'string' ? req.body.title : null,
    category: req.body?.category,
  });
  if (!result.ok) {
    return res.status(result.reason === 'not_found' ? 404 : 422).json({ error: result.reason });
  }
  res.json(result);
}));

router.post('/insights/:id/reject', requireAdminUser, handle(async (req, res) => {
  const result = await rejectInsight({
    insightId: req.params.id, actorId: actor(req), note: str(req.body?.note, 500),
  });
  if (!result.ok) return res.status(422).json({ error: result.reason });
  res.json(result);
}));

// ── Evaluation ──────────────────────────────────────────────────────────────

router.get('/metrics', handle(async (req, res) => {
  const days = Math.min(180, Math.max(1, Number(req.query.days) || 30));
  const [metrics, escalations, settings] = await Promise.all([
    agentMetrics({ days }),
    escalationBreakdown({ days }),
    loadSettings(),
  ]);
  res.json({
    ...metrics,
    escalationReasons: escalations,
    settings: { enabled: settings.enabled, model: settings.model, effort: settings.effort },
    providerConfigured: providerConfigured(settings.provider),
    capabilityDefs: listCapabilities().map((c) => ({
      key: c.key, labelHe: c.labelHe, purposeHe: c.purposeHe, riskHe: c.riskHe,
      risk: c.risk, maxMode: c.maxMode, defaultMode: c.defaultMode,
    })),
  });
}));

export default router;
