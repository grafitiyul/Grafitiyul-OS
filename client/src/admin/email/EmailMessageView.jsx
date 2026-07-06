import { useRef, useState } from 'react';
import { api } from '../../lib/api.js';

// One email message in a thread: header (from/to/time), the HTML body inside a
// SANDBOXED iframe (allow-same-origin only, no allow-scripts — JS cannot run;
// the server also sanitized the HTML at ingest), attachments (private,
// presigned on demand) and the honest engagement line for outbound mail.

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

function recipientsLine(list) {
  return (list || [])
    .map((r) => r.name || r.email)
    .filter(Boolean)
    .join(', ');
}

function AttachmentChip({ att }) {
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    try {
      const { url } = await api.email.attachmentDownload(att.id);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      alert('שגיאה בהורדת הקובץ: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      disabled={busy}
      onClick={download}
      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-[12px] text-gray-700 hover:bg-gray-100 disabled:opacity-50"
      title={att.mimeType || ''}
    >
      📎 <span className="max-w-[180px] truncate" dir="ltr">{att.fileName}</span>
      {busy && <span className="text-gray-400">…</span>}
    </button>
  );
}

function HtmlBody({ html }) {
  const frameRef = useRef(null);
  const [height, setHeight] = useState(120);
  const srcDoc = `<!doctype html><html dir="auto"><head><meta charset="utf-8"><base target="_blank"><style>
    body{margin:8px;font:14px/1.6 -apple-system,'Segoe UI',Arial,sans-serif;color:#111827;word-break:break-word;overflow-wrap:anywhere}
    img{max-width:100%;height:auto} table{max-width:100%}
  </style></head><body>${html}</body></html>`;
  return (
    <iframe
      ref={frameRef}
      title="תוכן המייל"
      sandbox="allow-same-origin allow-popups"
      srcDoc={srcDoc}
      style={{ height }}
      className="w-full rounded-lg border border-gray-100 bg-white"
      onLoad={() => {
        try {
          const h = frameRef.current?.contentDocument?.body?.scrollHeight;
          if (h) setHeight(Math.min(Math.max(h + 24, 60), 1200));
        } catch {
          /* sandbox blocked measurement — keep default height */
        }
      }}
    />
  );
}

export default function EmailMessageView({ message, defaultOpen = true, onReply }) {
  const [open, setOpen] = useState(defaultOpen);
  const outbound = message.direction === 'outbound';
  const opens = message.engagement?.openCount || 0;

  return (
    <div className={`rounded-xl border ${outbound ? 'border-blue-100 bg-blue-50/30' : 'border-gray-200 bg-white'}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-right"
      >
        <span
          className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1 ${
            outbound ? 'bg-blue-50 text-blue-700 ring-blue-200' : 'bg-gray-100 text-gray-600 ring-gray-200'
          }`}
        >
          {outbound ? 'נשלח' : 'התקבל'}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-gray-800" dir="auto">
          <span className="font-medium">{message.fromName || message.fromEmail}</span>
          {!open && message.snippet && <span className="text-gray-400"> — {message.snippet}</span>}
        </span>
        {message.hasAttachments && <span className="shrink-0 text-[12px] text-gray-400">📎</span>}
        <span className="shrink-0 text-[11px] text-gray-400">{fmtStamp(message.sentAt)}</span>
      </button>

      {open && (
        <div className="border-t border-gray-100 px-3 pb-3 pt-2">
          <p className="mb-2 text-[11.5px] text-gray-500" dir="auto">
            אל: {recipientsLine(message.toRecipients) || '—'}
            {(message.ccRecipients || []).length > 0 && <> · עותק: {recipientsLine(message.ccRecipients)}</>}
          </p>
          {message.bodyHtml ? (
            <HtmlBody html={message.bodyHtml} />
          ) : (
            <pre className="whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-3 text-[13px] leading-relaxed text-gray-800" dir="auto">
              {message.bodyText || message.snippet || ''}
            </pre>
          )}
          {(message.attachments || []).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {message.attachments.map((a) => (
                <AttachmentChip key={a.id} att={a} />
              ))}
            </div>
          )}
          <div className="mt-2 flex items-center justify-between gap-2">
            {outbound ? (
              <span
                className={`text-[11.5px] ${opens > 0 ? 'font-medium text-emerald-700' : 'text-gray-400'}`}
                title="מבוסס על פיקסל מעקב — לא מדויק ב-100% (פרוקסי תמונות של Gmail, הגנת פרטיות של Apple, חוסמים)"
              >
                {opens > 0
                  ? `נפתח · ${opens} פתיחות · ${fmtStamp(message.engagement?.lastOpenedAt)}`
                  : 'טרם נרשמה פתיחה'}
              </span>
            ) : (
              <span />
            )}
            {onReply && (
              <button
                type="button"
                onClick={() => onReply(message)}
                className="rounded-lg px-2.5 py-1 text-[12px] font-medium text-blue-700 hover:bg-blue-50"
              >
                ↩ השב
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
