import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

// WhatsApp module — Slice 1 (accounts / connections admin).
//
// Deployment model: one bridge SERVICE per WhatsApp number (gos-whatsapp-main
// / gos-whatsapp-office), same code + same Postgres, account selected by env.
// This router is the admin UI's single door: account rows come from the DB
// (the bridge mirrors its live connection state into WhatsAppAccount), and
// live actions (QR data URL, readiness, restart/hard-reset/sign-out) proxy to
// the right bridge over Railway's private network.
//
// Bridge addressing: WHATSAPP_BRIDGE_URLS env maps accountId → base URL,
//   e.g. "main=http://gos-whatsapp-main.railway.internal:3000,office=http://gos-whatsapp-office.railway.internal:3000"
// WHATSAPP_BRIDGE_SECRET must equal each bridge's BRIDGE_INTERNAL_SECRET.
// Missing config degrades cleanly: accounts list still renders from the DB,
// live actions return 'bridge_not_configured'.

const router = Router();

function bridgeUrlMap() {
  const raw = String(process.env.WHATSAPP_BRIDGE_URLS || '').trim();
  const map = {};
  for (const pair of raw.split(',')) {
    const idx = pair.indexOf('=');
    if (idx <= 0) continue;
    const key = pair.slice(0, idx).trim();
    const url = pair.slice(idx + 1).trim().replace(/\/+$/, '');
    if (key && url) map[key] = url;
  }
  return map;
}

async function callBridge(accountId, path, { method = 'GET', timeoutMs = 10_000 } = {}) {
  const base = bridgeUrlMap()[accountId];
  const secret = process.env.WHATSAPP_BRIDGE_SECRET;
  if (!base || !secret) {
    const err = new Error('bridge_not_configured');
    err.code = 'bridge_not_configured';
    throw err;
  }
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok && res.status !== 202) {
    const err = new Error(`bridge_error: ${data?.error || res.status}`);
    err.code = 'bridge_error';
    err.status = res.status;
    throw err;
  }
  return data;
}

function bridgeErrorResponse(res, err) {
  if (err?.code === 'bridge_not_configured') {
    return res.status(503).json({ error: 'bridge_not_configured' });
  }
  // Timeouts / connection refused / bridge 5xx all land here — the account
  // row (DB) stays readable either way, so the UI can show "bridge unreachable"
  // next to the last persisted status.
  return res.status(502).json({ error: 'bridge_unreachable', detail: err?.message || String(err) });
}

// List accounts — straight from the DB (each bridge keeps its own row live).
// bridgeConfigured tells the UI whether live actions are possible per account.
router.get(
  '/accounts',
  handle(async (_req, res) => {
    const urls = bridgeUrlMap();
    const rows = await prisma.whatsAppAccount.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    res.json(rows.map((r) => ({ ...r, qr: undefined, bridgeConfigured: !!urls[r.id] })));
  }),
);

// Admin-owned fields only — the connection-state fields are the bridge's.
router.put(
  '/accounts/:id',
  handle(async (req, res) => {
    const b = req.body || {};
    const existing = await prisma.whatsAppAccount.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const data = {};
    if (b.label !== undefined) {
      const label = String(b.label).trim();
      if (!label) return res.status(400).json({ error: 'label_required' });
      data.label = label;
    }
    if (b.active !== undefined) data.active = !!b.active;
    if (b.sortOrder !== undefined) data.sortOrder = Number(b.sortOrder) || 0;
    const row = await prisma.whatsAppAccount.update({ where: { id: existing.id }, data });
    res.json({ ...row, qr: undefined });
  }),
);

// Live status — proxies the account's bridge (adds readiness + QR data URL on
// top of the persisted row).
router.get(
  '/accounts/:id/status',
  handle(async (req, res) => {
    try {
      const data = await callBridge(req.params.id, '/status');
      res.set('Cache-Control', 'no-store');
      res.json({ bridgeReachable: true, ...data });
    } catch (err) {
      return bridgeErrorResponse(res, err);
    }
  }),
);

// Recovery actions — thin proxies; the bridge fire-and-forgets and the UI
// re-polls status.
for (const action of ['restart-socket', 'hard-reset-session', 'sign-out']) {
  router.post(
    `/accounts/:id/${action}`,
    handle(async (req, res) => {
      try {
        const data = await callBridge(req.params.id, `/${action}`, { method: 'POST', timeoutMs: 30_000 });
        res.json({ ok: true, ...data });
      } catch (err) {
        return bridgeErrorResponse(res, err);
      }
    }),
  );
}

export default router;
