import { useEffect, useRef, useState } from 'react';
import { useDirtyForm } from '../../lib/dirtyForms.js';

// THE canonical settings save-state bar — the four unmistakable states the
// product standard requires:
//   שינויים שלא נשמרו (amber, save button gets the red attention pulse)
//   שומר…            (busy)
//   ✓ נשמר           (emerald flash after a clean save)
//   שגיאה בשמירה     (red, persists until the next attempt)
// Dirty is DERIVED by the parent from actual form changes; this bar also
// registers it with the shared dirty-forms registry (blocks the version-gate
// auto-reload) and warns on tab close/refresh while dirty. In-app navigation
// blocking is NOT globally solvable under BrowserRouter (no useBlocker) — the
// beforeunload guard covers reload/close, matching the rest of GOS.
export default function SaveBar({ dirty, saving, error, onSave, label = 'שמור', className = '' }) {
  useDirtyForm(!!dirty);

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // "✓ נשמר" flash: fires on the saving→idle transition with no error left.
  const [saved, setSaved] = useState(false);
  const wasSaving = useRef(false);
  useEffect(() => {
    if (wasSaving.current && !saving && !error && !dirty) {
      setSaved(true);
      const t = setTimeout(() => setSaved(false), 2500);
      wasSaving.current = saving;
      return () => clearTimeout(t);
    }
    wasSaving.current = saving;
    return undefined;
  }, [saving, error, dirty]);

  const status = saving
    ? { text: 'שומר…', cls: 'text-gray-500' }
    : error
      ? { text: `שגיאה בשמירה: ${error}`, cls: 'text-red-600 font-medium' }
      : dirty
        ? { text: 'יש שינויים שלא נשמרו', cls: 'text-amber-600 font-medium' }
        : saved
          ? { text: '✓ נשמר', cls: 'text-emerald-600 font-medium' }
          : { text: 'הכול שמור', cls: 'text-gray-400' };

  return (
    <div className={`flex items-center justify-between gap-3 ${className}`} dir="rtl">
      <span className={`text-[12.5px] ${status.cls}`}>{status.text}</span>
      <button
        type="button"
        onClick={onSave}
        disabled={!dirty || saving}
        className={`h-10 rounded-lg px-5 text-sm font-medium text-white shadow-sm transition disabled:opacity-50 ${
          dirty && !saving
            ? 'bg-blue-600 hover:bg-blue-700 ring-4 ring-red-300/70 animate-pulse'
            : 'bg-blue-600 hover:bg-blue-700'
        }`}
      >
        {saving ? 'שומר…' : label}
      </button>
    </div>
  );
}
