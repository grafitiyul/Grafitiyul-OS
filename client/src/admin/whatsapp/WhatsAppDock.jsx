import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import WhatsAppLogo from '../common/WhatsAppLogo.jsx';
import ChatThread from './ChatThread.jsx';

// Floating WhatsApp dock for the Deal page: a compact bubble at the seam
// between the deal content and the sales-script panel; clicking it opens a
// large stable chat popup that overlays the script area and stays open until
// toggled/X'd. Same shared components + store as everywhere else — this file
// is ONLY Deal-page chrome.
//
// Contact model (user spec): default to the Deal's PRIMARY contact; when the
// deal has several linked contacts, a compact selector at the top switches
// the conversation inside the same popup. Conversations are per-contact and
// are never merged across contacts.

export default function WhatsAppDock({ subjectType, subjectId }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null); // { chats, primaryContactId }
  const [contactSel, setContactSel] = useState(null);
  const [chatSel, setChatSel] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await api.whatsapp.contextChats(subjectType, subjectId));
    } catch {
      /* bubble stays; popup shows the empty state until the next refresh */
    }
  }, [subjectType, subjectId]);

  useEffect(() => {
    load();
  }, [load]);

  // While open, keep the chat list fresh on a slow cadence (new chats appear;
  // the thread itself polls fast on its own).
  useEffect(() => {
    if (!open) return undefined;
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, 45_000);
    return () => clearInterval(t);
  }, [open, load]);

  // Group chats by CRM contact — the selector is contact-first, and a contact
  // with threads on both of our numbers gets a small secondary switcher.
  const contacts = useMemo(() => {
    const map = new Map();
    for (const c of data?.chats || []) {
      const key = c.contact?.id || c.contactId || c.id;
      if (!map.has(key)) {
        map.set(key, { id: key, name: c.contact?.name || c.displayName || 'לא מזוהה', chats: [] });
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
  const activeChat =
    activeContact?.chats.find((c) => c.id === chatSel) || activeContact?.chats[0] || null;

  return (
    <>
      {/* Bubble — always visible, top of the seam next to the sales script. */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        title="WhatsApp"
        aria-label="WhatsApp"
        aria-expanded={open}
        className={`fixed left-5 top-24 z-40 flex h-12 w-12 items-center justify-center rounded-full shadow-lg ring-1 transition hover:scale-105 ${
          open ? 'bg-emerald-600 ring-emerald-700' : 'bg-white ring-gray-200'
        }`}
      >
        {open ? <span className="text-xl text-white">×</span> : <WhatsAppLogo size={26} />}
      </button>

      {open && (
        <div className="fixed bottom-4 left-4 top-40 z-40 flex w-[440px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2">
            <WhatsAppLogo size={18} />
            <span className="text-[13px] font-semibold text-gray-900">WhatsApp</span>
            {activeContact && (
              <span className="min-w-0 truncate text-[12px] text-gray-500">
                · {activeContact.name}
                {activeChat?.account?.label ? ` · ${activeChat.account.label}` : ''}
              </span>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="סגירה"
              className="mr-auto flex h-7 w-7 items-center justify-center rounded-full text-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            >
              ×
            </button>
          </div>

          {/* Contact selector — only when the deal has multiple contacts. */}
          {contacts.length > 1 && (
            <div className="flex items-center gap-1.5 overflow-x-auto border-b border-gray-100 px-3 py-1.5">
              {contacts.map((c) => {
                const active = activeContact && c.id === activeContact.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setContactSel(c.id);
                      setChatSel(null);
                    }}
                    className={`whitespace-nowrap rounded-full border px-3 py-1 text-[12px] font-medium transition ${
                      active
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {c.name}
                    {c.id === data?.primaryContactId && contacts.length > 1 && (
                      <span className={active ? 'text-emerald-100' : 'text-gray-400'}> ★</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Same contact on more than one of our numbers → number switcher. */}
          {activeContact && activeContact.chats.length > 1 && (
            <div className="flex items-center gap-1.5 overflow-x-auto border-b border-gray-100 px-3 py-1.5">
              {activeContact.chats.map((c) => {
                const active = activeChat && c.id === activeChat.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setChatSel(c.id)}
                    className={`whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition ${
                      active
                        ? 'border-gray-700 bg-gray-700 text-white'
                        : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    {c.account?.label || c.accountId}
                  </button>
                );
              })}
            </div>
          )}

          {/* Body */}
          <div className="min-h-0 flex-1">
            {activeChat ? (
              <ChatThread key={activeChat.id} chat={activeChat} fill />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                <WhatsAppLogo size={28} />
                <p className="text-sm font-medium text-gray-700">אין שיחת WhatsApp מקושרת</p>
                <p className="text-[12px] leading-relaxed text-gray-500">
                  שיחות מתקשרות אוטומטית לפי מספר הטלפון של אנשי הקשר בדיל.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
