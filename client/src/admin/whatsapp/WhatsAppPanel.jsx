import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import WhatsAppLogo from '../common/WhatsAppLogo.jsx';
import ChatThread from './ChatThread.jsx';

// The WhatsApp surface a CRM page embeds (Deal tab / Contact page /
// Organization page — one component, one store, zero duplication). Resolves
// the subject to its linked chats via the context API; when the subject has
// chats with more than one of our numbers (or several contacts), a switcher
// picks the thread. Chats link to Contacts by phone matching only — this
// panel never creates data.

export default function WhatsAppPanel({ subjectType, subjectId }) {
  const [chats, setChats] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await api.whatsapp.contextChats(subjectType, subjectId);
      setChats(data.chats);
      setError(null);
    } catch (e) {
      setError(e?.payload?.error || e?.message || 'failed');
    }
  }, [subjectType, subjectId]);

  // The chat LIST changes rarely (a brand-new chat with this subject);
  // refresh it on a slow cadence — the thread itself polls fast.
  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, 45_000);
    return () => clearInterval(t);
  }, [load]);

  const selected = (chats || []).find((c) => c.id === selectedId) || (chats || [])[0] || null;

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-center text-sm text-red-700">
        שגיאה בטעינת שיחות WhatsApp: <span dir="ltr" className="font-mono">{error}</span>
      </div>
    );
  }
  if (chats === null) {
    return <div className="rounded-xl bg-gray-50 px-4 py-10 text-center text-sm text-gray-400">טוען שיחות…</div>;
  }
  if (chats.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50">
          <WhatsAppLogo size={24} />
        </div>
        <p className="text-sm font-medium text-gray-700">אין שיחת WhatsApp מקושרת</p>
        <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-gray-500">
          שיחות מתקשרות אוטומטית לפי מספר הטלפון של אנשי הקשר. ברגע שתתקיים
          שיחה עם אחד מאנשי הקשר — היא תופיע כאן.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {chats.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chats.map((c) => {
            const active = selected && c.id === selected.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedId(c.id)}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium transition ${
                  active
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                <span>{c.displayName || 'לא מזוהה'}</span>
                <span className={active ? 'text-emerald-100' : 'text-gray-400'}>
                  · {c.account?.label || c.accountId}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {selected && (
        <>
          {chats.length === 1 && (
            <p className="flex items-center gap-1.5 text-[12px] text-gray-500">
              <WhatsAppLogo size={14} />
              <span>{selected.displayName || 'לא מזוהה'}</span>
              <span className="text-gray-400">· {selected.account?.label || selected.accountId}</span>
            </p>
          )}
          <ChatThread key={selected.id} chat={selected} />
        </>
      )}
    </div>
  );
}
