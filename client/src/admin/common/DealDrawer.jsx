import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import DealDetail from '../deals/DealDetail.jsx';
import { dealPath } from '../deals/config.js';
import AlertDialog from './AlertDialog.jsx';
import { formatDrawerPosition, navActionForKey } from './drawerNav.js';

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
// order without closing the drawer, plus `position` — { index, total }, where a
// null index means "this record is no longer in the filtered list" (see
// drawerNav.js). The caller owns the order, the anchor and the dirty-form
// guard; this component only renders the control and binds the keys. Callers
// that pass nothing (the two inboxes) behave exactly as before.
//
// Direction is an owner decision and must NOT be mirrored by RTL: the LEFT
// button is הקודם and the RIGHT button is הבא, physically, always. The control
// is therefore rendered dir="ltr" so DOM order IS the order on screen, and the
// keys follow the same physical sense (Alt+← previous, Alt+→ next, plus the
// original PgUp/PgDn and Alt+↑/↓).
//
// STARTOFFSET (optional, px): pushes the drawer's inline-START edge (right in
// RTL) away from the container edge, leaving that strip of the underlying list
// visible — record-navigation UX: the queue stays in sight while the detail is
// open. Logical property, so RTL/LTR both work; 0 (default) = the original
// full-pane cover, which is what the inboxes keep.

export default function DealDrawer({ dealId, onClose, onPrev, onNext, position, startOffset = 0 }) {
  const [entered, setEntered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState(null);
  const copyTimerRef = useRef(null);
  // Latch the handlers so the key listener can never go stale and callers are
  // not forced to memoize (same approach as tourEvents' useTourChanged).
  const navRef = useRef(null);
  navRef.current = { onPrev, onNext, onClose };
  // The control stays visible (with a disabled arrow) at the true beginning and
  // end of the queue — a control that vanishes at the edges reads as a bug.
  const showNav = !!position || !!onPrev || !!onNext;

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    function onKey(e) {
      const nav = navRef.current;
      if (e.key === 'Escape') { nav.onClose(); return; }
      // The queue keys never fire while a field has focus: paging inside a long
      // note must still page it, and Alt+↓ opens a native <select>. Text
      // editing is never interfered with.
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
      const action = navActionForKey(e);
      if (action === 'prev' && nav.onPrev) { e.preventDefault(); nav.onPrev(); }
      else if (action === 'next' && nav.onNext) { e.preventDefault(); nav.onNext(); }
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
      } ${startOffset > 0 ? 'border-s border-gray-300' : ''}`}
      // Inline style beats the class's `inset: 0` for this one edge; logical
      // property, so the preserved strip is on the correct side in RTL and LTR.
      style={startOffset > 0 ? { insetInlineStart: `${startOffset}px` } : undefined}
    >
      <div className="flex shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-4 py-2">
        <button
          type="button"
          onClick={onClose}
          // Closing is always an explicit operator action, from any of the three
          // consumers — so the label names the drawer, not one caller's inbox.
          aria-label="סגירת הדיל"
          title="סגירה (Esc)"
          className="flex h-8 w-8 items-center justify-center rounded-full text-xl text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          ×
        </button>
        <span className="text-[13px] font-semibold text-gray-700">דיל</span>
        {/* Queue navigation — only when the caller supplies an order.
            dir="ltr" pins the physical layout: [‹ הקודם] [counter] [הבא ›].
            `mx-auto` centres it in the free space, pushing the header actions
            to the far end. */}
        {showNav && (
          <div dir="ltr" className="mx-auto flex items-center gap-0.5 rounded-xl border border-gray-200 bg-gray-50 p-0.5">
            <NavArrow kind="prev" onClick={onPrev} disabled={!onPrev} />
            <span
              dir="rtl"
              // dir="rtl" on the counter is required, not decorative: inside an
              // LTR box "102 מתוך 115" would be read by a Hebrew reader as
              // "115 מתוך 102" — the exact reversal this redesign fixes.
              title={
                position?.index == null
                  ? 'הרשומה כבר לא תואמת את הסינון הנוכחי — הדיל נשאר פתוח עד לסגירה ידנית'
                  : undefined
              }
              className="min-w-[6.5rem] select-none px-1 text-center text-[12px] font-medium tabular-nums text-gray-600"
            >
              {formatDrawerPosition(position)}
            </span>
            <NavArrow kind="next" onClick={onNext} disabled={!onNext} />
          </div>
        )}
        <div className={`flex items-center gap-3 ${showNav ? '' : 'mr-auto'}`}>
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

// One arrow of the queue control. `kind` is the LOGICAL action; because the
// wrapper is dir="ltr", prev always renders on the left and next on the right,
// each pointing the way it moves — in RTL exactly as in LTR.
function NavArrow({ kind, onClick, disabled }) {
  const label = kind === 'prev' ? 'הקודם' : 'הבא';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={`${label} (${kind === 'prev' ? 'Alt+←' : 'Alt+→'})`}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition hover:bg-white hover:text-gray-900 hover:shadow-sm disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent disabled:hover:text-gray-300 disabled:hover:shadow-none"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d={kind === 'prev' ? 'M10 3 L5 8 L10 13' : 'M6 3 L11 8 L6 13'}
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
