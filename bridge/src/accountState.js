// WhatsAppAccount persistence helper — the bridge mirrors the live Baileys
// connection state into this account's row so the GOS admin UI can render
// status/QR by reading the DB (via the GOS API) without ever talking to
// Baileys directly. Port of the Challenge System's connection-state.ts,
// scoped by accountId.
//
// ensureAccountRow() runs once at boot: deployment identity = account
// identity (WHATSAPP_ACCOUNT_ID env), so the bridge creates its own row on
// first boot. label is set only on create — the admin renames freely later.

import { config } from './config.js';

const ACCOUNT_ID = config.accountId;

async function patch(prisma, data) {
  // The row is guaranteed by ensureAccountRow() at boot; updateMany (vs
  // update) keeps a missing row from throwing during teardown races.
  await prisma.whatsAppAccount.updateMany({ where: { id: ACCOUNT_ID }, data });
}

export async function ensureAccountRow(prisma) {
  await prisma.whatsAppAccount.upsert({
    where: { id: ACCOUNT_ID },
    create: {
      id: ACCOUNT_ID,
      label: config.accountLabel || ACCOUNT_ID,
      status: 'disconnected',
    },
    // Existing row: leave label/active/sortOrder alone (admin-owned).
    update: {},
  });
}

export const accountState = {
  async setConnecting(prisma) {
    await patch(prisma, { status: 'connecting', qr: null });
  },

  async setQrRequired(prisma, qr) {
    await patch(prisma, { status: 'qr_required', qr, lastQrAt: new Date() });
  },

  async setConnected(prisma, info) {
    const connectedAt = new Date();
    await patch(prisma, {
      status: 'connected',
      qr: null,
      phoneJid: info.phoneJid ?? null,
      deviceName: info.deviceName ?? null,
      lastConnectedAt: connectedAt,
      reconnectAttempts: 0,
      // Clear the previous disconnect REASON on recovery (a lingering
      // "restartRequired" next to status=connected reads as a fault when it
      // isn't). lastDisconnectAt intentionally stays — "we had a blip at
      // 14:30 (recovered)" is a useful breadcrumb.
      lastDisconnectReason: null,
    });
    await closeGap(prisma, connectedAt);
  },

  async setDisconnected(prisma, reason, options = { incrementAttempts: true }) {
    if (options.incrementAttempts) {
      await prisma.whatsAppAccount.updateMany({
        where: { id: ACCOUNT_ID },
        data: { reconnectAttempts: { increment: 1 } },
      });
    }
    const disconnectedAt = new Date();
    await patch(prisma, {
      status: 'disconnected',
      qr: null,
      lastDisconnectAt: disconnectedAt,
      lastDisconnectReason: reason,
    });
    await openGap(prisma, reason, disconnectedAt);
  },

  // Reset reconnectAttempts after the connection stays open long enough to
  // be considered healthy — backoff returns to its minimum.
  async markHealthy(prisma) {
    await patch(prisma, { reconnectAttempts: 0 });
  },

  // Any-direction activity heartbeat.
  async heartbeat(prisma) {
    await patch(prisma, { lastMessageAt: new Date() });
  },

  // INBOUND-only heartbeat — called after an incoming (non-fromMe) message
  // row is created. This is the signal that detects "connected but receiving
  // nothing" zombie sockets, which the conflated lastMessageAt cannot surface
  // (outbound sends keep bumping it).
  async inboundHeartbeat(prisma) {
    await patch(prisma, { lastInboundMessageAt: new Date() });
  },

  // Surface the most recent media-handling failure to the admin UI. Cleared
  // by the next successful media store. Summary only — never message content.
  async setMediaError(prisma, summary) {
    await patch(prisma, { lastMediaError: String(summary).slice(0, 240), lastMediaErrorAt: new Date() });
  },

  async clearMediaError(prisma) {
    // lastMediaErrorAt intentionally kept — "last incident" breadcrumb.
    await patch(prisma, { lastMediaError: null });
  },

  async snapshot(prisma) {
    return prisma.whatsAppAccount.findUnique({ where: { id: ACCOUNT_ID } });
  },
};

// ── Data-gap ledger ───────────────────────────────────────────────────────
// One open row per disconnected window. Idempotent: rapid-fire disconnect
// events collapse into a single open gap; closeGap on a clean boot is a
// no-op. Both swallow errors — bookkeeping must never crash the reconnect
// path, which is exactly when the bridge most needs to keep working.

async function openGap(prisma, reason, disconnectedAt) {
  try {
    const existing = await prisma.whatsAppDataGap.findFirst({
      where: { accountId: ACCOUNT_ID, reconnectedAt: null },
      select: { id: true },
    });
    if (existing) return;
    await prisma.whatsAppDataGap.create({
      data: { accountId: ACCOUNT_ID, disconnectedAt, disconnectReason: reason },
    });
  } catch (err) {
    console.warn('[data-gap] openGap failed (non-fatal):', err?.message || err);
  }
}

async function closeGap(prisma, reconnectedAt) {
  try {
    const open = await prisma.whatsAppDataGap.findFirst({
      where: { accountId: ACCOUNT_ID, reconnectedAt: null },
      orderBy: { disconnectedAt: 'desc' },
      select: { id: true, disconnectedAt: true },
    });
    if (!open) return;
    await prisma.whatsAppDataGap.update({
      where: { id: open.id },
      data: {
        reconnectedAt,
        // Clamp at 0 against clock skew — recording 0 beats rejecting the close.
        durationMs: Math.max(0, reconnectedAt.getTime() - open.disconnectedAt.getTime()),
      },
    });
  } catch (err) {
    console.warn('[data-gap] closeGap failed (non-fatal):', err?.message || err);
  }
}
