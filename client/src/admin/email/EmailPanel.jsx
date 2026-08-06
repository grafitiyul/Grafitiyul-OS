import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import EmailComposer from './EmailComposer.jsx';
import EmailThreadRow from './EmailThreadRow.jsx';
import EmailThreadModal from './EmailThreadModal.jsx';
import ScheduledEmailsView from './ScheduledEmailsView.jsx';

// The Email surface a CRM page embeds (Deal אימייל tab / Contact page) —
// mirror of WhatsAppPanel: the conversations linked to this subject, or a new
// email (recipient defaults to the primary contact email).
//
// The LIST is the shared EmailThreadRow and opening one is the shared
// EmailThreadModal, so a conversation looks and behaves the same whether it is
// read from a Deal or from a Contact. Reading used to REPLACE this panel in
// place, which meant working through a long exchange inside a narrow CRM
// column and losing the list to get back out of it.

export default function EmailPanel({ subjectType, subjectId }) {
  const [threads, setThreads] = useState(null);
  const [error, setError] = useState(null);
  const [openThread, setOpenThread] = useState(null);
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

  return (
    <div className="space-y-2" dir="rtl">
      {/* Pending outgoing mail for THIS customer — the same canonical scheduled
          management component, scoped to this deal/contact, so a user sees what
          is about to go out to them without leaving the record. */}
      <ScheduledEmailsView
        compact
        dealId={isDeal ? subjectId : null}
        contactId={isDeal ? null : subjectId}
        onChanged={load}
      />
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
              {/* On a CONTACT the deal context is real information (which job
                  is this about); on a Deal it is already the answer. */}
              <EmailThreadRow thread={t} onOpen={setOpenThread} showDeal={!isDeal} />
            </li>
          ))}
        </ul>
      )}

      <EmailThreadModal
        open={!!openThread}
        thread={openThread}
        dealId={isDeal ? subjectId : null}
        contactId={isDeal ? null : subjectId}
        onClose={() => {
          setOpenThread(null);
          load(); // read state / a sent reply must show on the list behind it
        }}
        onChanged={load}
      />
    </div>
  );
}
