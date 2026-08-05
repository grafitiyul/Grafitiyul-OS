import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import Dialog from '../common/Dialog.jsx';
import CreateDealModal from './CreateDealModal.jsx';
import { dealPath } from './config.js';
import { sameContactActionState, chooserRow } from './sameContactNewDeal.js';

// "פתח דיל חדש לאותו איש קשר" — the Deal-header entry into the ONE canonical
// CreateDealModal (the same dialog the Deals list, the Contact page and the
// global search use). Nothing here creates anything by itself:
//   - one linked contact  → the canonical modal opens directly in preset mode
//   - several             → a small chooser dialog first, then the same modal
//   - none                → unreachable (the menu item is disabled with a reason)
// The FULL contact is fetched before opening the modal — the deal payload's
// contact rows carry no orgLinks, and the preset needs them so the contact's
// primary organization preselects exactly like on the Contact page.
// The new deal is a plain create: OPEN, no payment/accounting/collection or
// WON/LOST history — only the contact (and its org) context is prefilled.
export default function SameContactNewDealFlow({ deal, open, onClose }) {
  const navigate = useNavigate();
  const [preset, setPreset] = useState(null);
  const [loadingId, setLoadingId] = useState(null);
  // Invalidates in-flight contact fetches when the flow closes mid-load.
  const loadSeq = useRef(0);

  const { mode, rows } = sameContactActionState(deal);

  async function pick(contactId) {
    if (loadingId) return; // double-click on a chooser row must not double-fetch
    const seq = ++loadSeq.current;
    setLoadingId(contactId);
    try {
      const full = await api.contacts.get(contactId);
      if (seq !== loadSeq.current) return;
      setPreset(full);
      setLoadingId(null);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setLoadingId(null);
      alert('שגיאה בטעינת איש הקשר: ' + (e.payload?.error || e.message));
      onClose?.();
    }
  }

  // Opening with a single linked contact skips the chooser and loads it
  // immediately; closing resets everything so a cancelled flow leaves nothing.
  useEffect(() => {
    if (!open) {
      loadSeq.current += 1;
      setPreset(null);
      setLoadingId(null);
      return;
    }
    if (mode === 'direct') pick(rows[0].contactId);
    // 'choose' waits for the operator's pick; 'none' never reaches here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  if (preset) {
    return (
      <CreateDealModal
        presetContact={preset}
        onClose={onClose}
        onCreated={(created) => {
          onClose?.();
          navigate(dealPath(created));
        }}
      />
    );
  }

  // Direct mode renders nothing while the contact loads — the modal appears
  // the moment the fetch lands (or the flow closes with an error alert).
  if (mode !== 'choose') return null;

  return (
    <Dialog
      open
      onClose={onClose}
      title="דיל חדש — בחירת איש קשר"
      size="md-wide"
      footer={
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-gray-600 border border-gray-300 rounded-md px-4 py-1.5 hover:bg-gray-50"
        >
          ביטול
        </button>
      }
    >
      <div className="space-y-2">
        <p className="text-[12px] text-gray-500">
          לדיל הזה מקושרים כמה אנשי קשר — לְמי לפתוח את הדיל החדש?
        </p>
        <ul className="space-y-2">
          {rows.map((dc) => {
            const r = chooserRow(dc);
            const line = [r.phone, r.email].filter(Boolean);
            return (
              <li key={dc.id}>
                <button
                  type="button"
                  onClick={() => pick(r.contactId)}
                  disabled={!!loadingId}
                  className="w-full rounded-xl border border-gray-200 px-3.5 py-3 text-right hover:border-blue-300 hover:bg-blue-50/50 disabled:opacity-60 transition"
                >
                  <span className="flex items-center gap-2">
                    {r.isPrimary && (
                      <span className="text-amber-500" title="איש קשר ראשי">★</span>
                    )}
                    <span className="font-semibold text-gray-900">{r.name}</span>
                    {r.isPrimary && (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700 ring-1 ring-inset ring-amber-200">
                        ראשי
                      </span>
                    )}
                    <span className="flex-1" />
                    {loadingId === r.contactId && (
                      <span className="text-[12px] text-gray-400">טוען…</span>
                    )}
                  </span>
                  {line.length > 0 && (
                    <span className="mt-1 block text-[12px] text-gray-500" dir="ltr">
                      {line.join(' · ')}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Dialog>
  );
}
