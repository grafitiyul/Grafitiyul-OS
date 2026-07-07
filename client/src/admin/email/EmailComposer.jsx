import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import RichEditor from '../../editor/RichEditor.jsx';
import { useDirtyForm } from '../../lib/dirtyForms.js';

// Email composer — new mail, reply, reply-all or forward. Sends through the
// connected Gmail account (selectable when several are connected).
//
// Gmail-client behaviors:
//   • To / Cc / Bcc (comma-separated addresses)
//   • attachments via picker OR drag & drop onto the composer
//   • per-account signature auto-appended (above the quoted history)
//   • quoted history arrives via initialBody (reply/forward builders)
//   • local draft persistence (localStorage, keyed by context) — a half-
//     written email survives closing the drawer/thread. Gmail Drafts API
//     sync is a future slice; the storage seam is this draftKey.

const MAX_ATTACHMENT_TOTAL = 15 * 1024 * 1024;
const DRAFTS_KEY = 'gos-email-drafts';

function readDrafts() {
  try {
    return JSON.parse(localStorage.getItem(DRAFTS_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function writeDraft(key, draft) {
  if (!key) return;
  try {
    const map = readDrafts();
    if (draft) map[key] = draft;
    else delete map[key];
    const keys = Object.keys(map);
    if (keys.length > 50) for (const k of keys.slice(0, keys.length - 50)) delete map[k];
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

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
  defaultCc = '',
  defaultSubject = '',
  initialBody = '', // quoted history for reply/forward (below the caret + signature)
  replyToMessageId = null,
  forwardOfMessageId = null,
  dealId = null,
  contactId = null,
  draftKey = null,
  onSent,
  onCancel,
}) {
  const [accounts, setAccounts] = useState(null);
  const [accountId, setAccountId] = useState(null);
  // Restore a saved local draft for this context, else start from props.
  const saved = draftKey ? readDrafts()[draftKey] : null;
  const [to, setTo] = useState(saved?.to ?? defaultTo);
  const [cc, setCc] = useState(saved?.cc ?? defaultCc);
  const [bcc, setBcc] = useState(saved?.bcc ?? '');
  const [showCc, setShowCc] = useState(!!(saved?.cc ?? defaultCc));
  const [showBcc, setShowBcc] = useState(!!saved?.bcc);
  const [subject, setSubject] = useState(saved?.subject ?? defaultSubject);
  const [body, setBody] = useState(saved?.body ?? initialBody);
  const [draftRestored] = useState(!!saved);
  const [files, setFiles] = useState([]); // { filename, mimeType, dataBase64, size }
  const [sending, setSending] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState(null);
  // Signature injects ONCE into a pristine body (never over a restored draft
  // or after the user typed).
  const signatureInjected = useRef(!!saved);
  const touched = useRef(false);

  useEffect(() => {
    api.email
      .accounts()
      .then((d) => {
        const connected = (d.accounts || []).filter((a) => a.connected && a.isActive);
        setAccounts(connected);
        setAccountId((cur) => cur || connected[0]?.id || null);
        const sig = connected[0]?.signature;
        if (sig && !signatureInjected.current) {
          signatureInjected.current = true;
          // Empty line for typing, then the signature, then any quoted history.
          setBody((cur) => (cur === initialBody ? `<p></p>${sig}${initialBody}` : cur));
        }
      })
      .catch(() => setAccounts([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the local draft while typing (debounced); only after a real edit.
  useEffect(() => {
    if (!draftKey || !touched.current) return undefined;
    const t = setTimeout(() => {
      const empty = !to.trim() && !subject.trim() && editorIsEmpty(body) && !cc.trim() && !bcc.trim();
      writeDraft(draftKey, empty ? null : { to, cc, bcc, subject, body });
    }, 400);
    return () => clearTimeout(t);
  }, [draftKey, to, cc, bcc, subject, body]);

  const touch = (setter) => (v) => {
    touched.current = true;
    setter(v);
  };
  const setToT = touch(setTo);
  const setCcT = touch(setCc);
  const setBccT = touch(setBcc);
  const setSubjectT = touch(setSubject);
  const setBodyT = touch(setBody);

  const dirty = !!(to.trim() || subject.trim() || files.length) && touched.current;
  useDirtyForm(dirty && !sending);

  async function addFiles(list) {
    setError(null);
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

  function clearDraftAnd(cb) {
    writeDraft(draftKey, null);
    cb?.();
  }

  async function send() {
    const toList = parseRecipients(to);
    if (!toList.length) return setError('נדרשת כתובת נמען תקינה');
    if (!replyToMessageId && !forwardOfMessageId && !subject.trim()) return setError('נדרש נושא');
    if (editorIsEmpty(body)) return setError('אין תוכן להודעה');
    setSending(true);
    setError(null);
    try {
      const result = await api.email.send({
        accountId,
        to: toList,
        cc: parseRecipients(cc),
        bcc: parseRecipients(bcc),
        subject: subject.trim(),
        bodyHtml: body,
        replyToMessageId,
        forwardOfMessageId,
        dealId,
        contactId,
        attachments: files.map(({ filename, mimeType, dataBase64 }) => ({ filename, mimeType, dataBase64 })),
      });
      clearDraftAnd(() => onSent?.(result));
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
    <div
      dir="rtl"
      className={`space-y-2 rounded-xl transition ${dragOver ? 'ring-2 ring-blue-400 ring-offset-2' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer?.files?.length) return;
        e.preventDefault();
        setDragOver(false);
        addFiles([...e.dataTransfer.files]);
      }}
    >
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
          onChange={(e) => setToT(e.target.value)}
          placeholder="אל: כתובת אימייל (מופרדות בפסיק)"
          dir="ltr"
          className={field}
        />
        <span className="flex shrink-0 gap-1.5 text-[12px] text-gray-400">
          {!showCc && (
            <button type="button" onClick={() => setShowCc(true)} className="hover:text-gray-600">עותק</button>
          )}
          {!showBcc && (
            <button type="button" onClick={() => setShowBcc(true)} className="hover:text-gray-600">עותק סמוי</button>
          )}
        </span>
      </div>
      {showCc && (
        <input value={cc} onChange={(e) => setCcT(e.target.value)} placeholder="עותק (Cc)" dir="ltr" className={field} />
      )}
      {showBcc && (
        <input value={bcc} onChange={(e) => setBccT(e.target.value)} placeholder="עותק סמוי (Bcc)" dir="ltr" className={field} />
      )}
      <input
        value={subject}
        onChange={(e) => setSubjectT(e.target.value)}
        placeholder={replyToMessageId || forwardOfMessageId ? 'נושא (ריק = Re:/Fwd: אוטומטי)' : 'נושא'}
        dir="auto"
        className={field}
      />
      <RichEditor
        preset="lite"
        value={body}
        onChange={setBodyT}
        placeholder="תוכן ההודעה…"
        maxHeight="45vh"
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
        <span className="flex items-center gap-2">
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
          <span className="text-[11px] text-gray-300">אפשר גם לגרור קבצים לכאן</span>
          {draftRestored && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200">
              ● טיוטה שוחזרה
            </span>
          )}
        </span>
        <div className="flex gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={() => clearDraftAnd(onCancel)}
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
