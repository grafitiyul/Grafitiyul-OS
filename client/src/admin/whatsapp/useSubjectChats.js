import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { formatPhoneDisplay } from '../../lib/phone.js';
import { useSenderAccount } from './useSenderAccount.js';

// THE selection model behind every CRM WhatsApp surface (the Deal dock, the
// template modal). One hook, so two screens can never answer "which
// conversation am I in" differently.
//
// Two independent axes → exactly one chat:
//   contact — who we are talking to. The subject's own people, so a contact
//             with no thread yet still gets a bubble.
//   account — which of OUR numbers we are talking FROM. Every connected number
//             gets a bubble whether or not a conversation with this contact
//             exists on it: a number with no history is not a missing option,
//             it is an empty conversation waiting to be started.
//
// The account axis IS the global sender mode (useSenderAccount): picking a
// number here is the same decision as picking it in any other composer, so the
// two can never disagree about who is sending. Starting a conversation
// materialises the chat row server-side (POST /chats/ensure) and hands back a
// perfectly ordinary chat — which is why nothing downstream (thread, composer,
// scheduling, templates) needs to know any of this exists.

const POLL_MS = 45_000;

// Replace-or-append a chat in the loaded payload, keeping the server's
// newest-first order stable enough for selection until the next refresh.
function withChat(data, chat) {
  const chats = data?.chats || [];
  const idx = chats.findIndex((c) => c.id === chat.id);
  const next = idx >= 0 ? chats.map((c) => (c.id === chat.id ? { ...c, ...chat } : c)) : [chat, ...chats];
  return { ...(data || {}), chats: next };
}

export function useSubjectChats(subjectType, subjectId, { enabled = true, pollMs = POLL_MS } = {}) {
  const { accounts, accountId: preferredAccountId, select } = useSenderAccount();
  const [data, setData] = useState(null);
  const [contactSel, setContactSel] = useState(null);
  const [accountSel, setAccountSel] = useState(null);
  const [starting, setStarting] = useState(null); // accountId currently being opened
  const [startError, setStartError] = useState(null);

  const load = useCallback(async () => {
    if (!enabled || !subjectId) return null;
    try {
      const d = await api.whatsapp.contextChats(subjectType, subjectId);
      setData(d);
      return d;
    } catch {
      return null; // transient — the next poll covers it
    }
  }, [enabled, subjectType, subjectId]);

  // The chat LIST changes rarely (a brand-new conversation); the thread polls
  // itself far faster. Paused while the tab is hidden.
  useEffect(() => {
    if (!enabled) return undefined;
    load();
    if (!pollMs) return undefined;
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, pollMs);
    return () => clearInterval(t);
  }, [enabled, load, pollMs]);

  // Contact bubbles come from the SUBJECT's contact list (server), so a contact
  // with no WhatsApp thread yet still gets one — and adding/removing deal
  // contacts updates them on the next refresh. Falls back to chat-derived
  // grouping when the server sends no contacts.
  const contacts = useMemo(() => {
    const chats = data?.chats || [];
    if (data?.contacts?.length) {
      return data.contacts.map((c) => ({
        ...c,
        chats: chats.filter((chat) => (chat.contact?.id || chat.contactId) === c.id),
      }));
    }
    const map = new Map();
    for (const c of chats) {
      const key = c.contact?.id || c.contactId || c.id;
      if (!map.has(key)) {
        map.set(key, {
          id: key,
          name:
            c.contact?.name ||
            (c.displayName && c.displayName !== c.phoneNumber
              ? c.displayName
              : formatPhoneDisplay(c.phoneNumber)) ||
            'לא מזוהה',
          chats: [],
        });
      }
      map.get(key).chats.push(c);
    }
    return [...map.values()];
  }, [data]);

  const activeContact =
    contacts.find((c) => c.id === contactSel) ||
    contacts.find((c) => c.id === data?.primaryContactId) ||
    contacts[0] ||
    null;
  const contactChats = useMemo(() => activeContact?.chats || [], [activeContact]);

  // Bubble list = our connected numbers, PLUS any number this subject already
  // has a conversation on that is no longer active. A retired number must not
  // make its history unreachable; it simply cannot start anything new.
  const accountOptions = useMemo(() => {
    const known = new Set(accounts.map((a) => a.id));
    const extra = [];
    for (const c of data?.chats || []) {
      if (!c.accountId || known.has(c.accountId) || extra.some((e) => e.id === c.accountId)) continue;
      extra.push({ id: c.accountId, label: c.account?.label || c.accountId, connected: false, retired: true });
    }
    return [...accounts.map((a) => ({ ...a, retired: false })), ...extra];
  }, [accounts, data]);

  // Which number is in view. An explicit pick wins and STICKS (it is a mode,
  // not a per-conversation setting). With no pick yet: the number this contact
  // was last actually talked to on — never the operator's mode, because opening
  // a deal on an empty conversation while the real one sits on another number
  // is exactly the confusion the bubbles exist to remove.
  const fallbackAccountId =
    contactChats[0]?.accountId ||
    accountOptions.find((a) => a.id === preferredAccountId)?.id ||
    accountOptions[0]?.id ||
    null;
  const activeAccountId = accountOptions.some((a) => a.id === accountSel) ? accountSel : fallbackAccountId;
  const activeAccount = accountOptions.find((a) => a.id === activeAccountId) || null;
  const activeChat = contactChats.find((c) => c.accountId === activeAccountId) || null;

  // Per-number state for the active contact's bubbles.
  const chatByAccount = useMemo(() => {
    const m = {};
    for (const c of contactChats) if (!m[c.accountId]) m[c.accountId] = c;
    return m;
  }, [contactChats]);
  const unreadByAccount = useMemo(() => {
    const m = {};
    for (const c of contactChats) m[c.accountId] = (m[c.accountId] || 0) + (c.unreadCount || 0);
    return m;
  }, [contactChats]);

  const activeContactRef = useRef(activeContact);
  activeContactRef.current = activeContact;

  const startConversation = useCallback(async (accountIdArg, contactIdArg = null) => {
    const contactId = contactIdArg || activeContactRef.current?.id || null;
    if (!contactId || !accountIdArg) return null;
    setStarting(accountIdArg);
    setStartError(null);
    try {
      const chat = await api.whatsapp.ensureChat({ accountId: accountIdArg, contactId });
      setData((cur) => withChat(cur, chat));
      return chat;
    } catch (e) {
      setStartError(e?.payload?.error || 'failed');
      return null;
    } finally {
      setStarting(null);
    }
  }, []);

  const selectContact = useCallback((id) => setContactSel(id), []);

  // Picking a number is one decision with three effects: this panel switches to
  // that conversation, the operator's global sending mode follows, and a number
  // with no conversation yet gets one opened on the spot (that click IS the
  // intent to talk from it — making the operator confirm twice would be noise).
  const selectAccount = useCallback(
    (id) => {
      const option = accountOptions.find((a) => a.id === id);
      if (!option) return;
      setAccountSel(id);
      setStartError(null);
      if (!option.retired) select(id);
      const contact = activeContactRef.current;
      const has = (contact?.chats || []).some((c) => c.accountId === id);
      if (contact && !has && !option.retired) startConversation(id, contact.id);
    },
    [accountOptions, select, startConversation],
  );

  // Focus one existing chat (e.g. an "open the composer on this chat" signal):
  // select BOTH axes so the panel lands exactly on it.
  const openChat = useCallback(
    (chatId) => {
      const chat = (data?.chats || []).find((c) => c.id === chatId);
      if (!chat) return false;
      setContactSel(chat.contact?.id || chat.contactId || null);
      setAccountSel(chat.accountId || null);
      return true;
    },
    [data],
  );

  return {
    loading: data === null,
    data,
    chats: data?.chats || [],
    contacts,
    primaryContactId: data?.primaryContactId || null,
    activeContact,
    accounts: accountOptions,
    activeAccountId,
    activeAccount,
    activeChat,
    chatByAccount,
    unreadByAccount,
    starting,
    startError,
    selectContact,
    selectAccount,
    startConversation,
    openChat,
    reload: load,
  };
}
