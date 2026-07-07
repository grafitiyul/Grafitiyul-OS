// kind='accounting' timeline events — iCount documents + custom payment links.
// Three shapes share the renderer (data.event):
//   'icount_document'        — issued document (pinned into FOCUS by the server)
//   'icount_document_linked' — an existing iCount document manually linked to the deal
//   'custom_payment_link'    — a custom-description payment link was created
// System events: not editable, no comments; pinned rows expose unpin.

const fmtIls = (n) =>
  `₪${Number(n || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function fmtWhen(iso) {
  try {
    return new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '';
  }
}

const SOURCE_LABEL = {
  user: null, // shown via createdByName instead
  webhook: 'נוצר אוטומטית מתשלום/סליקה',
  custom_link: 'נוצר אוטומטית מקישור מותאם אישית',
};

export default function AccountingEventRow({ entry, dragHandle = null, onTogglePin = null }) {
  const d = entry.data || {};
  const isDoc = d.event === 'icount_document' || d.event === 'icount_document_linked';
  const isLinked = d.event === 'icount_document_linked';
  const who = entry.createdByName || entry.actorLabel || 'מערכת';
  const sourceNote = isLinked ? `שויך ידנית מאייקאונט ע״י ${who}` : SOURCE_LABEL[d.source] || null;

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2.5" dir="rtl">
      <div className="flex items-start gap-2">
        {dragHandle}
        <span className="mt-0.5 text-[18px]" aria-hidden>🧾</span>
        <div className="min-w-0 flex-1">
          {isDoc ? (
            <>
              <p className="text-[13.5px] font-semibold text-gray-900">
                {d.doctypeLabel || d.doctype}
                {d.docnum ? ` מס׳ ${d.docnum}` : ''}
                <span className="font-normal text-gray-600"> · {fmtIls(d.amountIls)}</span>
              </p>
              <p className="text-[12.5px] text-gray-600">
                {d.clientName}
                {d.basedOnDocnum && (
                  <span className="text-gray-500"> · על בסיס {d.basedOnDoctype && d.basedOnDocnum ? `מסמך ${d.basedOnDocnum}` : ''}</span>
                )}
              </p>
            </>
          ) : (
            <>
              <p className="text-[13.5px] font-semibold text-gray-900">
                קישור לתשלום מותאם אישית
                <span className="font-normal text-gray-600"> · {fmtIls(d.amountIls)}</span>
              </p>
              <p className="truncate text-[12.5px] text-gray-600" dir="auto">{d.description}</p>
            </>
          )}
          <p className="mt-0.5 text-[11.5px] text-gray-500">
            {fmtWhen(entry.createdAt)} · {sourceNote || `הופק ע״י ${who}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {(d.docUrl || d.url) && (
            <a href={d.docUrl || d.url} target="_blank" rel="noopener noreferrer"
              className="rounded-lg border border-emerald-300 bg-white px-2.5 py-1 text-[12px] font-medium text-emerald-800 hover:bg-emerald-50">
              {isDoc ? 'פתיחת המסמך' : 'פתיחת הקישור'}
            </a>
          )}
          {onTogglePin && (
            <button type="button" onClick={() => onTogglePin(entry)} title={entry.isPinned ? 'ביטול הצמדה' : 'הצמדה'}
              className={`rounded px-1.5 py-1 text-[13px] ${entry.isPinned ? 'text-amber-500' : 'text-gray-400 hover:text-gray-600'}`}>
              📌
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
