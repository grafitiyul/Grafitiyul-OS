// Server-initiated WhatsApp text send to a raw phone number, through the real
// bridge (callBridge → bridge '/send'). Used by flows that message a customer
// who may not have an existing chat yet (e.g. the group-registration payment
// link). The bridge mirrors the outgoing message back into the shared store on
// its own, so nothing here writes to WhatsAppMessage.

import { callBridge, bridgeUrlMap } from './bridgeClient.js';
import { normalizePhoneIntl } from './phone.js';

// Which account to send from: WHATSAPP_DEFAULT_ACCOUNT when set, else the single
// configured bridge, else 'main'. Explicit accountId always wins.
export function defaultSendAccount() {
  const explicit = String(process.env.WHATSAPP_DEFAULT_ACCOUNT || '').trim();
  if (explicit) return explicit;
  const keys = Object.keys(bridgeUrlMap());
  if (keys.length === 1) return keys[0];
  if (keys.includes('main')) return 'main';
  return keys[0] || 'main';
}

// Phone → WhatsApp private JID ("<intl-digits>@s.whatsapp.net"), or null when the
// phone can't be normalized.
export function phoneToJid(phone) {
  const intl = normalizePhoneIntl(phone);
  return intl ? `${intl}@s.whatsapp.net` : null;
}

// Send `text` to `phone`. Returns { ok:true, externalMessageId, accountId } on a
// real bridge acknowledgement; THROWS a coded error otherwise (never resolves on
// a failed send, so callers can honestly surface success vs failure):
//   invalid_phone | bridge_not_configured | bridge_error | bridge_unreachable
export async function sendWhatsAppText(phone, text, { accountId, idempotencyKey, bridge = callBridge } = {}) {
  const jid = phoneToJid(phone);
  if (!jid) {
    const e = new Error('invalid_phone');
    e.code = 'invalid_phone';
    throw e;
  }
  const account = accountId || defaultSendAccount();
  try {
    const data = await bridge(account, '/send', {
      method: 'POST',
      timeoutMs: 25_000,
      body: { jid, text, idempotencyKey },
    });
    return { ok: true, externalMessageId: data?.externalMessageId ?? null, accountId: account };
  } catch (err) {
    // Preserve the bridge's structured codes; collapse anything else to a
    // single "unreachable" so the caller never mistakes a network blip for OK.
    if (err?.code === 'bridge_not_configured' || err?.code === 'bridge_error') throw err;
    const e = new Error('bridge_unreachable');
    e.code = 'bridge_unreachable';
    e.cause = err;
    throw e;
  }
}
