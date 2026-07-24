// Email channel adapter for the Communication Center — delegates to the
// canonical Gmail send path (email/simpleSend.js sendCrmEmail → buildRawMessage
// → gmail.sendRaw, with the standard mirror + CRM thread linking). Attach-mode
// documents resolve to the canonical stored bytes (documents.js) — never
// regenerated.

import { sendCrmEmail } from '../../email/simpleSend.js';
import { loadDocumentBytes } from '../documents.js';

export async function sendEmailDelivery({ delivery, rendered, snapshot }) {
  const attachments = [];
  for (const doc of rendered.attachments || []) {
    const bytes = await loadDocumentBytes(doc);
    if (!bytes) {
      const e = new Error('document_unavailable');
      e.code = 'document_unavailable';
      throw e;
    }
    attachments.push({
      filename: bytes.filename,
      mimeType: bytes.mimeType,
      contentBase64: bytes.buffer.toString('base64'),
    });
  }

  const result = await sendCrmEmail({
    to: snapshot.email,
    toName: snapshot.name || null,
    subject: rendered.subject || '',
    bodyHtml: rendered.body || null,
    attachments: attachments.length ? attachments : null,
    dealId: delivery.dealId || null,
    contactId: delivery.contactId || null,
  });
  return { providerMessageId: result.gmailMessageId || null };
}
