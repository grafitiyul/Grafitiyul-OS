import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { gmail, emailIntegrationConfigured } from './googleClient.js';
import { ingestGmailMessage } from './ingest.js';
import { matchContactByEmails } from './matching.js';
import { applyLabelChange, applyMessageDeleted, recomputeThreadState } from './providerState.js';

// Gmail sync worker — READ-ONLY mirror (scope gmail.readonly: it physically
// cannot archive/label/mark-read, so it can never fight Make/Pipedrive during
// the transition). Same in-process interval shape as the WhatsApp scheduled
// worker: one 60s tick, re-entrancy guarded, safe to re-run — every message
// ingest is idempotent on (accountId, gmailMessageId).
//
// Two phases per account:
//   backfill    — first connect: capture profile.historyId FIRST, then page
//                 messages.list q=newer_than:30d (newest first), skipping known
//                 ids, budgeted per tick. When a full pass adds nothing new →
//                 backfillDone. Anything arriving DURING backfill is covered by
//                 the pre-captured cursor.
//   incremental — users.history.list from the stored cursor; 404 = cursor
//                 expired → re-seed cursor + re-run the (cheap, skip-known)
//                 backfill to close the gap.

const TICK_MS = 60_000;
const BACKFILL_QUERY = 'newer_than:30d';
const LIST_PAGE_SIZE = 100;
// Hard safety cap on list pages per backfill pass (50 × 100 = 5,000 messages —
// far beyond a 30-day business mailbox). Hitting it logs a truncation warning
// and completes anyway: the pre-captured history cursor covers everything from
// connect-time forward regardless.
const MAX_LIST_PAGES = 50;
const MAX_FETCH_PER_TICK = 40; // full-message downloads per account per tick

let timer = null;
let ticking = false;
// Per-account overlap guard: the manual "סנכרון עכשיו" endpoint and the worker
// tick may target the same account concurrently. Ingest is idempotent either
// way (unique constraints), but running twice just burns Gmail quota — skip.
// In-process only; GOS runs as one service (project deployment rule).
const activeSyncs = new Set();

export function startEmailSyncWorker(logger = console) {
  if (timer) return;
  if (!emailIntegrationConfigured()) {
    logger.log('[email-sync] GOOGLE_CLIENT_ID/SECRET or EMAIL_TOKEN_KEY not set — worker not started');
    return;
  }
  timer = setInterval(() => {
    tick(logger).catch((e) => logger.error('[email-sync] tick failed:', e));
  }, TICK_MS);
  if (timer.unref) timer.unref();
  logger.log('[email-sync] worker started (60s tick)');
}

export function stopEmailSyncWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}

async function tick(logger) {
  if (ticking) return;
  ticking = true;
  try {
    const accounts = await prisma.emailAccount.findMany({
      where: { isActive: true, refreshTokenEnc: { not: null } },
    });
    for (const account of accounts) {
      try {
        await syncAccount(account, logger);
      } catch (e) {
        logger.error(`[email-sync] account ${account.emailAddress} failed:`, e?.message || e);
      }
    }
  } finally {
    ticking = false;
  }
}

// Also invoked directly by POST /api/email/accounts/:id/sync.
export async function syncAccount(accountOrId, logger = console) {
  const account =
    typeof accountOrId === 'string'
      ? await prisma.emailAccount.findUnique({ where: { id: accountOrId } })
      : accountOrId;
  if (!account || !account.isActive || !account.refreshTokenEnc) return { skipped: true };
  if (activeSyncs.has(account.id)) return { skipped: true, reason: 'already_syncing' };
  activeSyncs.add(account.id);

  try {
    // NOTE: syncStatus is a display surface, NOT a lock — a crash mid-sync
    // leaves it 'syncing' but the next tick simply syncs again (all ingest is
    // idempotent), so there is no stuck state to clean up manually.
    await prisma.emailAccount.update({
      where: { id: account.id },
      data: { syncStatus: 'syncing' },
    });
    const result = !account.backfillDone
      ? await backfillAccount(account, logger)
      : await incrementalSync(account, logger);
    // Backfill Gmail labels onto rows mirrored before the labelIds column
    // existed (self-terminating: no-op once none are null). Keeps the active
    // inbox honest for pre-existing data without any manual cleanup.
    await reconcileNullLabels(account, logger);
    // Snapshot reconciliation — the convergence guarantee: every tick, GOS's
    // idea of "in the inbox / unread" is forced to match Gmail's CURRENT
    // INBOX/UNREAD state, healing anything history events ever missed
    // (expired cursors, gaps, historical inflation). This is what makes the
    // GOS inbox trustworthy enough to stop opening Gmail.
    await snapshotInboxState(account, logger);
    // Self-healing pass: contacts created AFTER their emails arrived (or a
    // crash inside the tiny ingest→link window) get matched here.
    await rematchUnmatchedThreads(account, logger);
    await prisma.emailAccount.update({
      where: { id: account.id },
      data: { syncStatus: 'idle', syncError: null, lastSyncAt: new Date() },
    });
    return result;
  } catch (e) {
    // Token revoked / config broken → surfaced on the account row for the UI.
    const message = (e?.message || String(e)).slice(0, 500);
    await prisma.emailAccount.update({
      where: { id: account.id },
      data: { syncStatus: 'error', syncError: message, lastSyncAt: new Date() },
    });
    throw e;
  } finally {
    activeSyncs.delete(account.id);
  }
}

// ── Inbox snapshot reconciliation ────────────────────────────────────────────
// Lists Gmail's CURRENT inbox (id-only, cheap) and diffs it against the
// mirror in both directions:
//   • mirror rows claiming INBOX that Gmail no longer has there → INBOX
//     stripped (thread drops out of the active inbox)
//   • Gmail inbox ids missing from the mirror → imported (budgeted)
//   • UNREAD refreshed for every current inbox message, so the GOS unread
//     badge equals Gmail's
// All idempotent; affected threads are recomputed once.

const SNAPSHOT_FETCH_BUDGET = 20; // full-message imports per pass
const SNAPSHOT_MAX_IDS = 5000; // hard cap — a real inbox is far smaller

async function listAllMessageIds(account, labelIds) {
  const ids = new Set();
  let pageToken;
  do {
    const page = await gmail.listMessages(prisma, account, {
      labelIds,
      maxResults: 500,
      pageToken,
    });
    for (const m of page.messages || []) ids.add(m.id);
    pageToken = page.nextPageToken;
  } while (pageToken && ids.size < SNAPSHOT_MAX_IDS);
  return ids;
}

async function snapshotInboxState(account, logger) {
  const inboxIds = await listAllMessageIds(account, ['INBOX']);
  const unreadIds = await listAllMessageIds(account, ['INBOX', 'UNREAD']);
  const dirty = new Set();
  let stripped = 0;
  let refreshed = 0;
  let imported = 0;

  // 1) Rows claiming INBOX that Gmail no longer has in the inbox → strip the
  //    label (archived/deleted in Gmail while we weren't looking).
  const claiming = await prisma.emailMessage.findMany({
    where: {
      accountId: account.id,
      providerDeletedAt: null,
      labelIds: { array_contains: ['INBOX'] },
    },
    select: { id: true, gmailMessageId: true, threadId: true, labelIds: true },
  });
  for (const row of claiming) {
    if (inboxIds.has(row.gmailMessageId)) continue;
    await prisma.emailMessage.update({
      where: { id: row.id },
      data: { labelIds: (row.labelIds || []).filter((l) => l !== 'INBOX') },
    });
    dirty.add(row.threadId);
    stripped += 1;
  }

  // 2) Gmail's current inbox: ensure every id is mirrored with correct
  //    INBOX/UNREAD labels.
  const idList = [...inboxIds];
  const known = new Map();
  for (let i = 0; i < idList.length; i += 200) {
    const rows = await prisma.emailMessage.findMany({
      where: { accountId: account.id, gmailMessageId: { in: idList.slice(i, i + 200) } },
      select: { id: true, gmailMessageId: true, threadId: true, labelIds: true, providerDeletedAt: true },
    });
    for (const r of rows) known.set(r.gmailMessageId, r);
  }
  for (const gid of inboxIds) {
    const row = known.get(gid);
    if (!row) {
      // In Gmail's inbox but not mirrored (history gap / deep backfill still
      // running) — the inbox is the priority: import it now, budgeted.
      if (imported >= SNAPSHOT_FETCH_BUDGET) continue; // rest next tick
      try {
        const full = await gmail.getMessage(prisma, account, gid);
        const res = await ingestGmailMessage(account, full);
        if (res.threadId) dirty.add(res.threadId);
        imported += 1;
      } catch (e) {
        if (e.status !== 404) throw e;
      }
      continue;
    }
    const labels = new Set(Array.isArray(row.labelIds) ? row.labelIds : []);
    const wantUnread = unreadIds.has(gid);
    let changed = false;
    if (!labels.has('INBOX')) {
      labels.add('INBOX');
      changed = true;
    }
    if (wantUnread !== labels.has('UNREAD')) {
      if (wantUnread) labels.add('UNREAD');
      else labels.delete('UNREAD');
      changed = true;
    }
    const patch = {};
    if (changed) patch.labelIds = [...labels];
    if (row.providerDeletedAt) patch.providerDeletedAt = null; // it's back
    if (Object.keys(patch).length) {
      await prisma.emailMessage.update({ where: { id: row.id }, data: patch });
      dirty.add(row.threadId);
      refreshed += 1;
    }
  }

  for (const threadId of dirty) {
    await recomputeThreadState(threadId);
  }
  if (stripped || refreshed || imported) {
    logger.log(
      `[email-sync] ${account.emailAddress}: snapshot — inbox=${inboxIds.size} unread=${unreadIds.size}; stripped ${stripped}, refreshed ${refreshed}, imported ${imported}, ${dirty.size} threads recomputed`,
    );
  }
}

// Bounded re-match sweep over unmatched threads (newest first). Only fills
// NULL contactIds and NEVER touches threads a user manually unlinked
// (matchSource='unlinked' sentinel) — auto-matching must not fight the user.
const REMATCH_BATCH = 25;
async function rematchUnmatchedThreads(account, logger) {
  const threads = await prisma.emailThread.findMany({
    where: { accountId: account.id, contactId: null, matchSource: null },
    orderBy: { lastMessageAt: 'desc' },
    take: REMATCH_BATCH,
    select: { id: true, participants: true },
  });
  let linked = 0;
  for (const t of threads) {
    const { contactId } = await matchContactByEmails((t.participants || []).map((p) => p.email));
    if (!contactId) continue;
    // Guard the fill (contactId: null) so a concurrent manual link wins.
    const res = await prisma.emailThread.updateMany({
      where: { id: t.id, contactId: null },
      data: { contactId, matchSource: 'email' },
    });
    linked += res.count;
  }
  if (linked) logger.log(`[email-sync] ${account.emailAddress}: re-matched ${linked} threads to contacts`);
}

async function backfillAccount(account, logger) {
  // Capture the incremental cursor BEFORE listing so mail arriving mid-backfill
  // is replayed by history sync afterwards (no gap).
  if (!account.historyId) {
    const profile = await gmail.getProfile(prisma, account);
    account.historyId = String(profile.historyId);
    await prisma.emailAccount.update({
      where: { id: account.id },
      data: { historyId: account.historyId },
    });
  }

  let pageToken;
  let fetched = 0;
  let pages = 0;
  let sawUnknown = false;
  do {
    const page = await gmail.listMessages(prisma, account, {
      q: BACKFILL_QUERY,
      maxResults: LIST_PAGE_SIZE,
      pageToken,
    });
    pages += 1;
    const ids = (page.messages || []).map((m) => m.id);
    if (ids.length) {
      const known = new Set(
        (
          await prisma.emailMessage.findMany({
            where: { accountId: account.id, gmailMessageId: { in: ids } },
            select: { gmailMessageId: true },
          })
        ).map((r) => r.gmailMessageId),
      );
      for (const id of ids) {
        if (known.has(id)) continue;
        sawUnknown = true;
        if (fetched >= MAX_FETCH_PER_TICK) break;
        let full;
        try {
          full = await gmail.getMessage(prisma, account, id);
        } catch (e) {
          // Deleted in Gmail between list and fetch — read-only mirror, skip.
          if (e.status === 404) continue;
          throw e;
        }
        await ingestGmailMessage(account, full);
        fetched += 1;
      }
    }
    if (fetched >= MAX_FETCH_PER_TICK) {
      // Budget spent — continue next tick (skip-known makes re-listing cheap).
      logger.log(`[email-sync] ${account.emailAddress}: backfill +${fetched}, continuing next tick`);
      return { phase: 'backfill', fetched, done: false };
    }
    pageToken = page.nextPageToken;
  } while (pageToken && pages < MAX_LIST_PAGES);

  if (pageToken) {
    logger.warn(
      `[email-sync] ${account.emailAddress}: backfill truncated after ${pages} pages (${BACKFILL_QUERY}) — older messages in the window were skipped`,
    );
  }
  await prisma.emailAccount.update({
    where: { id: account.id },
    data: { backfillDone: true },
  });
  logger.log(`[email-sync] ${account.emailAddress}: backfill complete (+${fetched}, unknownSeen=${sawUnknown})`);
  return { phase: 'backfill', fetched, done: true };
}

async function incrementalSync(account, logger) {
  let pageToken;
  let latestHistoryId = account.historyId;
  const newIds = new Set();
  // Provider-state changes ride the SAME history stream: archive/unarchive/
  // read-in-Gmail arrive as label changes, deletes as messageDeleted. This is
  // what keeps the GOS active inbox matching what Gmail shows today.
  const deletedIds = new Set();
  const labelChanges = []; // { message, labelIds, kind: 'add' | 'remove' }
  try {
    do {
      const page = await gmail.listHistory(prisma, account, {
        startHistoryId: account.historyId,
        historyTypes: ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'],
        maxResults: 100,
        pageToken,
      });
      if (page.historyId) latestHistoryId = String(page.historyId);
      for (const h of page.history || []) {
        for (const added of h.messagesAdded || []) {
          if (added.message?.id) newIds.add(added.message.id);
        }
        for (const del of h.messagesDeleted || []) {
          if (del.message?.id) deletedIds.add(del.message.id);
        }
        for (const la of h.labelsAdded || []) {
          labelChanges.push({ message: la.message, labelIds: la.labelIds, kind: 'add' });
        }
        for (const lr of h.labelsRemoved || []) {
          labelChanges.push({ message: lr.message, labelIds: lr.labelIds, kind: 'remove' });
        }
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
  } catch (e) {
    if (e.status === 404) {
      // Cursor expired (Gmail keeps ~a week of history). Re-seed + re-run the
      // cheap skip-known backfill to close whatever gap opened.
      logger.warn(`[email-sync] ${account.emailAddress}: history cursor expired — re-seeding`);
      const profile = await gmail.getProfile(prisma, account);
      await prisma.emailAccount.update({
        where: { id: account.id },
        data: { historyId: String(profile.historyId), backfillDone: false },
      });
      return { phase: 'incremental', reseeded: true };
    }
    throw e;
  }

  let fetched = 0;
  for (const id of newIds) {
    if (fetched >= MAX_FETCH_PER_TICK) break;
    let full;
    try {
      full = await gmail.getMessage(prisma, account, id);
    } catch (e) {
      // A message can vanish between history and fetch (user deleted it in
      // Gmail). Read-only mirror: just skip it.
      if (e.status === 404) continue;
      throw e;
    }
    await ingestGmailMessage(account, full);
    fetched += 1;
  }

  // Provider-state changes — cheap local DB ops, all idempotent (the window
  // may be replayed after a held cursor and converges to the same state).
  // Order matters: adds were ingested above so label events find their rows.
  const dirtyThreads = new Set();
  for (const change of labelChanges) {
    const threadId = await applyLabelChange(account, change, change.kind);
    if (threadId) dirtyThreads.add(threadId);
  }
  for (const id of deletedIds) {
    const threadId = await applyMessageDeleted(account, id);
    if (threadId) dirtyThreads.add(threadId);
  }
  for (const threadId of dirtyThreads) {
    await recomputeThreadState(threadId);
  }
  if (dirtyThreads.size) {
    logger.log(
      `[email-sync] ${account.emailAddress}: provider state — ${labelChanges.length} label changes, ${deletedIds.size} deletions, ${dirtyThreads.size} threads recomputed`,
    );
  }

  if (fetched >= MAX_FETCH_PER_TICK && newIds.size > fetched) {
    // Budget spent mid-batch: do NOT advance the cursor — next tick replays
    // the same history window and the skip-known fast path absorbs duplicates.
    logger.log(`[email-sync] ${account.emailAddress}: +${fetched}/${newIds.size}, cursor held for next tick`);
    return { phase: 'incremental', fetched, done: false };
  }

  if (latestHistoryId && latestHistoryId !== account.historyId) {
    await prisma.emailAccount.update({
      where: { id: account.id },
      data: { historyId: latestHistoryId },
    });
  }
  if (fetched) logger.log(`[email-sync] ${account.emailAddress}: +${fetched} messages`);
  return { phase: 'incremental', fetched, done: true };
}

// One-time (self-terminating) reconciliation: rows mirrored before the
// labelIds column existed carry SQL NULL there. Fetch their CURRENT labels
// from Gmail (format=minimal — no payload) so pre-existing archived mail /
// artifacts classify themselves out of the active inbox, and messages that
// were deleted in Gmail meanwhile get flagged. No manual cleanup, ever.
const RECONCILE_BATCH = 40;
async function reconcileNullLabels(account, logger) {
  const rows = await prisma.emailMessage.findMany({
    where: { accountId: account.id, labelIds: { equals: Prisma.DbNull }, providerDeletedAt: null },
    select: { id: true, gmailMessageId: true, threadId: true },
    take: RECONCILE_BATCH,
  });
  if (!rows.length) return;
  const dirtyThreads = new Set();
  for (const row of rows) {
    try {
      const minimal = await gmail.getMessage(prisma, account, row.gmailMessageId, 'minimal');
      await prisma.emailMessage.update({
        where: { id: row.id },
        data: { labelIds: minimal.labelIds || [] },
      });
    } catch (e) {
      if (e.status !== 404) throw e;
      // Gone from Gmail — keep the mirror row, flag it out of active views.
      await prisma.emailMessage.update({
        where: { id: row.id },
        data: { providerDeletedAt: new Date() },
      });
    }
    dirtyThreads.add(row.threadId);
  }
  let recomputed = 0;
  for (const threadId of dirtyThreads) {
    // Recompute only once ALL of the thread's live messages carry labels —
    // a mixed thread would otherwise flap out of the inbox mid-reconcile.
    const pending = await prisma.emailMessage.count({
      where: { threadId, labelIds: { equals: Prisma.DbNull }, providerDeletedAt: null },
    });
    if (pending === 0) {
      await recomputeThreadState(threadId);
      recomputed += 1;
    }
  }
  logger.log(
    `[email-sync] ${account.emailAddress}: label reconcile — ${rows.length} messages classified, ${recomputed} threads recomputed`,
  );
}
