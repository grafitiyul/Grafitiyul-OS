import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import EmailMessageView from './EmailMessageView.jsx';
import EmailComposer from './EmailComposer.jsx';

// One email conversation: messages oldest→newest (older ones collapsed, the
// last open), reply composer at the bottom. Opening the thread marks it read
// GOS-SIDE ONLY — Gmail itself is never touched.

export default function EmailThreadView({ threadId, dealId = null, contactId = null, onChanged }) {
  const [data, setData] = useState(null); // { thread, messages }
  const [error, setError] = useState(null);
  const [replyTo, setReplyTo] = useState(null); // message being replied to

  const load = useCallback(async () => {
    try {
      setData(await api.email.thread(threadId));
      setError(null);
    } catch (e) {
      setError(e?.payload?.error || e?.message || 'failed');
    }
  }, [threadId]);

  useEffect(() => {
    load();
    // New inbound replies land via the sync worker — refresh on a slow cadence.
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, 30_000);
    return () => clearInterval(t);
  }, [load]);

  // Reading the thread = read (GOS-side).
  useEffect(() => {
    api.email.markThreadRead(threadId).then(() => onChanged?.()).catch(() => {});
  }, [threadId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-center text-sm text-red-700">
        שגיאה בטעינת השיחה: <span dir="ltr" className="font-mono">{error}</span>
      </div>
    );
  }
  if (!data) {
    return <div className="rounded-xl bg-gray-50 px-4 py-8 text-center text-sm text-gray-400">טוען…</div>;
  }

  const { thread, messages } = data;
  const last = messages[messages.length - 1] || null;
  // Reply target: the message the user picked, else the last one.
  const replySource = replyTo || last;
  // Default recipients: reply to the counterparty (inbound → its sender;
  // outbound → the original To list).
  const replyDefaultTo = replySource
    ? replySource.direction === 'inbound'
      ? replySource.fromEmail || ''
      : (replySource.toRecipients || []).map((r) => r.email).join(', ')
    : (thread.participants || []).map((p) => p.email).join(', ');

  return (
    <div className="space-y-2" dir="rtl">
      <div className="space-y-2">
        {messages.map((m, i) => (
          <EmailMessageView
            key={m.id}
            message={m}
            defaultOpen={i === messages.length - 1}
            onReply={(msg) => setReplyTo(msg)}
          />
        ))}
        {messages.length === 0 && (
          <p className="rounded-xl bg-gray-50 px-4 py-6 text-center text-[13px] text-gray-400">אין הודעות בשיחה</p>
        )}
      </div>

      {replyTo !== null ? (
        <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-3">
          <p className="mb-2 text-[12px] font-medium text-gray-600">
            תגובה ל: <span dir="auto">{replySource?.subject || thread.subject || ''}</span>
          </p>
          <EmailComposer
            defaultTo={replyDefaultTo}
            replyToMessageId={replySource?.id || null}
            dealId={dealId || thread.linkedDealId}
            contactId={contactId || thread.contactId}
            onCancel={() => setReplyTo(null)}
            onSent={() => {
              setReplyTo(null);
              load();
              onChanged?.();
            }}
          />
        </div>
      ) : (
        last && (
          <button
            type="button"
            onClick={() => setReplyTo(last)}
            className="w-full rounded-xl border border-dashed border-gray-300 bg-white px-4 py-2.5 text-right text-[13px] text-gray-500 hover:border-blue-400 hover:text-blue-700"
          >
            ↩ השב לשיחה…
          </button>
        )
      )}
    </div>
  );
}
