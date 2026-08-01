import { api } from '../../lib/api.js';

// A conversation TARGET is "this contact, from this number of ours" — the thing
// every WhatsApp surface actually operates on. It has two states:
//
//   real  — a mirrored WhatsAppChat row exists (it has an id).
//   draft — no row exists yet, because nobody has ever written to this contact
//           from this number. It still renders a normal (empty) thread and a
//           normal composer.
//
// The draft state exists so that picking a number never presents a dead end and
// never creates data on a glance. A row is written at exactly one moment: the
// first real action (send, or schedule). That is what `materialize` does, and it
// is the ONLY place in the client that creates a conversation — server-side it
// is the single idempotent POST /chats/ensure, which writes the same row the
// bridge itself would have written, so the first real message merges into it
// rather than forking a duplicate.

export const isDraftChat = (chat) => !!chat && !chat.id;

/** Build the draft target for (contact × our number). */
export function draftTarget({ account, contact }) {
  if (!account?.id || !contact?.id) return null;
  return {
    id: null,
    draft: true,
    type: 'private',
    accountId: account.id,
    account: { id: account.id, label: account.label },
    contactId: contact.id,
    contact: { id: contact.id, name: contact.name },
    displayName: contact.name || null,
    phoneNumber: null,
    unreadCount: 0,
    unread: false,
  };
}

/** Stable identity for keying React subtrees and draft text across renders. */
export const chatTargetKey = (chat) =>
  (!chat ? 'none' : chat.id ? chat.id : `draft:${chat.accountId || ''}:${chat.contactId || ''}`);

/**
 * Turn a draft target into a real chat row. Idempotent and safe to call on an
 * already-real chat (returns it untouched), so callers can simply do
 * `const live = await materializeChat(chat)` before acting.
 */
export async function materializeChat(chat) {
  if (!isDraftChat(chat)) return chat;
  if (!chat.accountId || !chat.contactId) {
    const e = new Error('draft_target_incomplete');
    e.payload = { error: 'draft_target_incomplete' };
    throw e;
  }
  return api.whatsapp.ensureChat({ accountId: chat.accountId, contactId: chat.contactId });
}

// Why a first message could not be started, in business language. Shared by
// every surface so the same failure never reads two different ways.
export const START_ERRORS = {
  contact_has_no_phone: 'לאיש הקשר הזה אין מספר טלפון שמור, ולכן אי אפשר לשלוח לו הודעה. הוסיפו מספר בכרטיס איש הקשר.',
  unknown_account: 'המספר הזה כבר לא פעיל במערכת.',
  account_and_contact_required: 'לא נבחר איש קשר או מספר שליחה.',
  draft_target_incomplete: 'לא נבחר איש קשר או מספר שליחה.',
};

export const startErrorText = (code) => START_ERRORS[code] || 'פתיחת השיחה נכשלה — נסו שוב.';
