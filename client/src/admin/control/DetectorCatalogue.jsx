import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

// "מה המערכת בודקת" — the answer to the question בקרה used to leave unanswered:
// what IS this bubble, why did it appear, and what makes it go away?
//
// The list is generated from the registered detectors themselves, so it can
// never drift: a detector without an explanation fails a guard test, and an
// explanation for a detector that no longer exists simply disappears with it.
//
// Collapsed by default — this is reference material, not the daily view.

export default function DetectorCatalogue() {
  const [open, setOpen] = useState(false);
  const [detectors, setDetectors] = useState(null);

  useEffect(() => {
    if (!open || detectors) return;
    api.control.detectors()
      .then((r) => setDetectors(r.detectors || []))
      .catch(() => setDetectors([]));
  }, [open, detectors]);

  return (
    <section className="mt-8 rounded-xl border border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-start"
      >
        <span>
          <span className="text-[14px] font-semibold text-gray-900">מה המערכת בודקת</span>
          <span className="ms-2 text-[12.5px] text-gray-500">
            {detectors ? `${detectors.length} בדיקות פעילות` : 'רשימת כל הבדיקות והסבר לכל אחת'}
          </span>
        </span>
        <span className="text-gray-400">{open ? '▲' : '▼'}</span>
      </button>

      {open ? (
        <div className="border-t border-gray-100 px-4 py-3">
          {detectors === null ? (
            <div className="py-4 text-center text-[13px] text-gray-400">טוען…</div>
          ) : detectors.length === 0 ? (
            <div className="py-4 text-center text-[13px] text-gray-400">לא נמצאו בדיקות רשומות</div>
          ) : (
            <ul className="space-y-3">
              {detectors.map((d) => (
                <li key={d.type} className="border-b border-gray-100 pb-3 last:border-0 last:pb-0">
                  <div className="text-[13.5px] font-medium text-gray-900">{d.labelHe}</div>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-gray-600">{d.purposeHe}</p>
                  {d.fixHe ? (
                    <p className="mt-0.5 text-[12px] text-gray-500">מתי נסגר: {d.fixHe}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
