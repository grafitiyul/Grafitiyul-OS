// WhatsApp channel adapter for the Communication Center — the ONLY place the
// delivery engine touches the bridge. Reuses the canonical bridge client and
// phone→JID normalization; adds NOTHING channel-agnostic (windows, retries,
// idempotency policy live in the worker).
//
// Sender policy: the delivery's FROZEN waAccountId is used, always. There is
// deliberately no fallback to another account — an unavailable sender surfaces
// as a retryable connection error and the delivery waits with a clear reason.
//
// Attachment policy (documented): body text is sent first as its own message,
// then each attach-mode document as a real WhatsApp document message (the
// canonical filename as caption-less document — filename identity is
// preserved). Idempotency keys are per-part (`-t`, `-d0`, `-d1`…) so a crash
// between parts replays only the missing part.

import { callBridge } from '../../whatsapp/bridgeClient.js';
import { phoneToJid } from '../../whatsapp/send.js';
import { loadDocumentBytes } from '../documents.js';

export async function sendWhatsAppDelivery({ delivery, rendered, snapshot }) {
  const accountId = snapshot?.waAccountId;
  if (!accountId) {
    const e = new Error('wa_account_missing');
    e.code = 'invalid_payload';
    throw e;
  }
  const jid = snapshot.waDestinationType === 'group'
    ? snapshot.groupJid
    : phoneToJid(snapshot.phone);
  if (!jid) {
    const e = new Error('wa_destination_missing');
    e.code = 'invalid_payload';
    throw e;
  }

  const baseKey = `gos-comm-${delivery.id}-a${delivery.attemptCount}`;
  let externalMessageId = null;

  if (rendered.body) {
    const data = await callBridge(accountId, '/send', {
      method: 'POST',
      timeoutMs: 25_000,
      body: { jid, text: rendered.body, idempotencyKey: `${baseKey}-t` },
    });
    externalMessageId = data?.externalMessageId ?? null;
  }

  for (let i = 0; i < (rendered.attachments || []).length; i++) {
    const doc = rendered.attachments[i];
    const bytes = await loadDocumentBytes(doc);
    if (!bytes) {
      const e = new Error('document_unavailable');
      e.code = 'document_unavailable';
      throw e;
    }
    const data = await callBridge(accountId, '/send-media', {
      method: 'POST',
      timeoutMs: 90_000,
      body: {
        jid,
        mediaBase64: bytes.buffer.toString('base64'),
        mimeType: bytes.mimeType,
        fileName: bytes.filename,
        kind: 'document',
        idempotencyKey: `${baseKey}-d${i}`,
      },
    });
    externalMessageId = externalMessageId || data?.externalMessageId || null;
  }

  return { providerMessageId: externalMessageId };
}
