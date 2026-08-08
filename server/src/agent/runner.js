// ONE analysis run, end to end.
//
// Every attempt ends as an AgentRun row with an explicit status — including the
// deliberate skips. "Nothing happened" is never an acceptable outcome to leave
// unrecorded (the same rule newLeadAutoReply.js follows).
//
// SAFETY: nothing in this file sends a message or writes business data. It
// creates an AgentRun and, at most, an AgentProposal. The only code that can
// send is agent/proposals.js#sendProposal, which requires an authenticated
// operator and an explicit proposal id.
//
// Idempotency is structural: the AgentRun row is CLAIMED on
// (chatId, triggerMessageId) before any work happens, so the sweep's
// overlapping window, a restart mid-pass, or two instances cannot produce two
// runs — the loser of the insert race stops immediately.

import crypto from 'node:crypto';
import { prisma } from '../db.js';
import { loadSettings, loadStoredModes, ensureConfigSnapshot } from './config.js';
import { buildContextPack } from './context/pack.js';
import { buildAnalysisPrompt } from './prompts/build.js';
import { analyzeConversation, providerConfigured } from './provider/index.js';
import { resolveAuthority, offersToOperator, autoSendPermitted, DEGRADE_REASONS } from './authority.js';
import { runGuards, guardSummary } from './guards.js';
import { resolveStyleProfile } from './style.js';
import { capabilityDef } from './capabilities/registry.js';
import { leadSendLanguage } from '../whatsapp/leadLanguage.js';

export const SKIP_TEXT = Object.freeze({
  agent_disabled: 'הסוכן כבוי',
  provider_not_configured: 'שירות ה-AI אינו מוגדר בשרת (חסר ANTHROPIC_API_KEY)',
  chat_not_found: 'השיחה לא נמצאה',
  no_inbound_text: 'אין הודעת לקוח טקסטואלית לניתוח',
  duplicate: 'ההודעה כבר נותחה',
});

/** Sales while the deal is open, service once it is won. */
function audienceFor(pack) {
  return pack?.deal?.status === 'won' ? 'service' : 'sales';
}

/**
 * Sending language for the conversation. Canonical preference first (the
 * customer's phone country, via the shared lead-language resolver), then a
 * Hebrew-script check on what they actually wrote, then Hebrew.
 */
function resolveLanguage(chat, messages) {
  const { language } = leadSendLanguage(chat?.phoneNumber || null);
  if (language) return language;
  const inbound = [...messages].reverse().find((m) => m.direction === 'incoming' && m.textContent);
  if (inbound?.textContent && /[֐-׿]/.test(inbound.textContent)) return 'he';
  if (inbound?.textContent) return 'en';
  return 'he';
}

/**
 * Analyse ONE conversation turn.
 *
 * @param {object} p
 *   chatId            WhatsAppChat.id
 *   triggerMessageId  the WhatsAppMessage that triggered this run
 *   trigger           'inbound_message' | 'manual' | 'replay'
 * @returns {{ status, runId?, reason?, proposalId? }}
 */
export async function runAgentOnce(
  { chatId, triggerMessageId, trigger = 'inbound_message' },
  { db = prisma, log = console, provider = null } = {},
) {
  const settings = await loadSettings(db);
  if (!settings.enabled) return { status: 'skipped', reason: 'agent_disabled' };
  if (!providerConfigured(settings.provider)) {
    return { status: 'skipped', reason: 'provider_not_configured' };
  }

  // ── Claim ────────────────────────────────────────────────────────────────
  // Before ANY work, so an overlapping sweep window cannot analyse twice.
  let run;
  try {
    run = await db.agentRun.create({
      data: { trigger, status: 'pending', chatId, triggerMessageId },
      select: { id: true },
    });
  } catch (err) {
    if (err?.code === 'P2002') return { status: 'skipped', reason: 'duplicate' };
    throw err;
  }

  const finish = async (data) => {
    try {
      await db.agentRun.update({ where: { id: run.id }, data });
    } catch (e) {
      log.error?.(`[agent] run ${run.id} finalize failed: ${e?.message || e}`);
    }
  };
  const skip = async (reason, extra = {}) => {
    await finish({ status: 'skipped', skipReason: SKIP_TEXT[reason] || reason, ...extra });
    return { status: 'skipped', reason, runId: run.id };
  };

  try {
    const chat = await db.whatsAppChat.findUnique({
      where: { id: chatId },
      select: {
        id: true, accountId: true, contactId: true, type: true, phoneNumber: true,
        savedContactName: true, pushName: true, lastMessageAt: true,
      },
    });
    if (!chat) return skip('chat_not_found');

    const messages = await db.whatsAppMessage.findMany({
      where: { chatId },
      orderBy: { timestampFromSource: 'desc' },
      take: Math.max(4, Math.min(60, settings.recentMessageCount)),
      select: {
        id: true, externalMessageId: true, direction: true, messageType: true,
        textContent: true, timestampFromSource: true,
      },
    });
    messages.reverse(); // chronological for the prompt

    const hasInboundText = messages.some((m) => m.direction === 'incoming' && m.textContent?.trim());
    if (!hasInboundText) return skip('no_inbound_text');

    const language = resolveLanguage(chat, messages);
    const { pack, sources, dealId } = await buildContextPack({ chat, messages, language }, db);

    const [snapshot, storedModes] = await Promise.all([
      ensureConfigSnapshot(db),
      loadStoredModes(db),
    ]);
    const styleProfile = resolveStyleProfile(snapshot.config.style, {
      language,
      audience: audienceFor(pack),
    });

    await finish({
      accountId: chat.accountId,
      contactId: chat.contactId,
      dealId,
      provider: settings.provider,
      model: settings.model,
      promptVersion: snapshot.config.promptVersion,
      configSnapshotId: snapshot.id,
      contextSources: sources,
      contextPack: pack,
    });

    // ── The model call ──────────────────────────────────────────────────────
    const prompt = buildAnalysisPrompt({ pack, config: snapshot.config, styleProfile, language });
    let analysis;
    try {
      analysis = await analyzeConversation(
        {
          system: prompt.system,
          user: prompt.user,
          schema: prompt.schema,
          model: settings.model,
          effort: settings.effort,
          providerClient: provider,
        },
        { provider: settings.provider },
      );
    } catch (err) {
      // An AI failure is a recorded run, never an exception that reaches the
      // sweep. WhatsApp keeps working; the agent degrades.
      await finish({
        status: 'failed',
        errorCode: err?.code || 'ai_failed',
        errorMessage: err?.detail || String(err?.message || err).slice(0, 400),
      });
      return { status: 'failed', reason: err?.code || 'ai_failed', runId: run.id };
    }

    const r = analysis.result;

    // ── Guards: the layer that actually holds ───────────────────────────────
    // The internal deal title is fetched HERE and only here — solely so the
    // guard can detect it leaking. It is never part of the context pack.
    let dealTitle = null;
    if (dealId) {
      const d = await db.deal.findUnique({ where: { id: dealId }, select: { title: true } });
      dealTitle = d?.title || null;
    }
    const guards = runGuards({
      text: r.reply, pack, dealTitle, capabilityKey: r.capabilityKey,
    });

    // ── Authority ───────────────────────────────────────────────────────────
    const authority = resolveAuthority({
      enabled: settings.enabled,
      capabilityKey: r.capabilityKey,
      storedModes,
      confidence: r.confidence,
      contextPack: pack,
    });

    // Anything that forces a human, in priority order. A guard block outranks
    // everything: it means the draft itself is unsafe, not merely unauthorized.
    const escalate = guards.blocked || r.escalate || authority.degraded;
    const escalationReason = guards.blocked
      ? guardSummary(guards.findings)
      : (r.escalationReason || (authority.degraded ? DEGRADE_REASONS[authority.reason] : null));

    await finish({
      status: 'succeeded',
      authorityMode: authority.mode,
      model: analysis.model || settings.model,
      intent: capabilityDef(r.capabilityKey)?.labelHe || r.capabilityKey,
      capabilityKey: r.capabilityKey,
      confidence: r.confidence,
      escalate,
      escalationReason,
      guardFindings: guards.findings.length ? guards.findings : null,
      latencyMs: analysis.latencyMs ?? null,
      inputTokens: analysis.usage?.inputTokens ?? null,
      outputTokens: analysis.usage?.outputTokens ?? null,
    });

    // ── The proposal ────────────────────────────────────────────────────────
    //
    // status decides what an operator may DO with it:
    //   'shadow' — recorded only. Never offered, never sendable.
    //   'open'   — awaiting an explicit human decision.
    //
    // A guard-blocked or escalated draft is recorded as 'shadow' even in
    // approval mode: it is evidence and it is visible in Review as an
    // escalation, but it can never be sent with one click.
    const canOffer = offersToOperator(authority.mode) && !escalate;
    const proposalStatus = canOffer ? 'open' : 'shadow';

    const last = messages[messages.length - 1] || null;
    const dealRow = dealId
      ? await db.deal.findUnique({ where: { id: dealId }, select: { updatedAt: true } })
      : null;

    const proposal = await db.agentProposal.create({
      data: {
        runId: run.id,
        kind: 'reply',
        capabilityKey: r.capabilityKey,
        // IMMUTABLE. An operator edit writes finalText; this is never rewritten.
        proposedText: r.reply || null,
        proposedActions: null,
        status: proposalStatus,
        fpLastMessageId: last?.id || null,
        fpLastMessageAt: last?.timestampFromSource || null,
        fpMessageCount: await db.whatsAppMessage.count({ where: { chatId } }),
        fpDealUpdatedAt: dealRow?.updatedAt || null,
        idempotencyKey: `agent_proposal:${run.id}:${crypto.randomUUID()}`,
      },
      select: { id: true },
    });

    // Older open proposals on the same conversation are now answered by a newer
    // one. Superseding rather than deleting keeps the evidence trail intact.
    await db.agentProposal.updateMany({
      where: {
        status: 'open',
        id: { not: proposal.id },
        run: { chatId },
      },
      data: { status: 'superseded' },
    });

    // V1 INVARIANT, asserted at the only place it could ever be violated.
    if (authority.mode === 'auto' && !autoSendPermitted()) {
      log.info?.(`[agent] run ${run.id}: auto mode resolved but automatic sending is disabled in code — held for approval`);
    }

    return { status: 'succeeded', runId: run.id, proposalId: proposal.id, escalate };
  } catch (err) {
    await finish({
      status: 'failed',
      errorCode: 'runner_error',
      errorMessage: String(err?.message || err).slice(0, 400),
    });
    log.error?.(`[agent] run ${run.id} failed: ${err?.message || err}`);
    return { status: 'failed', reason: 'runner_error', runId: run.id };
  }
}
