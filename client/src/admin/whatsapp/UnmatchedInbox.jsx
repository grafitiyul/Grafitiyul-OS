import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import WhatsAppLogo from '../common/WhatsAppLogo.jsx';
import ChatThread from './ChatThread.jsx';

// Unmatched inbox (Slice 8) — private WhatsApp chats that no Contact owns.
// Anything auto-matchable (exactly one Contact owns the number) links itself
// before reaching this list; what's here needs a human decision. Linking is
// to an EXISTING Contact only and never touches the Contact itself —
// reviewable and reversible (matchSource='manual').

function fmtWhen(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '';
  }
}

function snippet(msg) {
  if (!msg) return 'אין הודעות';
  if (msg.textContent) return msg.textContent.slice(0, 80);
  return { image: '📷 תמונה', video: '🎬 סרטון', audio: '🎤 הודעה קולית', document: '📄 מסמך', sticker: 'סטיקר' }[msg.messageType] || 'הודעה';
}

function contactLabel(c) {
  return c.fullNameHe || c.fullNameEn || `${c.firstNameHe || ''} ${c.lastNameHe || ''}`.trim() || '—';
}

// Inline contact picker: loads the CRM contact list once, filters locally by
// name/phone. Small data set at this stage — no server search needed.
function ContactPicker({ onPick, onCancel, busy }) {
  const [contacts, setContacts] = useState(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    api.contacts.list().then(setContacts).catch(() => setContacts([]));
  }, []);

  const filtered = useMemo(() => {
    if (!contacts) return [];
    const needle = q.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    if (!needle) return contacts.slice(0, 8);
    return contacts
      .filter((c) => {
        const name = contactLabel(c).toLowerCase();
        const phone = c.phones?.[0]?.value?.replace(/\D/g, '') || '';
        return name.includes(needle) || (digits.length >= 3 && phone.includes(digits));
      })
      .slice(0, 8);
  }, [contacts, q]);

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-2.5">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="חיפוש איש קשר לפי שם או טלפון…"
          dir="auto"
          className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] focus:border-blue-500 focus:outline-none"
        />
        <button type="button" onClick={onCancel} className="text-[12px] text-gray-500 hover:text-gray-700">
          ביטול
        </button>
      </div>
      <div className="mt-2 max-h-56 overflow-y-auto">
        {contacts === null ? (
          <p className="px-2 py-3 text-center text-[12px] text-gray-400">טוען אנשי קשר…</p>
        ) : filtered.length === 0 ? (
          <p className="px-2 py-3 text-center text-[12px] text-gray-400">
            לא נמצאו אנשי קשר תואמים. ניתן ליצור איש קשר חדש במסך אנשי הקשר ואז לשייך.
          </p>
        ) : (
          <ul className="divide-y divide-blue-100">
            {filtered.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onPick(c)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-right hover:bg-white disabled:opacity-50"
                >
                  <span className="text-[13px] font-medium text-gray-800">{contactLabel(c)}</span>
                  <span dir="ltr" className="text-[12px] text-gray-400">{c.phones?.[0]?.value || ''}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function UnmatchedInbox({ onCountChange }) {
  const [chats, setChats] = useState(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(null); // chatId with open thread
  const [linking, setLinking] = useState(null); // chatId with open picker
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (q) => {
    try {
      const rows = await api.whatsapp.unmatchedChats(q || undefined);
      setChats(rows);
      setError(null);
      onCountChange?.(rows.length);
    } catch (e) {
      setError(e?.payload?.error || e?.message || 'failed');
    }
  }, [onCountChange]);

  useEffect(() => {
    const t = setTimeout(() => load(search), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [search, load]);

  async function link(chat, contact) {
    setBusy(true);
    try {
      await api.whatsapp.linkChat(chat.id, contact.id);
      setLinking(null);
      setExpanded(null);
      await load(search);
    } catch {
      setError('השיוך נכשל — נסו שוב.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="חיפוש לפי שם או מספר…"
        dir="auto"
        className="w-full max-w-sm rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm focus:border-emerald-500 focus:outline-none"
      />

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          שגיאה: <span dir="ltr" className="font-mono">{error}</span>
        </div>
      )}

      {chats === null ? (
        <div className="rounded-2xl border border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-400">
          טוען שיחות…
        </div>
      ) : chats.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
            <WhatsAppLogo size={30} />
          </div>
          <h2 className="text-[15px] font-semibold text-gray-900">
            {search ? 'אין תוצאות לחיפוש הזה' : 'כל השיחות משויכות'}
          </h2>
          {!search && (
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-gray-500">
              שיחות ממספרים שאינם מוכרים במערכת יופיעו כאן לשיוך ידני לאיש קשר.
            </p>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {chats.map((chat) => (
            <li key={chat.id} className="rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14px] font-semibold text-gray-900" dir="auto">
                      {chat.displayName || 'לא מזוהה'}
                    </span>
                    {chat.phoneNumber && chat.displayName !== chat.phoneNumber && (
                      <span dir="ltr" className="text-[12px] text-gray-400">{chat.phoneNumber}</span>
                    )}
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">
                      {chat.account?.label || chat.accountId}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[12px] text-gray-500" dir="auto">
                    {snippet(chat.lastMessage)}
                    {chat.lastMessageAt && <span className="text-gray-400"> · {fmtWhen(chat.lastMessageAt)}</span>}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setExpanded(expanded === chat.id ? null : chat.id);
                      setLinking(null);
                    }}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-[12px] font-medium text-gray-600 hover:bg-gray-50"
                  >
                    {expanded === chat.id ? 'סגור שיחה' : 'צפייה בשיחה'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setLinking(linking === chat.id ? null : chat.id)}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-emerald-700"
                  >
                    שיוך לאיש קשר
                  </button>
                </div>
              </div>
              {linking === chat.id && (
                <div className="border-t border-gray-100 px-4 py-3">
                  <ContactPicker busy={busy} onPick={(c) => link(chat, c)} onCancel={() => setLinking(null)} />
                </div>
              )}
              {expanded === chat.id && (
                <div className="border-t border-gray-100 p-3">
                  <ChatThread chat={chat} heightClass="h-[22rem]" />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
