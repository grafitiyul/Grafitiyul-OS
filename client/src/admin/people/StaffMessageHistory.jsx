import { useEffect, useState } from 'react';
import Dialog from '../common/Dialog.jsx';
import { WhatsAppPreviewBubble } from '../whatsapp/waPreview.jsx';
import { api } from '../../lib/api.js';

// "היסטוריית הודעות" — start from a message the team was already sent.
//
// Deliberately NOT a template library: nothing is saved, named, versioned or
// curated here. It is the record of what actually went out (WhatsAppSendBatch,
// which already freezes the authored HTML and its WhatsApp markup), offered as
// a starting point. Picking one loads it into the editor as an ordinary
// draft — chips intact, fully editable — and changes nothing until it is sent.
//
// Search runs server-side over the authored text, because after fifty sends an
// operator remembers a phrase, not a date.

function fmtWhen(iso) {
  try {
    return new Date(iso).toLocaleString('he-IL', {
      day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '';
  }
}

// One-line gist for the list: markup markers stripped, newlines flattened.
function snippet(text) {
  return String(text || '')
    .replace(/```([\s\S]*?)```/g, '$1')
    .replace(/([*_~])(\S(?:[\s\S]*?\S)?)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim();
}

export default function StaffMessageHistory({ open, onClose, onPick, accounts = [] }) {
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setError(null);
    const t = setTimeout(() => {
      api.whatsapp.staffSend
        .batches({ search: search.trim() || undefined, limit: 50 })
        .then((d) => !cancelled && setRows(Array.isArray(d) ? d : []))
        .catch((e) => !cancelled && setError(e?.payload?.error || e.message));
    }, search ? 300 : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, search]);

  // Re-opening should not show the previous search's results for an instant.
  useEffect(() => {
    if (!open) {
      setRows(null);
      setSearch('');
      setExpandedId(null);
    }
  }, [open]);

  const accountLabel = (id) => accounts.find((a) => a.id === id)?.label || id;

  return (
    <Dialog open={open} onClose={onClose} title="היסטוריית הודעות" size="xl" contentClassName="flex-1 overflow-y-auto p-4">
      <div dir="rtl" className="space-y-3">
        <p className="text-[12.5px] text-gray-500">
          הודעות קודמות שנשלחו לצוות, מהחדשה לישנה. בחירה טוענת את ההודעה לעורך — אפשר לערוך אותה לפני השליחה.
        </p>
        <input
          type="search"
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חיפוש בתוכן ההודעות…"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-[13.5px] focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
        />

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
            טעינת ההיסטוריה נכשלה: <span dir="ltr" className="font-mono">{error}</span>
          </div>
        )}

        {rows === null ? (
          <div className="py-10 text-center text-[13px] text-gray-400">טוען…</div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 px-6 py-10 text-center">
            <p className="text-[13.5px] font-medium text-gray-700">
              {search ? 'לא נמצאה הודעה מתאימה' : 'עדיין לא נשלחו הודעות לצוות'}
            </p>
            <p className="mt-1 text-[12.5px] text-gray-500">
              {search ? 'נסו מילה אחרת מתוך ההודעה.' : 'ההודעה הראשונה שתשלחו תופיע כאן.'}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map((b) => {
              const expanded = expandedId === b.id;
              const sent = b.counts?.sent || 0;
              return (
                <li key={b.id} className="rounded-xl border border-gray-200 bg-white">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-gray-100 px-3 py-1.5 text-[11.5px] text-gray-500">
                    <span dir="ltr">{fmtWhen(b.createdAt)}</span>
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-800 ring-1 ring-emerald-200">
                      {accountLabel(b.accountId)}
                    </span>
                    <span>{b.recipientCount} נמענים</span>
                    {sent > 0 && <span className="text-emerald-700">{sent} נשלחו</span>}
                    {b.attachments?.length > 0 && <span>📎 {b.attachments.length}</span>}
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : b.id)}
                      className="mr-auto font-medium text-gray-500 underline hover:text-gray-800"
                    >
                      {expanded ? 'הסתרה' : 'תצוגה מלאה'}
                    </button>
                  </div>
                  <div className="px-3 py-2">
                    {expanded ? (
                      <WhatsAppPreviewBubble markup={b.templateText} attachments={b.attachments} />
                    ) : (
                      <p className="line-clamp-2 text-[13px] leading-relaxed text-gray-800" dir="auto">
                        {snippet(b.templateText) || '(ללא טקסט)'}
                      </p>
                    )}
                    <div className="mt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={() => onPick?.(b)}
                        className="rounded-lg bg-emerald-600 px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:bg-emerald-700"
                      >
                        התחלה מהודעה זו
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
