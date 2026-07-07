import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import EmailMessageView from './EmailMessageView.jsx';
import EmailComposer from './EmailComposer.jsx';

// One email conversation: messages oldest→newest (older ones collapsed, the
// last open), reply / reply-all / forward with Gmail-style quoted history.
// Opening the thread marks it read (Gmail-synced when the account has the
// modify scope; GOS-side otherwise).

function fmtStamp(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function senderLabel(msg) {
  return msg.fromName ? `${msg.fromName} <${msg.fromEmail || ''}>` : msg.fromEmail || '';
}

function bodyOf(msg) {
  return msg.bodyHtml || `<pre>${escapeHtml(msg.bodyText || '')}</pre>`;
}

// Gmail-style quoted history appended below the caret + signature.
function quotedReplyBlock(msg) {
  return (
    `<p></p><p style="color:#6b7280">בתאריך ${fmtStamp(msg.sentAt)}, ‏${escapeHtml(senderLabel(msg))} כתב/ה:</p>` +
    `<blockquote>${bodyOf(msg)}</blockquote>`
  );
}

function forwardBlock(msg) {
  const to = (msg.toRecipients || []).map((r) => r.name || r.email).join(', ');
  return (
    '<p></p><p>---------- הודעה שהועברה ----------</p>' +
    `<p>מאת: ${escapeHtml(senderLabel(msg))}<br>` +
    `תאריך: ${fmtStamp(msg.sentAt)}<br>` +
    `נושא: ${escapeHtml(msg.subject || '')}<br>` +
    `אל: ${escapeHtml(to)}</p>` +
    bodyOf(msg)
  );
}

// Recipient computation. Reply → the counterparty; reply-all → everyone on
// the source message except our own account address.
function recipientsFor(msg, mode, ownEmail) {
  const own = String(ownEmail || '').toLowerCase();
  const tos = (msg.toRecipients || []).map((r) => r.email);
  const ccs = (msg.ccRecipients || []).map((r) => r.email);
  if (mode === 'reply') {
    const to = msg.direction === 'inbound' ? [msg.fromEmail] : tos;
    return { to: [...new Set(to.filter(Boolean))].join(', '), cc: '' };
  }
  // replyAll
  const from = msg.direction === 'inbound' && msg.fromEmail ? [msg.fromEmail] : [];
  const toSet = [...new Set([...from, ...tos].map((e) => String(e || '').toLowerCase()))].filter(
    (e) => e && e !== own,
  );
  const ccSet = [...new Set(ccs.map((e) => String(e || '').toLowerCase()))].filter(
    (e) => e && e !== own && !toSet.includes(e),
  );
  return { to: toSet.join(', '), cc: ccSet.join(', ') };
}

export default function EmailThreadView({ threadId, dealId = null, contactId = null, onChanged }) {
  const [data, setData] = useState(null); // { thread, messages }
  const [error, setError] = useState(null);
  const [composeState, setComposeState] = useState(null); // { mode, message }
  const [ownEmail, setOwnEmail] = useState('');

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

  // Our own address (to exclude from reply-all).
  useEffect(() => {
    if (!data?.thread?.accountId) return;
    api.email
      .accounts()
      .then((d) => {
        const acc = (d.accounts || []).find((a) => a.id === data.thread.accountId);
        if (acc) setOwnEmail(acc.emailAddress);
      })
      .catch(() => {});
  }, [data?.thread?.accountId]);

  // Reading the thread = read (Gmail-synced when the scope allows).
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

  function openComposer(message, mode) {
    setComposeState({ mode, message });
  }

  const composer = (() => {
    if (!composeState) return null;
    const { mode, message } = composeState;
    const isForward = mode === 'forward';
    const { to, cc } = isForward ? { to: '', cc: '' } : recipientsFor(message, mode, ownEmail);
    return (
      <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-3">
        <p className="mb-2 text-[12px] font-medium text-gray-600">
          {isForward ? 'העברת הודעה' : mode === 'replyAll' ? 'תגובה לכולם' : 'תגובה'}
          {': '}
          <span dir="auto">{message.subject || thread.subject || ''}</span>
        </p>
        <EmailComposer
          key={`${mode}:${message.id}`}
          defaultTo={to}
          defaultCc={cc}
          initialBody={isForward ? forwardBlock(message) : quotedReplyBlock(message)}
          replyToMessageId={isForward ? null : message.id}
          forwardOfMessageId={isForward ? message.id : null}
          dealId={dealId || thread.linkedDealId}
          contactId={contactId || thread.contactId}
          draftKey={`thread:${thread.id}:${mode}:${message.id}`}
          onCancel={() => setComposeState(null)}
          onSent={() => {
            setComposeState(null);
            load();
            onChanged?.();
          }}
        />
      </div>
    );
  })();

  return (
    <div className="space-y-2" dir="rtl">
      <div className="space-y-2">
        {messages.map((m, i) => (
          <EmailMessageView
            key={m.id}
            message={m}
            defaultOpen={i === messages.length - 1}
            onReply={openComposer}
          />
        ))}
        {messages.length === 0 && (
          <p className="rounded-xl bg-gray-50 px-4 py-6 text-center text-[13px] text-gray-400">אין הודעות בשיחה</p>
        )}
      </div>

      {composer ||
        (last && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => openComposer(last, 'reply')}
              className="flex-1 rounded-xl border border-dashed border-gray-300 bg-white px-4 py-2.5 text-right text-[13px] text-gray-500 hover:border-blue-400 hover:text-blue-700"
            >
              ↩ השב
            </button>
            <button
              type="button"
              onClick={() => openComposer(last, 'replyAll')}
              className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-2.5 text-[13px] text-gray-500 hover:border-blue-400 hover:text-blue-700"
            >
              השב לכולם
            </button>
            <button
              type="button"
              onClick={() => openComposer(last, 'forward')}
              className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-2.5 text-[13px] text-gray-500 hover:border-blue-400 hover:text-blue-700"
            >
              ⤴ העבר
            </button>
          </div>
        ))}
    </div>
  );
}
