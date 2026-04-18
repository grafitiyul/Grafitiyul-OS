import { useEffect, useRef, useState } from 'react';
import { validateExternalVideoUrl } from './mediaUpload.js';

// Small modal for inserting a video by direct URL. Only accepts
// http(s) URLs that point to a playable video file. YouTube / Vimeo
// watch URLs are explicitly rejected with a clear message because they
// require an iframe embed, not a <video src> element.
export default function VideoUrlDialog({ open, onClose, onInsert }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setUrl('');
    setError('');
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  function insert() {
    const v = validateExternalVideoUrl(url);
    if (!v.ok) {
      setError(v.error);
      return;
    }
    onInsert(v.url);
    onClose();
  }

  function onKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      insert();
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="הוספת וידאו מ-URL"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        dir="rtl"
        className="bg-white w-full sm:max-w-md sm:rounded-lg shadow-xl overflow-hidden"
      >
        <div className="p-3 border-b border-gray-200 flex items-center gap-2">
          <div className="flex-1 font-semibold text-gray-900">
            הוספת וידאו מ-URL
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="סגירה"
            className="text-gray-500 hover:bg-gray-100 rounded px-2 py-1"
          >
            ×
          </button>
        </div>
        <div className="p-4 space-y-3">
          <label className="block">
            <span className="block text-sm font-medium text-gray-800 mb-1">
              כתובת קובץ הווידאו
            </span>
            <input
              ref={inputRef}
              type="url"
              dir="ltr"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (error) setError('');
              }}
              onKeyDown={onKey}
              placeholder="https://example.com/video.mp4"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
            />
          </label>
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-2">
              {error}
            </div>
          )}
          <div className="text-[11px] text-gray-500 leading-relaxed">
            נתמכים קישורים ישירים לקבצי וידאו (MP4, WebM, OGV). עדיין אין תמיכה
            בעמודי YouTube / Vimeo.
          </div>
        </div>
        <div className="p-3 border-t border-gray-200 flex items-center gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="text-sm border border-gray-300 rounded px-3 py-1.5 text-gray-700 hover:bg-gray-50"
          >
            ביטול
          </button>
          <button
            type="button"
            onClick={insert}
            disabled={!url.trim()}
            className="text-sm bg-blue-600 text-white rounded px-3 py-1.5 font-medium disabled:opacity-40"
          >
            הוספה
          </button>
        </div>
      </div>
    </div>
  );
}
