import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { formatPhoneDisplay } from '../../lib/phone.js';
import { useConnectedAccounts, resolveAccountId } from './senderAccount.js';
import { draftTarget } from './chatTarget.js';

// THE selection model behind every CRM WhatsApp surface (Deal conversation
// panel, Deal templates, scheduled WhatsApp tasks, Contact page, Organization
// page). One hook, so no two screens can answer "which conversation, from which
// number" differently.
//
// Two independent axes → always exactly one conversation, never a dead end:
//   contact — who we are talking to. The subject's own people, so a contact
//             with no thread yet still gets a bubble.
//   account — which of OUR numbers we are talking FROM. Every connected number
//             gets a bubble whether or not a conversation exists on it.
//
// When the chosen pair has no conversation, this returns a DRAFT TARGET rather
// than nothing: an empty but fully usable thread whose first message creates
// the conversation (chatTarget.js). Selecting a number therefore never writes
// data and never shows a placeholder screen.
//
// The account choice is remembered in the BROWSER (senderAccount.js), because
// several employees share one GOS login and each works from their own number.

const POLL_MS = 45_000;

// Replace-or-append a chat in the loaded payload, so a conversation created by
// a first message is usable immediately without waiting for the next poll.
function withChat(data, chat) {
  const chats = data?.chats || [];
  const idx = chats.findIndex((c) => c.id === chat.id);
  const next = idx >= 0 ? chats.map((c) => (c.id === chat.id ? { ...c, ...chat } : c)) : [chat, ...chats];
  return { ...(data || {}), chats: next };
}

export function useSubjectChats(subjectType, subjectId, { enabled = true, pollMs = POLL_MS } = {}) {
  const { accounts, loaded: accountsLoaded, remembered, select } = useConnectedAccounts();
  const [data, setData] = useState(null);
  const [contactSel, setContactSel] = useState(null);
  const [accountSel, setAccountSel] = useState(null);

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
      extra.push({
        id: c.accountId,
        label: c.account?.label || c.accountId,
        connected: false,
        bridgeConfigured: false,
        retired: true,
      });
    }
    return [...accounts.map((a) => ({ ...a, retired: false })), ...extra];
  }, [accounts, data]);

  // Which number is in view — the canonical order, identical on every surface:
  // this panel's explicit pick → what this browser remembers → the number this
  // contact was last actually talked to on → the first usable number.
  const activeAccountId = resolveAccountId(accountOptions, {
    explicit: accountSel,
    remembered,
    hint: contactChats[0]?.accountId || null,
  });
  const activeAccount = accountOptions.find((a) => a.id === activeAccountId) || null;
  const existingChat = contactChats.find((c) => c.accountId === activeAccountId) || null;

  // The conversation the surface renders: the real one, or an empty draft for
  // the same pair. Never null while a contact and a number are known — that is
  // what removes the "no conversation" dead end entirely. Memoised on the two
  // axes so a draft keeps ONE identity across renders (the composer holds it in
  // a ref; a new object every render would quietly reset mid-typing).
  const draft = useMemo(
    () => (existingChat ? null : draftTarget({ account: activeAccount, contact: activeContact })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [existingChat?.id, activeAccount?.id, activeAccount?.label, activeContact?.id, activeContact?.name],
  );
  const activeChat = existingChat || draft;

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

  const selectContact = useCallback((id) => setContactSel(id), []);

  // Picking a number is ONE decision with two effects: this surface switches to
  // that conversation, and the browser remembers it for every WhatsApp surface
  // opened afterwards. It never creates data — see chatTarget.js.
  const selectAccount = useCallback(
    (id) => {
      if (!id) return;
      setAccountSel(id);
      select(id);
    },
    [select],
  );

  // A conversation that was just created by a first message: adopt it so the
  // thread switches from draft to real without waiting for the next poll.
  const adoptChat = useCallback((chat) => {
    if (!chat?.id) return;
    setData((cur) => withChat(cur, chat));
    setContactSel(chat.contact?.id || chat.contactId || null);
    setAccountSel(chat.accountId || null);
  }, []);

  // Focus one existing chat (e.g. an "open the composer on this chat" signal):
  // select BOTH axes so the surface lands exactly on it.
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
    // Both lists must be in before a surface can name a number; rendering
    // earlier is what produced a header reading "מ" with nothing after it.
    loading: data === null || !accountsLoaded,
    data,
    chats: data?.chats || [],
    contacts,
    primaryContactId: data?.primaryContactId || null,
    activeContact,
    accounts: accountOptions,
    activeAccountId,
    activeAccount,
    activeChat,
    existingChat,
    chatByAccount,
    unreadByAccount,
    selectContact,
    selectAccount,
    adoptChat,
    openChat,
    reload: load,
  };
}
