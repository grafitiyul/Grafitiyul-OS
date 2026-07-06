import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import RichEditor from '../../editor/RichEditor.jsx';
import { useDirtyForm } from '../../lib/dirtyForms.js';

// Email composer — new mail or reply. Sends through the connected Gmail
// account (selectable when several are connected). Recipients are simple
// comma-separated address inputs (V1); the body is the shared RichEditor.
// Attachments ride the JSON send request as base64 (16MB total, matching the
// server limit).

const MAX_ATTACHMENT_TOTAL = 15 * 1024 * 1024;

function parseRecipients(text) {
  return String(text || '')
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
}

function editorIsEmpty(html) {
  return !html || !html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

export default function EmailComposer({
  defaultTo = '',
  defaultSubject = '',
  replyToMessageId = null,
  dealId = null,
  contactId = null,
  onSent,
  onCancel,
}) {
  const [accounts, setAccounts] = useState(null);
  const [accountId, setAccountId] = useState(null);
  const [to, setTo] = useState(defaultTo);
  const [cc, setCc] = useState('');
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState('');
  const [files, setFiles] = useState([]); // { filename, mimeType, dataBase64, size }
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.email
      .accounts()
      .then((d) => {
        const connected = (d.accounts || []).filter((a) => a.connected && a.isActive);
        setAccounts(connected);
        setAccountId((cur) => cur || connected[0]?.id || null);
      })
      .catch(() => setAccounts([]));
  }, []);

  const dirty = !!(to.trim() || subject.trim() || !editorIsEmpty(body) || files.length);
  useDirtyForm(dirty && !sending);

  async function addFiles(list) {
    const next = [...files];
    let total = next.reduce((s, f) => s + f.size, 0);
    for (const file of list) {
      total += file.size;
      if (total > MAX_ATTACHMENT_TOTAL) {
        setError('סך הקבצים המצורפים חורג מ-15MB');
        break;
      }
      const dataBase64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1] || '');
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      next.push({
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        dataBase64,
        size: file.size,
      });
    }
    setFiles(next);
  }

  async function send() {
    const toList = parseRecipients(to);
    if (!toList.length) return setError('נדרשת כתובת נמען תקינה');
    if (!replyToMessageId && !subject.trim()) return setError('נדרש נושא');
    if (editorIsEmpty(body)) return setError('אין תוכן להודעה');
    setSending(true);
    setError(null);
    try {
      const result = await api.email.send({
        accountId,
        to: toList,
        cc: parseRecipients(cc),
        subject: subject.trim(),
        bodyHtml: body,
        replyToMessageId,
        dealId,
        contactId,
        attachments: files.map(({ filename, mimeType, dataBase64 }) => ({ filename, mimeType, dataBase64 })),
      });
      onSent?.(result);
    } catch (e) {
      setError('השליחה נכשלה: ' + (e.payload?.error || e.message));
    } finally {
      setSending(false);
    }
  }

  const field =
    'w-full rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] focus:border-blue-500 focus:outline-none';

  if (accounts !== null && accounts.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-[13px] text-gray-500">
        אין חשבון Gmail מחובר. חברו חשבון במסך <a href="/admin/email" className="text-blue-700 underline">אימייל</a>.
      </div>
    );
  }

  return (
    <div className="space-y-2" dir="rtl">
      {accounts && accounts.length > 1 && (
        <label className="flex items-center gap-2 text-[12px] text-gray-500">
          <span>נשלח מ:</span>
          <select value={accountId || ''} onChange={(e) => setAccountId(e.target.value)} className={field + ' max-w-xs'}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.emailAddress}</option>
            ))}
          </select>
        </label>
      )}
      <div className="flex items-center gap-2">
        <input
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="אל: כתובת אימייל (מופרדות בפסיק)"
          dir="ltr"
          className={field}
        />
        {!showCc && (
          <button type="button" onClick={() => setShowCc(true)} className="shrink-0 text-[12px] text-gray-400 hover:text-gray-600">
            + עותק
          </button>
        )}
      </div>
      {showCc && (
        <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="עותק (Cc)" dir="ltr" className={field} />
      )}
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder={replyToMessageId ? 'נושא (ריק = Re: אוטומטי)' : 'נושא'}
        dir="auto"
        className={field}
      />
      <RichEditor
        preset="lite"
        value={body}
        onChange={setBody}
        placeholder="תוכן ההודעה…"
        maxHeight="40vh"
        ariaLabel="תוכן המייל"
      />
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {files.map((f, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-[12px]">
              📎 <span dir="ltr" className="max-w-[160px] truncate">{f.filename}</span>
              <button
                type="button"
                onClick={() => setFiles(files.filter((_, j) => j !== i))}
                className="text-gray-400 hover:text-red-600"
                aria-label="הסרת קובץ"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {error && <p className="text-[12.5px] text-red-600">{error}</p>}
      <div className="flex items-center justify-between gap-2">
        <label className="cursor-pointer rounded-lg px-2 py-1 text-[12.5px] text-gray-500 hover:bg-gray-100">
          📎 צירוף קובץ
          <input
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles([...e.target.files]);
              e.target.value = '';
            }}
          />
        </label>
        <div className="flex gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={sending}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              ביטול
            </button>
          )}
          <button
            type="button"
            onClick={send}
            disabled={sending}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {sending ? 'שולח…' : 'שליחה'}
          </button>
        </div>
      </div>
    </div>
  );
}
