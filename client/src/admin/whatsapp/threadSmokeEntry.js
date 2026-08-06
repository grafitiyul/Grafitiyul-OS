// Bundle entry for threadSendBroadcast.smoke.test.js — the real ChatThread plus
// the canonical send broadcast, so the test drives production code, not a copy.
export { default as ChatThread } from './ChatThread.jsx';
export { WHATSAPP_MESSAGE_SENT_EVENT, announceWhatsappMessageSent } from './composerEvents.js';
