// GOS-server → bridge HTTP client, shared by the admin routes and the
// scheduled-messages worker.
//
// Bridge addressing: WHATSAPP_BRIDGE_URLS env maps accountId → base URL,
//   e.g. "main=http://gos-whatsapp-main.railway.internal:3000,office=http://gos-whatsapp-office.railway.internal:3000"
// WHATSAPP_BRIDGE_SECRET must equal each bridge's BRIDGE_INTERNAL_SECRET.

export function bridgeUrlMap() {
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

export async function callBridge(accountId, path, { method = 'GET', timeoutMs = 10_000, body } = {}) {
  const base = bridgeUrlMap()[accountId];
  const secret = process.env.WHATSAPP_BRIDGE_SECRET;
  if (!base || !secret) {
    const err = new Error('bridge_not_configured');
    err.code = 'bridge_not_configured';
    throw err;
  }
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok && res.status !== 202) {
    // Preserve the bridge's structured error (code + payload) — send-path
    // callers map these to user-facing outcomes instead of a generic 502.
    const err = new Error(`bridge_error: ${data?.error || res.status}`);
    err.code = 'bridge_error';
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
