// Server-initiated WhatsApp text send to a raw phone number, through the real
// bridge (callBridge → bridge '/send'). Used by flows that message a customer
// who may not have an existing chat yet (e.g. the group-registration payment
// link). The bridge mirrors the outgoing message back into the shared store on
// its own, so nothing here writes to WhatsAppMessage.

import { callBridge, bridgeUrlMap } from './bridgeClient.js';
import { normalizePhoneIntl } from './phone.js';
import { prisma } from '../db.js';
import { MAX_INLINE_WAIT_MS, reserveSendSlot } from './sendPace.js';

// This is a SERVER-INITIATED send (payment links, group-registration
// confirmations) — automated by definition, so it takes a slot from the central
// pacer like every other automation. It differs from a worker in one way: it
// runs inside an HTTP request, so it will not park for minutes. Past the inline
// ceiling it sends anyway rather than hanging the caller — the slot is still
// consumed, so the NEXT automated message stays behind it and the queue keeps
// its shape.
const defaultPace = (accountId) =>
  reserveSendSlot(prisma, accountId, { maxWaitMs: MAX_INLINE_WAIT_MS });

// REMOVED: defaultSendAccount().
//
// It used to fall through to `main` when several bridges were configured, which
// is a silent misdelivery the moment a second business number exists. Account
// selection now goes through resolveSendAccount(), which THROWS on ambiguity
// rather than picking whichever account sorts first.
//
// Kept as an export purely so any missed call site fails loudly at import time
// instead of silently resolving to the wrong number.
export function defaultSendAccount() {
  throw new Error(
    'defaultSendAccount_removed: use resolveSendAccount()/resolveForOperator() from whatsapp/senderAccount.js — '
    + 'every send must name its account explicitly.',
  );
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
export async function sendWhatsAppText(phone, text, { accountId, idempotencyKey, bridge = callBridge, pace = defaultPace } = {}) {
  const jid = phoneToJid(phone);
  if (!jid) {
    const e = new Error('invalid_phone');
    e.code = 'invalid_phone';
    throw e;
  }
  // accountId is REQUIRED. There is no fallback: a send with no named account
  // is a bug in the caller, and answering it with a guess is how a customer
  // receives a message from the wrong business number.
  if (!accountId) {
    const e = new Error('whatsapp_account_required: sendWhatsAppText needs an explicit accountId');
    e.code = 'whatsapp_account_required';
    e.status = 500;
    throw e;
  }
  const account = accountId;
  await pace(account);
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
