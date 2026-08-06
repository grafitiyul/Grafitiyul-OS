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

// ── "a message just went out on this conversation" ───────────────────────────
//
// A chat can be composed from more than one place at once: the thread's own
// composer, the floating dock, the WhatsApp inbox, and the Deal's "תבנית
// ווטסאפ" modal — which mounts a SECOND real ChatComposer on the same chat.
// Each composer used to tell only its own parent, so a template sent from the
// modal simply did not appear in the thread already open behind it until the
// Deal was refreshed or the conversation reopened.
//
// This is the ONE signal every send emits and every open thread listens to.
// It carries the canonical WhatsAppMessage the send returned, so a listener
// merges by message id — the same id the bridge sync later delivers, which is
// why the message can never land twice.
export const WHATSAPP_MESSAGE_SENT_EVENT = 'gos:whatsapp-message-sent';

// chatId is the LIVE chat id (a draft chat has already materialized by the time
// a message exists), so listeners can match without knowing about drafts.
export function announceWhatsappMessageSent({ chatId, message }) {
  if (typeof window === 'undefined' || !chatId) return;
  window.dispatchEvent(
    new CustomEvent(WHATSAPP_MESSAGE_SENT_EVENT, { detail: { chatId, message: message || null } }),
  );
}
