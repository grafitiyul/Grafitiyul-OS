import { useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { moduleForPath } from './modules.js';
import OrphanToursIndicator from './OrphanToursIndicator.jsx';
import BrandMark from '../brand/BrandMark.jsx';

export default function TopBar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const moduleLabel = moduleForPath(pathname)?.label || 'בית';
  const [busy, setBusy] = useState(false);

  async function handleLogout() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
      });
    } catch {
      /* still navigate — the server may have cleared anyway */
    }
    navigate('/admin/login', { replace: true });
  }

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center px-4 shrink-0 shadow-sm">
      <BrandMark className="h-8 w-auto" />
      <div className="hidden lg:flex items-center gap-3 ms-6 text-sm">
        <span className="text-gray-300">/</span>
        <span className="text-gray-700">{moduleLabel}</span>
      </div>
      <div className="flex-1" />
      {/* Permanent orphan-tours warning (renders nothing when none exist). */}
      <div className="me-3">
        <OrphanToursIndicator />
      </div>
      <button
        type="button"
        onClick={handleLogout}
        disabled={busy}
        className="text-[12px] text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded px-2 py-1 inline-flex items-center gap-1.5 disabled:opacity-50"
        aria-label="התנתק"
        title="התנתק"
      >
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
        <span>התנתק</span>
      </button>
    </header>
  );
}
