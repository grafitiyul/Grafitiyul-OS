import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import DealDetail from '../deals/DealDetail.jsx';
import { dealPath } from '../deals/config.js';
import AlertDialog from './AlertDialog.jsx';

// The FULL deal workspace (same DealDetail component, embedded), opened from a
// work queue so the operator never loses their place in it.
//
// SHARED by three modules — the WhatsApp inbox, the Email inbox, and the CRM
// Tasks workspace. It lived under whatsapp/ for historical reasons (its first
// caller); it moved here once Tasks became the third consumer.
//
// It is BOUNDED to its pane: the parent is position:relative, so `absolute
// inset-0` makes the drawer cover exactly that pane and stop at the list
// boundary — the queue stays visible and usable, with no dead gray space.
// Slides in from the left (RTL far side); ESC / × returns to the queue.
//
// The Deal URL comes from the shared dealPath (deals/config.js) — one source of
// truth with every other navigate/link/copy. Only the cuid is known here; the
// full page canonicalises the address bar to the מספר הזמנה form on load.
//
// PREV/NEXT (optional): pass onPrev/onNext to walk the CALLER's current list
// order without closing the drawer, plus `position` ("3 מתוך 47") for context.
// The caller owns the order and the dirty-form guard; this component only
// renders the controls and binds the keys. Callers that pass nothing (the two
// inboxes) behave exactly as before.

export default function DealDrawer({ dealId, onClose, onPrev, onNext, position }) {
  const [entered, setEntered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState(null);
  const copyTimerRef = useRef(null);
  // Latch the handlers so the key listener can never go stale and callers are
  // not forced to memoize (same approach as tourEvents' useTourChanged).
  const navRef = useRef(null);
  navRef.current = { onPrev, onNext, onClose };

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    function onKey(e) {
      const nav = navRef.current;
      if (e.key === 'Escape') { nav.onClose(); return; }
      // PgUp/PgDn walk the queue — but never while a field has focus, so
      // paging inside a long note still works.
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
      if (e.key === 'PageUp' && nav.onPrev) { e.preventDefault(); nav.onPrev(); }
      else if (e.key === 'PageDown' && nav.onNext) { e.preventDefault(); nav.onNext(); }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      clearTimeout(copyTimerRef.current);
    };
  }, []);

  async function copyDealUrl() {
    const url = `${window.location.origin}${dealPath({ id: dealId })}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API blocked (e.g. an insecure context) — show the URL so it
      // can be copied by hand. This used to be a native window.prompt, which
      // the project forbids; it only survived because this file lived outside
      // the nativeDialogs scan's scope until it moved here.
      setFallbackUrl(url);
    }
  }

  return (
    <div
      className={`absolute inset-0 z-[60] flex flex-col bg-gray-50 shadow-2xl transition-transform duration-300 ${
        entered ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <div className="flex shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-4 py-2">
        <button
          type="button"
          onClick={onClose}
          aria-label="סגירה וחזרה לתיבת השיחות"
          className="flex h-8 w-8 items-center justify-center rounded-full text-xl text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          ×
        </button>
        <span className="text-[13px] font-semibold text-gray-700">דיל</span>
        {/* Queue navigation — only when the caller supplies an order. */}
        {(onPrev || onNext) && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onPrev}
              disabled={!onPrev}
              aria-label="הקודם"
              title="הקודם (PageUp)"
              className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              ›
            </button>
            <button
              type="button"
              onClick={onNext}
              disabled={!onNext}
              aria-label="הבא"
              title="הבא (PageDown)"
              className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              ‹
            </button>
            {position && <span className="text-[11px] tabular-nums text-gray-400">{position}</span>}
          </div>
        )}
        <div className="mr-auto flex items-center gap-3">
          <button
            type="button"
            onClick={copyDealUrl}
            className="text-[12px] font-medium text-gray-500 hover:text-gray-800 hover:underline"
          >
            העתקת קישור לדיל
          </button>
          <Link
            to={dealPath({ id: dealId })}
            className="text-[12px] font-medium text-blue-700 hover:underline"
          >
            פתיחה בעמוד מלא ↗
          </Link>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {/* key: switching deals (work-queue follow) remounts the workspace so
            the new deal loads with completely fresh state — no stale buffers. */}
        <DealDetail key={dealId} dealId={dealId} />
      </div>

      {/* Same transient confirmation DealDetail uses (no global toast infra yet). */}
      {copied && (
        <div className="fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white shadow-lg">
          הקישור הועתק ✓
        </div>
      )}

      {/* Clipboard-blocked fallback — an in-system dialog, never window.prompt. */}
      <AlertDialog
        open={!!fallbackUrl}
        tone="notice"
        title="העתקת קישור לדיל"
        closeLabel="סגירה"
        onClose={() => setFallbackUrl(null)}
        body={
          <div className="space-y-2">
            <p className="text-sm text-gray-600">לא ניתן להעתיק אוטומטית בדפדפן הזה. אפשר להעתיק את הקישור ידנית:</p>
            <input
              readOnly
              dir="ltr"
              value={fallbackUrl || ''}
              onFocus={(e) => e.target.select()}
              className="w-full rounded border border-gray-300 bg-gray-50 px-2 py-1.5 text-[12px] text-gray-800"
            />
          </div>
        }
      />
    </div>
  );
}
