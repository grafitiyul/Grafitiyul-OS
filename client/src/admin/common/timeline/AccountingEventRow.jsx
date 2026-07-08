import { useRef, useState } from 'react';
import AnchoredMenu from '../AnchoredMenu.jsx';

// kind='accounting' timeline events. Shapes (data.event):
//   'icount_document'        — issued document (pinned into FOCUS by the server)
//   'icount_document_linked' — an existing iCount document manually linked
//   'custom_payment_link'    — a custom-description payment link was created
//   'cardcom_link' / 'cardcom_link_updated' / 'cardcom_link_canceled'
//                            — Cardcom tourist payment link lifecycle
//   'cardcom_payment'        — a Cardcom tourist payment cleared (pinned)
//   'cardcom_doc_pending'    — payment cleared but the iCount doc needs manual issue
// Document rows expose a 3-dot menu (פתיחת מסמך / שלח ללקוח); system events are
// not editable and have no comments.

function fmtMoney(n, currency) {
  const cur = currency || 'ILS';
  try {
    return new Intl.NumberFormat('he-IL', { style: 'currency', currency: cur, minimumFractionDigits: 2 }).format(Number(n || 0));
  } catch {
    return `${cur} ${Number(n || 0).toFixed(2)}`;
  }
}

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
  cardcom: 'נוצר אוטומטית מתשלום כרטיס תייר (קארדקום)',
};

// Shell keeps every accounting event visually consistent (icon + body + right slot).
function Shell({ tone = 'emerald', icon = '🧾', dragHandle, children, right, footer }) {
  const toneCls = {
    emerald: 'border-emerald-200 bg-emerald-50/60',
    amber: 'border-amber-300 bg-amber-50',
    gray: 'border-gray-200 bg-gray-50',
  }[tone];
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${toneCls}`} dir="rtl">
      <div className="flex items-start gap-2">
        {dragHandle}
        <span className="mt-0.5 text-[18px]" aria-hidden>{icon}</span>
        <div className="min-w-0 flex-1">
          {children}
          {footer}
        </div>
        {right && <div className="flex shrink-0 items-center gap-1.5">{right}</div>}
      </div>
    </div>
  );
}

export default function AccountingEventRow({ entry, dragHandle = null, onTogglePin = null, onSendDocument = null }) {
  const d = entry.data || {};
  const who = entry.createdByName || entry.actorLabel || 'מערכת';
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  const pinBtn = onTogglePin ? (
    <button type="button" onClick={() => onTogglePin(entry)} title={entry.isPinned ? 'ביטול הצמדה' : 'הצמדה'}
      className={`rounded px-1.5 py-1 text-[13px] ${entry.isPinned ? 'text-amber-500' : 'text-gray-400 hover:text-gray-600'}`}>
      📌
    </button>
  ) : null;

  const stamp = (note) => (
    <p className="mt-0.5 text-[11.5px] text-gray-500">{fmtWhen(entry.createdAt)}{note ? ` · ${note}` : ''}</p>
  );

  // ── iCount documents (issued / linked) — 3-dot actions menu ────────────────
  if (d.event === 'icount_document' || d.event === 'icount_document_linked') {
    const isLinked = d.event === 'icount_document_linked';
    const sourceNote = isLinked ? `שויך ידנית מאייקאונט ע״י ${who}` : SOURCE_LABEL[d.source] || `הופק ע״י ${who}`;
    const canSend = !!onSendDocument && !!d.docnum;
    const menu = (d.docUrl || canSend) ? (
      <>
        <button ref={menuRef} type="button" onClick={() => setMenuOpen((o) => !o)} aria-haspopup="menu" aria-expanded={menuOpen} aria-label="פעולות"
          className="h-7 w-7 inline-flex items-center justify-center rounded-md text-[15px] leading-none text-emerald-700 hover:bg-emerald-100">
          ⋮
        </button>
        <AnchoredMenu anchorRef={menuRef} open={menuOpen} onClose={() => setMenuOpen(false)} width={160}>
          {d.docUrl && (
            <a href={d.docUrl} target="_blank" rel="noopener noreferrer" onClick={() => setMenuOpen(false)}
              className="block w-full text-right px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
              פתיחת מסמך
            </a>
          )}
          {canSend && (
            <button type="button" onClick={() => { setMenuOpen(false); onSendDocument(entry); }}
              className="block w-full text-right px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
              שלח ללקוח
            </button>
          )}
        </AnchoredMenu>
      </>
    ) : null;
    return (
      <Shell dragHandle={dragHandle} right={<>{menu}{pinBtn}</>}>
        <p className="text-[13.5px] font-semibold text-gray-900">
          {d.doctypeLabel || d.doctype}{d.docnum ? ` מס׳ ${d.docnum}` : ''}
          <span className="font-normal text-gray-600"> · {fmtMoney(d.amountIls, d.currency)}</span>
        </p>
        <p className="text-[12.5px] text-gray-600">
          {d.clientName}
          {d.basedOnDocnum && <span className="text-gray-500"> · על בסיס מסמך {d.basedOnDocnum}</span>}
        </p>
        {stamp(sourceNote)}
      </Shell>
    );
  }

  // ── Custom payment link created ────────────────────────────────────────────
  if (d.event === 'custom_payment_link') {
    return (
      <Shell dragHandle={dragHandle} right={<>
        {(d.url) && (
          <a href={d.url} target="_blank" rel="noopener noreferrer"
            className="rounded-lg border border-emerald-300 bg-white px-2.5 py-1 text-[12px] font-medium text-emerald-800 hover:bg-emerald-50">
            פתיחת הקישור
          </a>
        )}
        {pinBtn}
      </>}>
        <p className="text-[13.5px] font-semibold text-gray-900">
          קישור לתשלום מותאם אישית<span className="font-normal text-gray-600"> · {fmtMoney(d.amountIls, d.currency)}</span>
        </p>
        <p className="truncate text-[12.5px] text-gray-600" dir="auto">{d.description}</p>
        {stamp(`הופק ע״י ${who}`)}
      </Shell>
    );
  }

  // ── Cardcom tourist payment CLEARED (pinned) ───────────────────────────────
  if (d.event === 'cardcom_payment') {
    return (
      <Shell dragHandle={dragHandle} icon="💳" right={pinBtn}>
        <p className="text-[13.5px] font-semibold text-emerald-800">
          ✓ תשלום כרטיס תייר התקבל (קארדקום)<span className="font-normal text-gray-600"> · {fmtMoney(d.amountIls, d.currency)}</span>
        </p>
        <p className="truncate text-[12.5px] text-gray-600" dir="auto">
          {d.productDescriptionEn}
          {d.cardLast4 ? ` · •••• ${d.cardLast4}` : ''}
          {d.transactionId ? ` · אסמכתא ${d.transactionId}` : ''}
        </p>
        {stamp('אומת מול קארדקום')}
      </Shell>
    );
  }

  // ── Cardcom accounting-document PENDING (payment succeeded, issue manually) ─
  if (d.event === 'cardcom_doc_pending') {
    return (
      <Shell dragHandle={dragHandle} tone="amber" icon="⚠️" right={pinBtn}>
        <p className="text-[13.5px] font-semibold text-amber-800">{d.message || 'תשלום התקבל בקארדקום — נדרשת הפקת מסמך ידנית'}</p>
        {stamp(null)}
      </Shell>
    );
  }

  // ── Cardcom tourist link lifecycle (created / updated / canceled) ──────────
  if (d.event === 'cardcom_link' || d.event === 'cardcom_link_updated' || d.event === 'cardcom_link_canceled') {
    const canceled = d.event === 'cardcom_link_canceled';
    const title = canceled
      ? 'קישור לתשלום כרטיס תייר בוטל'
      : d.event === 'cardcom_link_updated'
        ? 'קישור לתשלום כרטיס תייר עודכן'
        : 'נוצר קישור לתשלום כרטיס תייר';
    return (
      <Shell dragHandle={dragHandle} tone={canceled ? 'gray' : 'emerald'} icon="💳" right={pinBtn}>
        <p className="text-[13.5px] font-semibold text-gray-900">
          {title}<span className="font-normal text-gray-600"> · {fmtMoney(d.amountIls, d.currency)}</span>
        </p>
        {d.productDescriptionEn && <p className="truncate text-[12.5px] text-gray-600" dir="auto">{d.productDescriptionEn}</p>}
        {stamp(`ע״י ${who}`)}
      </Shell>
    );
  }

  // Unknown accounting shape — minimal, never crash.
  return (
    <Shell dragHandle={dragHandle} right={pinBtn}>
      <p className="text-[13px] text-gray-700">{d.event || 'אירוע חשבונאי'}</p>
      {stamp(`ע״י ${who}`)}
    </Shell>
  );
}
