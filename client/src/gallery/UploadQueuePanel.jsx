import { useState } from 'react';
import { formatBytes } from './galleryFormat.js';
import { uploadErrorLabel } from './uploadErrors.js';

// Live view of the shared upload queue (lib/galleryUpload.js snapshots) —
// same component on desktop admin, guide portal and the customer page. The
// headline is the honest batch state ("83 מתוך 120 הועלו · 5 מעלים · 2
// נכשלו"); the expandable list gives per-file progress/retry/cancel. The
// panel renders nothing when the queue is empty.

const STATUS_LABELS = {
  preparing: 'מכין…',
  queued: 'ממתין',
  uploading: 'מעלה…',
  processing: 'מאמת…',
  done: 'הושלם',
  failed: 'נכשל',
  rejected: 'לא נתמך',
  canceled: 'בוטל',
};

function Bar({ value, failed }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200" dir="ltr">
      <div
        className={`h-full rounded-full transition-[width] duration-300 ${
          failed ? 'bg-red-400' : 'bg-blue-600'
        }`}
        style={{ width: `${Math.round((value || 0) * 100)}%` }}
      />
    </div>
  );
}

export default function UploadQueuePanel({ snapshot, uploader }) {
  const [open, setOpen] = useState(false);
  const { items, totals } = snapshot || { items: [], totals: { total: 0 } };
  if (!totals.total) return null;

  const inFlight =
    (totals.preparing || 0) + (totals.queued || 0) + (totals.uploading || 0) + (totals.processing || 0);
  const parts = [];
  parts.push(`${totals.done || 0} מתוך ${totals.total} הועלו`);
  if (totals.uploading || totals.processing) parts.push(`${(totals.uploading || 0) + (totals.processing || 0)} מעלים`);
  if (totals.queued) parts.push(`${totals.queued} ממתינים`);
  if (totals.failed) parts.push(`${totals.failed} נכשלו`);
  if (totals.rejected) parts.push(`${totals.rejected} לא נתמכים`);

  const overall = totals.bytesTotal > 0 ? totals.bytesSent / totals.bytesTotal : 0;
  const allDone = inFlight === 0;

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm" dir="rtl">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="block w-full px-3.5 py-2.5 text-right hover:bg-gray-50"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-gray-800">
            {allDone ? (
              totals.failed ? <span aria-hidden>⚠️</span> : <span aria-hidden>✅</span>
            ) : (
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" aria-hidden />
            )}
            <span className="truncate">{parts.join(' · ')}</span>
          </span>
          <span className="shrink-0 text-xs text-gray-400">{open ? '▾' : '▸'}</span>
        </div>
        {!allDone && (
          <div className="mt-2">
            <Bar value={overall} />
          </div>
        )}
      </button>

      {open && (
        <div className="max-h-64 overflow-y-auto border-t border-gray-100">
          {(totals.failed || 0) > 0 && (
            <div className="flex justify-end border-b border-gray-100 bg-red-50/50 px-3 py-1.5">
              <button
                type="button"
                onClick={() => uploader.retryFailed()}
                className="rounded-md px-2 py-1 text-[12px] font-semibold text-red-700 hover:bg-red-100"
              >
                ↻ נסה שוב את כל הכושלים
              </button>
            </div>
          )}
          {items.map((it) => (
            <div key={it.key} className="flex items-center gap-2.5 border-b border-gray-50 px-3 py-2 last:border-0">
              <span className="shrink-0 text-[15px]" aria-hidden>
                {it.kind === 'video' ? '🎬' : '🖼️'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[12.5px] text-gray-800">{it.name}</span>
                  <span className="shrink-0 text-[11px] text-gray-400" dir="ltr">
                    {formatBytes(it.size)}
                  </span>
                </div>
                {(it.status === 'uploading' || it.status === 'processing') && (
                  <div className="mt-1">
                    <Bar value={it.status === 'processing' ? 1 : it.progress} />
                  </div>
                )}
                {(it.status === 'failed' || it.status === 'rejected') && (
                  // Readable reason for the user; the raw code stays in the
                  // tooltip so QA can report the exact failure.
                  <div className="mt-0.5 text-[11px] text-red-600" title={it.error || ''}>
                    {uploadErrorLabel(it.error)}
                  </div>
                )}
              </div>
              <span
                className={`shrink-0 text-[11.5px] font-medium ${
                  it.status === 'done'
                    ? 'text-emerald-600'
                    : it.status === 'failed' || it.status === 'rejected'
                      ? 'text-red-600'
                      : 'text-gray-500'
                }`}
              >
                {STATUS_LABELS[it.status] || it.status}
              </span>
              {it.status === 'failed' && (
                <button
                  type="button"
                  onClick={() => uploader.retry(it.key)}
                  className="shrink-0 rounded-md px-1.5 py-0.5 text-[12px] font-semibold text-blue-700 hover:bg-blue-50"
                >
                  ↻
                </button>
              )}
              {['preparing', 'queued', 'uploading', 'processing'].includes(it.status) && (
                <button
                  type="button"
                  onClick={() => uploader.cancel(it.key)}
                  aria-label="ביטול"
                  className="shrink-0 rounded-md px-1.5 py-0.5 text-[12px] text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
