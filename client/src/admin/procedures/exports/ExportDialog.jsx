import { useEffect, useMemo, useState } from 'react';

// One dialog used by every export entry point (item, folder, flow).
//
// Caller passes:
//   target: { kind: 'content'|'question'|'folder'|'flow', id, label }
//
// "Single-item" mode (kind === 'content' or 'question') automatically
// disables the irrelevant include checkbox and the layout selector
// (page-per-item is meaningless for a single item).
//
// Submit hits the server export endpoints directly:
//   GET /api/exports/:kind/:id/docx?content=…&questions=…&pagination=…
//   GET /api/exports/:kind/:id/print?…   (opened in a new tab)

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

  // Single-item exports: include filters and pagination are inherently
  // fixed. We force the relevant flag on, the irrelevant flag off, and
  // disable layout selection. The defaults below run on every open so
  // re-opening on a different target picks the right state.
  useEffect(() => {
    if (!open || !target) return;
    setErrorMsg(null);
    setBusy(false);
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

  async function submit() {
    setErrorMsg(null);
    setBusy(true);
    try {
      if (format === 'docx') {
        const url = buildUrl('docx');
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        // Filename: prefer the Content-Disposition the server set; fall
        // back to the target label so the file isn't named "(blob)".
        const dispo = res.headers.get('content-disposition') || '';
        const fallbackName = `${target.label || 'export'}.docx`;
        const filename = filenameFromDisposition(dispo) || fallbackName;
        triggerDownload(blob, filename);
        onClose?.();
      } else {
        // Print-friendly HTML opens in a new tab so the user keeps the
        // editor / list pane in place. The page itself self-handles
        // print → save-as-PDF.
        window.open(buildUrl('print'), '_blank', 'noopener,noreferrer');
        onClose?.();
      }
    } catch (e) {
      setErrorMsg(e.message || 'הייצוא נכשל');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
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
            onClick={onClose}
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
                disabled={target.kind === 'question'}
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
                disabled={target.kind === 'content'}
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
            />
            <Radio
              name="format"
              value="pdf"
              current={format}
              onChange={setFormat}
              label="PDF — תיפתח תצוגה ידידותית להדפסה"
            />
          </Section>

          <Section title="פריסה">
            <Radio
              name="pagination"
              value="compact"
              current={pagination}
              onChange={setPagination}
              label="רציף (קומפקטי)"
              disabled={isSingle}
            />
            <Radio
              name="pagination"
              value="page-per-item"
              current={pagination}
              onChange={setPagination}
              label="עמוד לכל פריט"
              disabled={isSingle}
            />
            {isSingle && (
              <div className="text-[11px] text-gray-500">
                ייצוא של פריט בודד — אין משמעות לפריסה.
              </div>
            )}
          </Section>

          {errorMsg && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
              {errorMsg}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 flex items-center gap-2">
          <div className="flex-1" />
          <button
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md disabled:opacity-50"
          >
            ביטול
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-md font-medium disabled:opacity-50"
          >
            {busy ? 'מייצא…' : format === 'docx' ? 'הורד' : 'פתח להדפסה'}
          </button>
        </div>
      </div>
    </div>
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
