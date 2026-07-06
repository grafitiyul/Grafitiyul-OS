import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import DealDetail from '../deals/DealDetail.jsx';

// Large slide-in drawer hosting the FULL deal workspace (same DealDetail
// component, embedded) — the WhatsApp inbox opens deals here so the operator
// never loses their place in the conversation queue. Slides in from the left
// (RTL: the far side), ~75% of the screen; the inbox stays behind the
// backdrop. ESC / backdrop / × closes and returns to the inbox instantly.

export default function DealDrawer({ dealId, onClose }) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    // Lock body scroll while the drawer is open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[90]">
      <div
        className={`absolute inset-0 bg-black/35 transition-opacity duration-300 ${entered ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <div
        className={`absolute inset-y-0 left-0 flex w-[75vw] min-w-[320px] max-w-[1500px] flex-col bg-gray-50 shadow-2xl transition-transform duration-300 ${
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
        <div className="min-h-0 flex-1">
          <DealDetail dealId={dealId} />
        </div>
      </div>
    </div>
  );
}
