import { useEffect, useMemo, useRef, useState } from 'react';

// One dialog used by every export entry point (item, folder, flow).
//
// Caller passes:
//   target: { kind: 'content'|'question'|'folder'|'flow', id, label }
//
// "Single-item" mode (kind === 'content' or 'question') automatically
// disables the irrelevant include checkbox and the layout selector
// (page-per-item is meaningless for a single item).
//
// PDF flow (the slow path — server can take 20–30s on a large folder):
//   1. Open a new tab SYNCHRONOUSLY in the click handler and write a
//      Hebrew loading screen into it. Doing this synchronously is the
//      only reliable way to avoid the popup blocker — once an `await`
//      runs, the user-gesture credit is gone and `window.open` would
//      be blocked.
//   2. Fetch the print HTML from the server with an AbortController so
//      Cancel can actually stop the in-flight render.
//   3. When the response lands, replace the tab's content with the
//      rendered document. On error, write an error screen into the
//      tab (or close it on cancel) and surface the error in the
//      dialog so the user can retry.
//
// DOCX flow uses the same cancel-able fetch pattern; the file is
// blob-downloaded once the response arrives.

const KIND_NOUN = {
  content: 'פריט תוכן',
  question: 'שאלה',
  folder: 'תיקייה',
  flow: 'נוהל',
};

export default function ExportDialog({ open, target, onClose }) {
  const [includeContent, setIncludeContent] = useState(true);
  const [includeQuestions, setIncludeQuestions] = useState(true);
  const [format, setFormat] = useState('docx');
  const [pagination, setPagination] = useState('compact');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  // In-flight resources we may need to cancel: the fetch's abort
  // controller and any popup window we already opened. Refs (not
  // state) so the cancel handler always sees the latest value with
  // no stale-closure surprises.
  const abortRef = useRef(null);
  const popupRef = useRef(null);

  // Single-item exports: include filters and pagination are inherently
  // fixed. We force the relevant flag on, the irrelevant flag off, and
  // disable layout selection. The defaults below run on every open so
  // re-opening on a different target picks the right state.
  useEffect(() => {
    if (!open || !target) return;
    setErrorMsg(null);
    setBusy(false);
    abortRef.current = null;
    popupRef.current = null;
    if (target.kind === 'content') {
      setIncludeContent(true);
      setIncludeQuestions(false);
      setPagination('compact');
    } else if (target.kind === 'question') {
      setIncludeContent(false);
      setIncludeQuestions(true);
      setPagination('compact');
    } else {
      setIncludeContent(true);
      setIncludeQuestions(true);
      setPagination('compact');
    }
    setFormat('docx');
  }, [open, target]);

  // If the user closes the dialog mid-export, abort. Otherwise the
  // request keeps running and resolves into nothing.
  useEffect(() => {
    if (!open) cancelInFlight({ closePopup: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const isSingle =
    target?.kind === 'content' || target?.kind === 'question';

  const canSubmit = useMemo(() => {
    if (busy) return false;
    if (isSingle) return true;
    return includeContent || includeQuestions;
  }, [busy, isSingle, includeContent, includeQuestions]);

  if (!open || !target) return null;

  function buildUrl(action) {
    const qs = new URLSearchParams({
      content: includeContent ? '1' : '0',
      questions: includeQuestions ? '1' : '0',
      pagination,
    });
    return `/api/exports/${target.kind}/${encodeURIComponent(target.id)}/${action}?${qs.toString()}`;
  }

  function cancelInFlight({ closePopup = true } = {}) {
    if (abortRef.current) {
      try {
        abortRef.current.abort();
      } catch {
        /* ignore */
      }
      abortRef.current = null;
    }
    if (closePopup && popupRef.current) {
      try {
        if (!popupRef.current.closed) popupRef.current.close();
      } catch {
        /* cross-origin or already gone */
      }
    }
    popupRef.current = null;
  }

  // Click handler. Synchronous on purpose — the popup MUST be opened
  // here so the browser still treats it as user-initiated.
  function submit() {
    if (busy) return;
    setErrorMsg(null);

    if (format === 'pdf') {
      const w = openLoadingPopup(target.label);
      if (!w) {
        setErrorMsg(
          'הדפדפן חסם את פתיחת החלון החדש. אישרו פתיחת חלונות עבור האתר ונסו שוב.',
        );
        return;
      }
      popupRef.current = w;
      void runPdfFetch(w);
    } else {
      void runDocxFetch();
    }
  }

  async function runDocxFetch() {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    try {
      const res = await fetch(buildUrl('docx'), {
        cache: 'no-store',
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const dispo = res.headers.get('content-disposition') || '';
      const fallbackName = `${target.label || 'export'}.docx`;
      const filename = filenameFromDisposition(dispo) || fallbackName;
      triggerDownload(blob, filename);
      onClose?.();
    } catch (e) {
      if (e?.name !== 'AbortError') {
        setErrorMsg(humanError(e));
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  async function runPdfFetch(popup) {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    try {
      const res = await fetch(buildUrl('print'), {
        cache: 'no-store',
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      // The user may have closed the loading tab while the server was
      // working. In that case we drop the result silently — they
      // already opted out of seeing it.
      if (popup && !popup.closed) {
        popup.document.open();
        popup.document.write(html);
        popup.document.close();
      }
      popupRef.current = null;
      onClose?.();
    } catch (e) {
      if (e?.name === 'AbortError') {
        // Cancelled by the user. The popup is already closed by the
        // cancel handler; nothing else to do.
        return;
      }
      const msg = humanError(e);
      // Replace the loading tab's content with a matching error
      // screen so the user isn't left staring at an endless spinner.
      try {
        if (popup && !popup.closed) {
          popup.document.open();
          popup.document.write(buildErrorHtml(msg));
          popup.document.close();
        }
      } catch {
        /* cross-origin or torn down — ignore */
      }
      setErrorMsg(msg);
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  function handleDialogClose() {
    cancelInFlight({ closePopup: true });
    onClose?.();
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={handleDialogClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-lg shadow-xl w-full max-w-md flex flex-col"
        dir="rtl"
      >
        <div className="px-5 py-3 border-b border-gray-200 flex items-center">
          <h3 className="text-lg font-semibold text-gray-900 flex-1">
            ייצוא {KIND_NOUN[target.kind]}
          </h3>
          <button
            onClick={handleDialogClose}
            className="text-gray-500 hover:text-gray-800 text-xl"
            aria-label="סגור"
          >
            ×
          </button>
        </div>

        {target.label && (
          <div className="px-5 pt-3 pb-1 text-sm text-gray-600 truncate">
            {target.label}
          </div>
        )}

        <div className="px-5 py-3 space-y-4">
          <Section title="מה לכלול">
            <label
              className={`flex items-center gap-2 text-sm ${
                target.kind === 'question' ? 'text-gray-400' : ''
              }`}
            >
              <input
                type="checkbox"
                checked={includeContent}
                onChange={(e) => setIncludeContent(e.target.checked)}
                disabled={busy || target.kind === 'question'}
              />
              פריטי תוכן
            </label>
            <label
              className={`flex items-center gap-2 text-sm ${
                target.kind === 'content' ? 'text-gray-400' : ''
              }`}
            >
              <input
                type="checkbox"
                checked={includeQuestions}
                onChange={(e) => setIncludeQuestions(e.target.checked)}
                disabled={busy || target.kind === 'content'}
              />
              שאלות
            </label>
          </Section>

          <Section title="פורמט">
            <Radio
              name="format"
              value="docx"
              current={format}
              onChange={setFormat}
              label="Word (.docx) — להורדה"
              disabled={busy}
            />
            <Radio
              name="format"
              value="pdf"
              current={format}
              onChange={setFormat}
              label="PDF — תצוגה ידידותית להדפסה (תיפתח בחלון חדש)"
              disabled={busy}
            />
            {format === 'pdf' && !busy && (
              <div className="text-[11px] text-gray-500">
                לאחר הלחיצה ייפתח חלון חדש עם מסך טעינה. הקובץ יוכן בשרת
                ויופיע אוטומטית כשיהיה מוכן (זה יכול לקחת עד 30 שניות
                לתיקיות גדולות).
              </div>
            )}
          </Section>

          <Section title="פריסה">
            <Radio
              name="pagination"
              value="compact"
              current={pagination}
              onChange={setPagination}
              label="רציף (קומפקטי)"
              disabled={busy || isSingle}
            />
            <Radio
              name="pagination"
              value="page-per-item"
              current={pagination}
              onChange={setPagination}
              label="עמוד לכל פריט"
              disabled={busy || isSingle}
            />
            {isSingle && (
              <div className="text-[11px] text-gray-500">
                ייצוא של פריט בודד — אין משמעות לפריסה.
              </div>
            )}
          </Section>

          {busy && <BusyBanner format={format} />}

          {errorMsg && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
              {errorMsg}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 flex items-center gap-2">
          <div className="flex-1" />
          {busy ? (
            <button
              onClick={() => {
                cancelInFlight({ closePopup: true });
                setErrorMsg('הייצוא בוטל.');
                setBusy(false);
              }}
              className="px-4 py-1.5 text-sm border border-red-300 text-red-700 hover:bg-red-50 rounded-md font-medium"
            >
              עצור ייצוא
            </button>
          ) : (
            <>
              <button
                onClick={handleDialogClose}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-md"
              >
                ביטול
              </button>
              <button
                onClick={submit}
                disabled={!canSubmit}
                className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-md font-medium disabled:opacity-50"
              >
                {format === 'docx' ? 'הורד' : 'פתח להדפסה'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function BusyBanner({ format }) {
  const text =
    format === 'pdf' ? 'מכין קובץ PDF…' : 'מכין קובץ Word…';
  const sub =
    format === 'pdf'
      ? 'הקובץ ייפתח בחלון חדש כשיהיה מוכן.'
      : 'ההורדה תתחיל אוטומטית כשהקובץ יהיה מוכן.';
  return (
    <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded p-3">
      <Spinner />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-blue-900">{text}</div>
        <div className="text-[12px] text-blue-800/80 mt-0.5">
          {sub} ניתן לעצור באמצעות הכפתור למטה.
        </div>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block w-4 h-4 mt-0.5 border-2 border-blue-300 border-t-blue-700 rounded-full animate-spin"
      aria-hidden
    />
  );
}

function Section({ title, children }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-1">
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Radio({ name, value, current, onChange, label, disabled }) {
  return (
    <label
      className={`flex items-center gap-2 text-sm ${
        disabled ? 'text-gray-400' : ''
      }`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={current === value}
        onChange={() => onChange(value)}
        disabled={disabled}
      />
      {label}
    </label>
  );
}

function filenameFromDisposition(dispo) {
  if (!dispo) return null;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(dispo);
  if (star) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      /* fall through */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(dispo);
  return plain ? plain[1] : null;
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Defer revoke so Safari has a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function humanError(e) {
  if (!e) return 'הייצוא נכשל';
  if (e.name === 'TypeError') return 'תקלת רשת. בדקו את החיבור ונסו שוב.';
  return e.message || 'הייצוא נכשל';
}

// ── Popup loading screen ───────────────────────────────────────────
// The popup is opened from the click handler with a synchronous
// document.write so it never appears blank. Hebrew/RTL, simple
// CSS-only spinner, no external assets.

function openLoadingPopup(label) {
  let w;
  try {
    w = window.open('', '_blank', 'noopener=no,noreferrer=no');
  } catch {
    return null;
  }
  if (!w) return null;
  try {
    w.document.open();
    w.document.write(buildLoadingHtml(label));
    w.document.close();
  } catch {
    /* tab may have been closed instantly — caller handles it */
  }
  return w;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildLoadingHtml(label) {
  const safeLabel = escapeHtml(label || '');
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<title>מכין קובץ PDF…</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  html, body { margin: 0; padding: 0; height: 100%; }
  body {
    font-family: 'Arial', 'Segoe UI', sans-serif;
    background: #f8fafc;
    color: #111;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .card {
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    padding: 28px 32px;
    max-width: 440px;
    width: 100%;
    text-align: center;
    box-shadow: 0 1px 2px rgba(0,0,0,0.04);
  }
  .spinner {
    width: 48px;
    height: 48px;
    border: 4px solid #cfd8e3;
    border-top-color: #1d4ed8;
    border-radius: 50%;
    animation: spin 0.9s linear infinite;
    margin: 0 auto 16px;
  }
  h1 { font-size: 20px; margin: 0 0 6px 0; }
  .sub { color: #4b5563; font-size: 14px; line-height: 1.5; }
  .label { color: #6b7280; font-size: 12px; margin-top: 14px; word-break: break-word; }
  .hint { color: #6b7280; font-size: 12px; margin-top: 18px; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
  <div class="card">
    <div class="spinner" aria-hidden="true"></div>
    <h1>מכין קובץ PDF…</h1>
    <div class="sub">השרת מרכיב את המסמך. תיקיות גדולות יכולות לקחת עד כ-30 שניות.</div>
    ${safeLabel ? `<div class="label">${safeLabel}</div>` : ''}
    <div class="hint">בסיום, המסמך יחליף את המסך הזה אוטומטית. ניתן לסגור חלון זה בכל רגע.</div>
  </div>
</body>
</html>`;
}

function buildErrorHtml(message) {
  const safe = escapeHtml(message || 'הייצוא נכשל');
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<title>הייצוא נכשל</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; }
  body {
    font-family: 'Arial', 'Segoe UI', sans-serif;
    background: #fef2f2;
    color: #111;
    display: flex; align-items: center; justify-content: center;
    padding: 24px;
  }
  .card {
    background: #fff;
    border: 1px solid #fecaca;
    border-radius: 12px;
    padding: 28px 32px;
    max-width: 440px; width: 100%;
    text-align: center;
  }
  h1 { font-size: 20px; margin: 0 0 8px 0; color: #991b1b; }
  .msg { color: #7f1d1d; font-size: 14px; }
  .hint { color: #6b7280; font-size: 12px; margin-top: 18px; }
</style>
</head>
<body>
  <div class="card">
    <h1>הייצוא נכשל</h1>
    <div class="msg">${safe}</div>
    <div class="hint">סגרו חלון זה ונסו שוב. אם הבעיה חוזרת, פנו לתמיכה.</div>
  </div>
</body>
</html>`;
}
