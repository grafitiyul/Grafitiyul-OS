import { useEffect, useState } from 'react';
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

export default function DealDrawer({ dealId, onClose }) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

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
        <Link
          to={`/admin/deals/${dealId}`}
          className="mr-auto text-[12px] font-medium text-blue-700 hover:underline"
        >
          פתיחה בעמוד מלא ↗
        </Link>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <DealDetail dealId={dealId} />
      </div>
    </div>
  );
}
