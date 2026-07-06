import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import DealDetail from '../deals/DealDetail.jsx';

// The FULL deal workspace (same DealDetail component, embedded), opened from
// the WhatsApp inbox so the operator never loses their place in the queue.
//
// It is BOUNDED to the chat pane: the parent (<section>) is position:relative,
// so `absolute inset-0` makes the drawer cover exactly the chat area and stop
// at the conversation-list boundary — the list stays visible and usable on
// the right, with no dead gray space. Slides in from the left (RTL far side);
// ESC / × returns to the inbox.

// The canonical Deal URL — must match the router (App.jsx: /admin/crm/deals/:id)
// and DealDetail's own copy-URL action, one source of truth for both buttons.
function dealPath(dealId) {
  return `/admin/crm/deals/${dealId}`;
}

export default function DealDrawer({ dealId, onClose }) {
  const [entered, setEntered] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      clearTimeout(copyTimerRef.current);
    };
  }, [onClose]);

  async function copyDealUrl() {
    const url = `${window.location.origin}${dealPath(dealId)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API blocked (e.g. insecure context) — fall back to a prompt.
      window.prompt('העתיקו את הקישור לדיל:', url);
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
        <div className="mr-auto flex items-center gap-3">
          <button
            type="button"
            onClick={copyDealUrl}
            className="text-[12px] font-medium text-gray-500 hover:text-gray-800 hover:underline"
          >
            העתקת קישור לדיל
          </button>
          <Link
            to={dealPath(dealId)}
            className="text-[12px] font-medium text-blue-700 hover:underline"
          >
            פתיחה בעמוד מלא ↗
          </Link>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <DealDetail dealId={dealId} />
      </div>

      {/* Same transient confirmation DealDetail uses (no global toast infra yet). */}
      {copied && (
        <div className="fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white shadow-lg">
          הקישור הועתק ✓
        </div>
      )}
    </div>
  );
}
