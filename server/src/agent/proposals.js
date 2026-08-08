// Proposal lifecycle — staleness, approval, edit, rejection, and the ONE send
// path.
//
// This is the only module in the agent that can cause a customer-facing side
// effect, and it can do so only when called from an authenticated operator
// action carrying a specific proposal id. Three properties make that safe:
//
//   NO WRITE BEFORE THE FINAL ACTION. Reading a proposal, opening it, or
//   closing the card changes nothing. Dismissing never executes.
//
//   STALENESS. A proposal carries a fingerprint of the conversation and the
//   deal at the moment it was drafted. If the customer wrote again, another
//   operator replied, or the deal moved, the proposal is stale and CANNOT be
//   sent — the answer may no longer be true.
//
//   IDEMPOTENCY. The send claims the proposal's unique idempotencyKey with a
//   conditional update. Two operators clicking at the same moment produce one
//   outbound message; the loser gets a clear "already handled".

import { prisma } from '../db.js';
import { enqueueCustomerWhatsApp } from '../whatsapp/customerQueue.js';
import { invokeTool, previewAction } from './tools/registry.js';
import { autoSendPermitted } from './authority.js';

/** Statuses a human decision may still act on. */
const ACTIONABLE = new Set(['open']);

export const STALE_REASONS = Object.freeze({
  newer_message: 'הגיעה הודעה חדשה בשיחה מאז שההצעה נוצרה',
  operator_replied: 'מפעיל כבר ענה בשיחה',
  deal_changed: 'פרטי הדיל השתנו מאז שההצעה נוצרה',
  superseded: 'נוצרה הצעה חדשה יותר לשיחה הזו',
});

/**
 * Is this proposal still safe to act on? Pure given the two snapshots, so it is
 * directly testable and used identically by the API and the UI badge.
 *
 * @param {object} proposal  with fp* fields
 * @param {object} live      { lastMessageId, messageCount, dealUpdatedAt }
 */
export function stalenessOf(proposal, live) {
  if (!proposal) return { stale: true, reason: 'superseded' };
  if (proposal.status === 'superseded') return { stale: true, reason: 'superseded' };

  if (proposal.fpLastMessageId && live?.lastMessageId
      && proposal.fpLastMessageId !== live.lastMessageId) {
    return { stale: true, reason: 'newer_message' };
  }
  if (Number.isFinite(proposal.fpMessageCount) && Number.isFinite(live?.messageCount)
      && live.messageCount > proposal.fpMessageCount) {
    return { stale: true, reason: 'newer_message' };
  }
  if (proposal.fpDealUpdatedAt && live?.dealUpdatedAt
      && new Date(live.dealUpdatedAt).getTime() > new Date(proposal.fpDealUpdatedAt).getTime()) {
    return { stale: true, reason: 'deal_changed' };
  }
  return { stale: false, reason: null };
}

/** Read the live fingerprint for a proposal's conversation. */
export async function liveFingerprint(runRow, db = prisma) {
  const chatId = runRow?.chatId;
  if (!chatId) return { lastMessageId: null, messageCount: null, dealUpdatedAt: null };
  const [last, messageCount, deal] = await Promise.all([
    db.whatsAppMessage.findFirst({
      where: { chatId },
      orderBy: { timestampFromSource: 'desc' },
      select: { id: true, direction: true },
    }),
    db.whatsAppMessage.count({ where: { chatId } }),
    runRow.dealId
      ? db.deal.findUnique({ where: { id: runRow.dealId }, select: { updatedAt: true } })
      : Promise.resolve(null),
  ]);
  return {
    lastMessageId: last?.id || null,
    lastMessageDirection: last?.direction || null,
    messageCount,
    dealUpdatedAt: deal?.updatedAt || null,
  };
}

/** A proposal with its live staleness verdict attached. */
export async function loadProposal(id, db = prisma) {
  const proposal = await db.agentProposal.findUnique({
    where: { id },
    include: {
      run: {
        select: {
          id: true, chatId: true, dealId: true, contactId: true, accountId: true,
          capabilityKey: true, intent: true, confidence: true, escalate: true,
          escalationReason: true, guardFindings: true, authorityMode: true,
          contextSources: true, contextPack: true, configSnapshotId: true,
          promptVersion: true, model: true, provider: true, latencyMs: true,
          createdAt: true,
        },
      },
    },
  });
  if (!proposal) return null;
  const live = await liveFingerprint(proposal.run, db);
  return { ...proposal, staleness: stalenessOf(proposal, live), live };
}

/**
 * SEND. The only customer-facing side effect in the agent.
 *
 * @param {object} p
 *   proposalId
 *   actorId    the authenticated AdminUser making the decision
 *   text       null = send the proposal unchanged; a string = the operator's edit
 * @returns discriminated result — callers surface the reason verbatim.
 */
export async function sendProposal({ proposalId, actorId, text = null }, { db = prisma } = {}) {
  const proposal = await loadProposal(proposalId, db);
  if (!proposal) return { ok: false, reason: 'not_found' };
  if (!ACTIONABLE.has(proposal.status)) {
    return { ok: false, reason: 'already_handled', status: proposal.status };
  }
  if (proposal.staleness.stale) {
    // Mark it, so the operator's next read explains itself rather than the
    // button simply refusing.
    await db.agentProposal.updateMany({
      where: { id: proposal.id, status: 'open' },
      data: { status: 'stale' },
    });
    return { ok: false, reason: 'stale', detail: STALE_REASONS[proposal.staleness.reason] };
  }

  const edited = typeof text === 'string' && text.trim() && text.trim() !== (proposal.proposedText || '').trim();
  const finalText = (typeof text === 'string' && text.trim()) ? text.trim() : (proposal.proposedText || '');
  if (!finalText) return { ok: false, reason: 'empty_text' };

  const chat = await db.whatsAppChat.findUnique({
    where: { id: proposal.run.chatId },
    select: { id: true, accountId: true, phoneNumber: true },
  });
  if (!chat?.phoneNumber) return { ok: false, reason: 'no_phone' };

  // ── Claim ────────────────────────────────────────────────────────────────
  // Conditional on status='open', so exactly one concurrent caller proceeds.
  const claimed = await db.agentProposal.updateMany({
    where: { id: proposal.id, status: 'open' },
    data: {
      status: edited ? 'sent_edited' : 'sent_unchanged',
      finalText,
      handledById: actorId || null,
      handledAt: new Date(),
    },
  });
  if (claimed.count !== 1) return { ok: false, reason: 'already_handled' };

  // ── The canonical customer queue. Never the bridge, never send.js. ───────
  // Sending windows, connection deferral, retries, pacing and delivery logging
  // all belong to the queue; re-implementing any of it here is how a second,
  // weaker sender gets born.
  const queued = await enqueueCustomerWhatsApp(db, {
    phone: chat.phoneNumber,
    text: finalText,
    explicitAccountId: chat.accountId,
    createdById: `ai-agent:${proposal.id}`,
  });

  if (!queued.ok) {
    // Roll the decision back so the operator can retry — a failed enqueue must
    // not leave a proposal claiming it was sent.
    await db.agentProposal.update({
      where: { id: proposal.id },
      data: { status: 'open', finalText: null, handledById: null, handledAt: null },
    });
    return { ok: false, reason: queued.reason };
  }

  await db.agentProposal.update({
    where: { id: proposal.id },
    data: { scheduledMessageId: queued.scheduledMessageId },
  });

  return {
    ok: true,
    edited,
    scheduledMessageId: queued.scheduledMessageId,
    chatId: chat.id,
  };
}

/** REJECT — the operator says no. Evidence, with a reason when they give one. */
export async function rejectProposal({ proposalId, actorId, reason = null }, { db = prisma } = {}) {
  const claimed = await db.agentProposal.updateMany({
    where: { id: proposalId, status: 'open' },
    data: {
      status: 'rejected',
      rejectReason: reason ? String(reason).slice(0, 500) : null,
      handledById: actorId || null,
      handledAt: new Date(),
    },
  });
  return claimed.count === 1 ? { ok: true } : { ok: false, reason: 'already_handled' };
}

/**
 * Execute an approved ACTION. Separate from sending a reply on purpose: an
 * action changes GOS data, so it carries its own approval and its own preview.
 */
export async function approveAction({ proposalId, toolKey, input, actorId }, { db = prisma } = {}) {
  const proposal = await loadProposal(proposalId, db);
  if (!proposal) return { ok: false, reason: 'not_found' };
  if (proposal.staleness.stale) {
    return { ok: false, reason: 'stale', detail: STALE_REASONS[proposal.staleness.reason] };
  }
  const ctx = {
    dealId: proposal.run.dealId,
    dealOrderNo: proposal.run.contextPack?.deal?.orderNo ?? null,
    chatId: proposal.run.chatId,
    actorId,
  };
  const result = await invokeTool(toolKey, input, ctx, db);
  if (!result.ok) return result;
  await db.agentProposal.update({
    where: { id: proposal.id },
    data: { handledById: actorId || null, handledAt: new Date() },
  });
  return result;
}

/**
 * The operator answered the customer themselves without using the suggestion.
 * Recorded as 'bypassed' rather than left open, because "they ignored it" is a
 * DIFFERENT and equally important signal from "they rejected it" — one means
 * the suggestion was wrong, the other that it was too slow or invisible.
 *
 * Called from the WhatsApp send path; never throws into it.
 */
export async function markBypassedByOperatorReply({ chatId }, { db = prisma } = {}) {
  if (!chatId) return 0;
  try {
    const res = await db.agentProposal.updateMany({
      where: { status: 'open', run: { chatId } },
      data: { status: 'bypassed', handledAt: new Date() },
    });
    return res.count;
  } catch {
    return 0;
  }
}

/** Proposals older than the window that nobody ever handled. */
export async function expireStaleProposals({ olderThanHours = 24 } = {}, db = prisma) {
  const cutoff = new Date(Date.now() - olderThanHours * 3_600_000);
  const res = await db.agentProposal.updateMany({
    where: { status: 'open', createdAt: { lt: cutoff } },
    data: { status: 'expired' },
  });
  return res.count;
}

/** Action previews for a proposal, built fresh (never trusted from storage). */
export function actionPreviews(proposal) {
  const actions = Array.isArray(proposal?.proposedActions) ? proposal.proposedActions : [];
  const ctx = {
    dealId: proposal?.run?.dealId,
    dealOrderNo: proposal?.run?.contextPack?.deal?.orderNo ?? null,
  };
  return actions
    .map((a) => previewAction(a.toolKey, a.input, ctx))
    .filter(Boolean)
    // V1: an action can never be pre-approved, and the UI says so.
    .map((p) => ({ ...p, requiresApproval: true, autoAllowed: autoSendPermitted() }));
}
