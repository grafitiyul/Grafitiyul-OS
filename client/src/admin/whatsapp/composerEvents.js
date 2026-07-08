import { writeDraft, readDraft, draftKeyFor } from './drafts.js';

// Generic "open the WhatsApp composer on a chat, with an optional seeded draft"
// signal — NOT specific to any feature. The floating WhatsAppDock (mounted on
// the Deal page) listens and opens itself on the target chat; the draft text is
// written through the SAME shared draft store ChatComposer reads on mount, so we
// reuse the real composer/send pipeline (account selection, history, scheduling,
// future enhancements) with no feature-specific prop.
//
// Example: "שלח ללקוח → WhatsApp" seeds "הנה החשבונית:\n<link>" and opens the
// composer — the operator edits and sends through the normal flow.

export const OPEN_WHATSAPP_COMPOSER_EVENT = 'gos:open-whatsapp-composer';

// Seed a draft (only when the chat has no half-written message, so a real draft
// is never clobbered) and ask the dock to open on that chat.
export function openWhatsappComposer({ subjectId, chat, draftText }) {
  if (typeof window === 'undefined') return;
  if (chat && draftText) {
    const key = draftKeyFor(chat);
    if (!readDraft(key).trim()) writeDraft(key, draftText);
  }
  window.dispatchEvent(
    new CustomEvent(OPEN_WHATSAPP_COMPOSER_EVENT, { detail: { subjectId, chatId: chat?.id || null } }),
  );
}
