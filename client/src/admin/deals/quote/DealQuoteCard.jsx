import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../lib/api.js';
import ConfirmDialog from '../../common/ConfirmDialog.jsx';
import AnchoredMenu from '../../common/AnchoredMenu.jsx';
import GenerateQuoteModal from './GenerateQuoteModal.jsx';
import QuoteHistoryDialog from './QuoteHistoryDialog.jsx';

// The Deal's Quote card — the COMPLETE proposal workspace (business deals only).
// Everything proposal-related lives here: generate, versions, history, parallel
// offers, primary, permanent public links. Generated documents are immutable
// snapshots forever; the Deal's working draft carries wording forward.
//
// Offers = parallel commercial alternatives (tabs). The ACTIVE offer (the one
// the Builder prices and a new generation goes into) follows the selected tab —
// selecting a tab activates it server-side. Exactly one offer is PRIMARY (what
// a WON deal refers to).

const STATUS_LABELS = {
  produced: { text: 'הופקה', cls: 'bg-blue-50 text-blue-700 ring-blue-200' },
  accepted: { text: 'נחתמה', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  rejected: { text: 'נדחתה', cls: 'bg-red-50 text-red-600 ring-red-200' },
  expired: { text: 'פג תוקף', cls: 'bg-gray-100 text-gray-500 ring-gray-200' },
};

export function quoteStatusOf(doc) {
  if (!doc) return null;
  return doc.signedAt ? STATUS_LABELS.accepted : STATUS_LABELS[doc.status] || STATUS_LABELS.produced;
}

export function fmtQuoteDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const CopyIcon = (p) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="15" height="15" {...p}>
    <rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </svg>
);
const EyeIcon = (p) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="15" height="15" {...p}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />
  </svg>
);
const CheckIcon = (p) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15" {...p}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export default function DealQuoteCard({ deal, onDealChanged }) {
  const [data, setData] = useState(null); // { activeOfferId, offers }
  const [selectedOfferId, setSelectedOfferId] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [removeAsk, setRemoveAsk] = useState(null); // { offer, mode: 'delete'|'archive' }
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await api.deals.quoteDocuments(deal.id);
      setData(r);
      const live = (r.offers || []).filter((o) => !o.archivedAt);
      setSelectedOfferId((cur) => cur && live.some((o) => o.id === cur) ? cur : (r.activeOfferId || live[0]?.id || null));
    } catch {
      setData({ activeOfferId: null, offers: [] });
    }
  }, [deal.id]);

  useEffect(() => { load(); }, [load]);

  // The ⋮ menu renders through AnchoredMenu (portal) — it owns outside-click /
  // Escape closing, and escapes the right panel's overflow clipping.

  // Archived offers leave the workspace tabs; history still shows them.
  const allOffers = data?.offers || [];
  const offers = allOffers.filter((o) => !o.archivedAt);
  const selected = offers.find((o) => o.id === selectedOfferId) || offers[0] || null;
  const latest = selected?.documents?.[0] || null;
  const url = latest ? `${window.location.origin}/quote/${latest.publicToken}` : null;
  const status = quoteStatusOf(latest);
  const hasAnyDoc = allOffers.some((o) => o.documents.length > 0);
  const selectedHasSigned = (selected?.documents || []).some((d) => d.signedAt);

  // Selecting an offer tab also makes it ACTIVE (Builder + generation target).
  async function selectOffer(offerId) {
    if (offerId === selectedOfferId || busy) return;
    setSelectedOfferId(offerId);
    if (offerId !== data?.activeOfferId) {
      setBusy(true);
      try { await api.deals.activateQuoteOffer(deal.id, offerId); await load(); }
      finally { setBusy(false); }
    }
  }

  // ONE flow for parallel offers: create (seeded from the Deal, activated) →
  // straight into the generation screen, whose context bar IS where the offer's
  // commercial identity is defined. No separate editing dialog.
  async function openParallelCreate() {
    if (busy) return;
    setMenuOpen(false);
    setBusy(true);
    try {
      const r = await api.deals.createQuoteOffer(deal.id);
      await load();
      if (r?.offer?.id) setSelectedOfferId(r.offer.id);
      setModalOpen(true);
    } finally {
      setBusy(false);
    }
  }
  async function openOfferWorkspace(o) {
    setMenuOpen(false);
    await selectOffer(o.id); // activate → the generation screen targets it
    setModalOpen(true);
  }

  async function makePrimary() {
    if (!selected || busy) return;
    setMenuOpen(false);
    setBusy(true);
    try {
      await api.deals.setPrimaryQuoteOffer(deal.id, selected.id);
      await load();
      // Promotion ADOPTS the offer's context onto the Deal — the whole deal
      // page (Tour Details, price headline, changelog) must refresh now.
      onDealChanged?.();
    } finally {
      setBusy(false);
    }
  }

  async function removeSelected() {
    if (!removeAsk || busy) return;
    setBusy(true);
    try {
      await api.deals.removeQuoteOffer(deal.id, removeAsk.offer.id);
      setRemoveAsk(null);
      setSelectedOfferId(null);
      await load();
      // Removing the primary promotes a fallback offer → the Deal adopted its
      // context; refresh the deal page.
      if (removeAsk.offer.isPrimary) onDealChanged?.();
    } finally {
      setBusy(false);
    }
  }

  async function copyUrl() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* URL stays selectable in the field */ }
  }

  // The card renders its own panel shell (same look as DealDetail's panel Card)
  // so the offer tabs + ⋮ menu live IN the title row — no second header row.
  return (
    <section className="bg-white border border-gray-200 rounded-xl">
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 pt-3 pb-2.5">
        <h2 className="shrink-0 font-semibold text-gray-900 text-[13px]">הצעת מחיר</h2>
        {offers.length > 1 && (
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1">
            {offers.map((o) => (
              <button
                key={o.id}
                type="button"
                disabled={busy}
                onClick={() => selectOffer(o.id)}
                title={o.isPrimary ? 'ההצעה הראשית — משקפת את פרטי העסקה' : 'הצעה עצמאית — פרטים ותמחור משלה'}
                className={`inline-flex max-w-[220px] items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 transition disabled:opacity-50 ${
                  o.id === selected?.id
                    ? 'bg-gray-900 text-white ring-gray-900'
                    : 'bg-white text-gray-600 ring-gray-200 hover:bg-gray-50'
                }`}
              >
                <span className="truncate">
                  הצעה {o.offerNo}
                  {o.productNameHe ? ` · ${o.productNameHe}` : ''}
                </span>
                {o.isPrimary && (
                  <span className={`shrink-0 rounded-full px-1 text-[9px] font-bold ${o.id === selected?.id ? 'bg-white/20 text-white' : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'}`}>
                    ראשית
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
        <div className={`shrink-0 ${offers.length > 1 ? '' : 'ms-auto'}`}>
          <button
            ref={menuRef}
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            title="פעולות"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="rounded-lg px-1.5 py-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            ⋮
          </button>
          <AnchoredMenu anchorRef={menuRef} open={menuOpen} onClose={() => setMenuOpen(false)} width={240} align="start">
            <div className="text-right">
              <button type="button" onClick={openParallelCreate} disabled={busy}
                className="block w-full px-3 py-2 text-right text-[13px] text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                ＋ צור הצעה מקבילה
              </button>
              {selected && !selected.isPrimary && selected.contextMode === 'own' && (
                <button type="button" onClick={() => openOfferWorkspace(selected)} disabled={busy}
                  className="block w-full px-3 py-2 text-right text-[13px] text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                  ✎ ערוך פרטים ותמחור של הצעה זו
                </button>
              )}
              {selected && !selected.isPrimary && (
                <button type="button" onClick={makePrimary} disabled={busy}
                  title="העסקה תאמץ את המוצר, הפרטים והמחיר של הצעה זו"
                  className="block w-full px-3 py-2 text-right text-[13px] text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                  ★ הפוך לראשית
                </button>
              )}
              {selected && offers.length > 1 && (
                selectedHasSigned ? (
                  <div className="px-3 py-2 text-right text-[12px] text-gray-300" title="להצעה יש מסמך חתום — לא ניתן להסיר">
                    🗑 לא ניתן להסיר — יש מסמך חתום
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setMenuOpen(false);
                      setRemoveAsk({ offer: selected, mode: selected.documents.length ? 'archive' : 'delete' });
                    }}
                    className="block w-full px-3 py-2 text-right text-[13px] text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    {selected.documents.length ? '🗄 העבר הצעה זו לארכיון' : '🗑 מחק הצעה זו'}
                  </button>
                )
              )}
            </div>
          </AnchoredMenu>
        </div>
      </div>

      <div className="p-4">
      {!latest ? (
        <>
          <p className="mb-3 text-[12px] text-gray-500">
            {offers.length > 1 ? `להצעה ${selected?.offerNo} עדיין לא הופקה גרסה.` : 'הפקת מסמך הצעת מחיר ללקוח — תצוגה מקדימה, הפקה ושליחה.'}
          </p>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            📄 הפק הצעת מחיר
          </button>
          {hasAnyDoc && (
            <button type="button" onClick={() => setHistoryOpen(true)} className="ms-3 text-[12px] text-gray-400 hover:text-gray-600 hover:underline">
              היסטוריית הצעות
            </button>
          )}
        </>
      ) : (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${status.cls}`}>
              {status.text}
            </span>
            <span className="text-[12px] text-gray-500">גרסה {latest.versionNo ?? 1}</span>
            <span className="text-[12px] text-gray-400">·</span>
            <span className="text-[12px] text-gray-500">הופקה {fmtQuoteDate(latest.producedAt)}</span>
            <span className="text-[12px] text-gray-400">·</span>
            <span className="text-[12px] text-gray-500">{latest.language === 'en' ? 'English' : 'עברית'}</span>
          </div>
          <div className="flex items-center gap-1">
            <input
              readOnly
              dir="ltr"
              value={url}
              onFocus={(e) => e.target.select()}
              className="w-full min-w-0 flex-1 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-[12px] text-gray-600 focus:outline-none"
            />
            <button
              type="button"
              onClick={copyUrl}
              title="העתק קישור"
              aria-label="העתק קישור"
              className={`shrink-0 rounded-lg border border-gray-300 p-1.5 hover:bg-gray-50 ${copied ? 'text-emerald-600' : 'text-gray-600'}`}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              title="צפייה בהצעה"
              aria-label="צפייה בהצעה"
              className="shrink-0 rounded-lg border border-gray-300 p-1.5 text-gray-600 hover:bg-gray-50"
            >
              <EyeIcon />
            </a>
          </div>
          <div className="flex items-center gap-3 pt-0.5">
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50"
            >
              הפק גרסה חדשה
            </button>
            <button type="button" onClick={() => setHistoryOpen(true)} className="text-[12px] text-gray-400 hover:text-gray-600 hover:underline">
              היסטוריית הצעות
            </button>
          </div>
        </div>
      )}

      </div>

      {modalOpen && (
        <GenerateQuoteModal
          open
          onClose={() => { setModalOpen(false); load(); }}
          deal={deal}
          onGenerated={() => load()}
          onDealChanged={onDealChanged}
        />
      )}
      {historyOpen && (
        <QuoteHistoryDialog
          open
          onClose={() => setHistoryOpen(false)}
          offers={allOffers}
          dealId={deal.id}
          // Restoring can promote the offer to primary (Deal adopts its context).
          onChanged={async () => { await load(); onDealChanged?.(); }}
        />
      )}
      <ConfirmDialog
        open={!!removeAsk}
        danger
        title={removeAsk?.mode === 'archive' ? 'העברת הצעה לארכיון' : 'מחיקת הצעה'}
        body={removeAsk?.mode === 'archive'
          ? `להצעה ${removeAsk?.offer?.offerNo} יש גרסאות שהופקו, ולכן היא תועבר לארכיון ולא תימחק: היא תוסר מסביבת העבודה, אבל כל הגרסאות שהופקו יישארו נגישות בהיסטוריה ובקישורים הקבועים.`
          : `הצעה ${removeAsk?.offer?.offerNo} טרם הופקה — היא תימחק לצמיתות יחד עם התמחור והטיוטה שלה.`}
        confirmLabel={removeAsk?.mode === 'archive' ? 'העבר לארכיון' : 'מחק'}
        onCancel={() => setRemoveAsk(null)}
        onConfirm={removeSelected}
      />
    </section>
  );
}
