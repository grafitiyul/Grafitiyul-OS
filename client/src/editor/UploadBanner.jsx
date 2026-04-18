// Thin banner shown at the top of the editor widget while an upload is in
// progress, and as an error message if the upload failed. Controlled by
// RichEditor's uploadState.
export default function UploadBanner({ state, onDismiss, onCancel }) {
  if (!state || state.phase === 'idle') return null;

  if (state.phase === 'uploading') {
    const pct = typeof state.percent === 'number' ? state.percent : null;
    return (
      <div
        className="border-b border-blue-200 bg-blue-50 text-blue-900 px-3 py-2 text-[13px]"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-3">
          <span className="shrink-0">
            {state.label || 'מעלה…'}
            {pct != null ? ` · ${pct}%` : ''}
          </span>
          <div className="flex-1 h-1.5 rounded bg-blue-100 overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-[width] duration-150"
              style={{ width: pct == null ? '30%' : `${pct}%` }}
            />
          </div>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="shrink-0 text-[12px] text-blue-700 hover:text-blue-900 underline"
            >
              ביטול
            </button>
          )}
        </div>
      </div>
    );
  }

  if (state.phase === 'error') {
    return (
      <div
        className="border-b border-red-200 bg-red-50 text-red-800 px-3 py-2 text-[13px] flex items-start gap-2"
        role="alert"
      >
        <span className="shrink-0 font-medium">שגיאה:</span>
        <span className="flex-1 break-words">{state.error}</span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="סגירת הודעה"
          className="shrink-0 text-red-700 hover:text-red-900 px-2"
        >
          ×
        </button>
      </div>
    );
  }

  if (state.phase === 'success') {
    return (
      <div
        className="border-b border-green-200 bg-green-50 text-green-800 px-3 py-1.5 text-[12px] flex items-center gap-2"
        role="status"
      >
        <span>✓</span>
        <span>{state.label || 'הועלה'}</span>
      </div>
    );
  }

  return null;
}
