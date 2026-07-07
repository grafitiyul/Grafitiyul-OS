import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import EmailThreadView from './EmailThreadView.jsx';
import EmailComposer from './EmailComposer.jsx';

// The Email surface a CRM page embeds (Deal אימייל tab / Contact page) —
// mirror of WhatsAppPanel: threads linked to the subject, open one inline,
// or compose a new email (recipient defaults to the primary contact email).

function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function EmailPanel({ subjectType, subjectId }) {
  const [threads, setThreads] = useState(null);
  const [error, setError] = useState(null);
  const [openThreadId, setOpenThreadId] = useState(null);
  const [composing, setComposing] = useState(false);
  const [defaultTo, setDefaultTo] = useState('');

  const isDeal = subjectType === 'deal';

  const load = useCallback(async () => {
    try {
      const list = isDeal
        ? await api.email.threadsByDeal(subjectId)
        : await api.email.threadsByContact(subjectId);
      setThreads(list);
      setError(null);
    } catch (e) {
      setError(e?.payload?.error || e?.message || 'failed');
    }
  }, [isDeal, subjectId]);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, 45_000);
    return () => clearInterval(t);
  }, [load]);

  // Default recipient for a NEW email: the deal's primary contact's primary
  // email / the contact's primary email.
  useEffect(() => {
    (async () => {
      try {
        if (isDeal) {
          const deal = await api.deals.get(subjectId);
          const primary = (deal.contacts || []).find((dc) => dc.isPrimary) || (deal.contacts || [])[0];
          setDefaultTo(primary?.contact?.emails?.[0]?.value || '');
        } else {
          const contact = await api.contacts.get(subjectId);
          const primary = (contact.emails || []).find((e) => e.isPrimary) || (contact.emails || [])[0];
          setDefaultTo(primary?.value || '');
        }
      } catch {
        /* default stays empty */
      }
    })();
  }, [isDeal, subjectId]);

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-center text-sm text-red-700">
        שגיאה בטעינת המיילים: <span dir="ltr" className="font-mono">{error}</span>
      </div>
    );
  }
  if (threads === null) {
    return <div className="rounded-xl bg-gray-50 px-4 py-10 text-center text-sm text-gray-400">טוען מיילים…</div>;
  }

  if (composing) {
    return (
      <EmailComposer
        defaultTo={defaultTo}
        dealId={isDeal ? subjectId : null}
        contactId={isDeal ? null : subjectId}
        draftKey={`${subjectType}:${subjectId}:new`}
        onCancel={() => setComposing(false)}
        onSent={() => {
          setComposing(false);
          load();
        }}
      />
    );
  }

  if (openThreadId) {
    const t = threads.find((x) => x.id === openThreadId);
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setOpenThreadId(null)}
          className="text-[12.5px] font-medium text-blue-700 hover:underline"
        >
          ← חזרה לרשימת המיילים
        </button>
        {t?.subject && <p className="text-[13.5px] font-semibold text-gray-800" dir="auto">{t.subject}</p>}
        <EmailThreadView
          threadId={openThreadId}
          dealId={isDeal ? subjectId : null}
          contactId={isDeal ? null : subjectId}
          onChanged={load}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2" dir="rtl">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] text-gray-500">
          {threads.length ? `${threads.length} שיחות מייל` : ''}
        </span>
        <button
          type="button"
          onClick={() => setComposing(true)}
          className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:bg-blue-700"
        >
          + מייל חדש
        </button>
      </div>

      {threads.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center">
          <p className="text-sm font-medium text-gray-700">אין עדיין תכתובת מייל</p>
          <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-gray-500">
            {isDeal
              ? 'מיילים מקושרים לדיל אוטומטית לפי איש הקשר, או ידנית מתיבת האימייל.'
              : 'מיילים מקושרים אוטומטית לפי כתובת האימייל של איש הקשר.'}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {threads.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setOpenThreadId(t.id)}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-right hover:bg-gray-50"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2">
                    <span className={`truncate text-[13.5px] ${t.unreadCount ? 'font-bold text-gray-900' : 'font-medium text-gray-800'}`} dir="auto">
                      {t.subject || '(ללא נושא)'}
                    </span>
                    {t.unreadCount > 0 && (
                      <span className="shrink-0 rounded-full bg-blue-600 px-1.5 text-[10.5px] font-bold text-white">
                        {t.unreadCount}
                      </span>
                    )}
                  </p>
                  <p className="truncate text-[12px] text-gray-400" dir="auto">{t.snippet || ''}</p>
                </div>
                <span className="shrink-0 text-[11px] text-gray-400">{fmtTime(t.lastMessageAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
