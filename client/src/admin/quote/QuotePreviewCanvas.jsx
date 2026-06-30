import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import ReorderableList from '../common/ReorderableList.jsx';
import RichEditor from '../../editor/RichEditor.jsx';
import { QuoteBlock, TEAL } from '../../quote/QuoteBlockRenderer.jsx';
import PriceBuilderDialog from '../deals/PriceBuilderDialog.jsx';
import GroupTicketBuilderDialog from '../deals/GroupTicketBuilderDialog.jsx';
import { resolveFinanceWorkspace, FINANCE_WORKSPACE } from '../deals/config.js';

// Quote Preview Canvas — Phase 1 (premium document-first workspace).
//
// The Quote is the user's home: a wide, premium proposal they read, with controls
// summoned on hover. Editing routes to the EXISTING source editor (Builder as an
// overlay; other editors in a side tab + focus-refresh). Only quote-owned
// presentation (display name, personal intro, section show/hide/order) is edited
// inside the document. No produce/freeze, public page, PDF, or signature here.

const LABELS = {
  hero: 'כותרת', personal_intro: 'פתיח אישי', tour_details: 'פרטים טכניים',
  product_marketing: 'שיווק מוצר', why_grafitiyul: 'למה גרפיתיול', classification: 'תוכן לפי סוג ארגון',
  pricing: 'תמחור', payment_terms: 'תנאי תשלום', faq: 'שאלות נפוצות',
  cancellation: 'מדיניות ביטול', participant_policy: 'מדיניות משתתפים', signature: 'חתימה',
};

// Structural sections always render; content sections render only when populated,
// so the document tells a story instead of showing "title → empty area". Empty
// sections stay in the sections panel + ⚠ warnings, and reappear once filled at
// source. Presentation only — no composition change.
function hasContent(block) {
  const d = block.data || {};
  switch (block.type) {
    case 'hero':
    case 'personal_intro':
    case 'tour_details':
    case 'pricing':
    case 'payment_terms':
    case 'signature':
      return true;
    case 'product_marketing':
    case 'classification':
    case 'city_content':
      return !!(d.html && String(d.html).trim());
    default:
      return d.customHtml ? !!String(d.customHtml).trim() : Array.isArray(d.items) && d.items.length > 0;
  }
}

function PillBtn({ onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      className="rounded-md border border-gray-200 bg-white/95 px-2 py-1 text-[12px] text-gray-700 shadow-sm backdrop-blur hover:bg-gray-50">
      {children}
    </button>
  );
}

function SaveCancel({ onSave, onCancel, busy }) {
  return (
    <span className="flex items-center gap-2">
      <button type="button" onClick={onSave} disabled={busy}
        className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50" style={{ background: TEAL }}>שמור</button>
      <button type="button" onClick={onCancel} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">בטל</button>
    </span>
  );
}

function InfoBtn({ block }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="rounded-md border border-gray-200 bg-white/95 px-1.5 py-1 text-[12px] text-gray-500 shadow-sm hover:bg-gray-50">ⓘ</button>
      {open && (
        <div className="absolute top-7 right-0 z-20 w-56 rounded-lg border border-gray-200 bg-white p-3 text-[12.5px] shadow-lg">
          <div className="mb-1 font-semibold text-gray-700">מקור התוכן</div>
          <div className="text-gray-500">{block.source || '—'}</div>
          {block.overridden && <div className="mt-1" style={{ color: TEAL }}>✏ מותאם להצעה זו</div>}
          {block.editTarget && <div className="mt-2 text-gray-400">{block.editTarget.label}</div>}
        </div>
      )}
    </span>
  );
}

export default function QuotePreviewCanvas() {
  const { dealId } = useParams();
  const [docId, setDocId] = useState(null);
  const [doc, setDoc] = useState(null);
  const [model, setModel] = useState(null);
  const [deal, setDeal] = useState(null);
  const [activityTypes, setActivityTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null); // { key, mode:'intro'|'name', value }
  const [builderOpen, setBuilderOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [warnOpen, setWarnOpen] = useState(false);

  const loadModel = useCallback(async (id) => {
    const [d, m] = await Promise.all([api.quoteDocuments.get(id), api.quoteDocuments.composePreview(id)]);
    setDoc(d.quoteDocument);
    setModel(m);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setError(null);
      try {
        const [ens, dealRes, ats] = await Promise.all([
          api.deals.quoteDocument(dealId),
          api.deals.get(dealId),
          api.activityTypes.list().catch(() => []),
        ]);
        if (!alive) return;
        setDeal(dealRes);
        setActivityTypes(Array.isArray(ats) ? ats : ats?.activityTypes || []);
        const id = ens.quoteDocument.id;
        setDocId(id);
        await loadModel(id);
      } catch (e) {
        if (alive) setError(e?.payload?.error || e?.message || 'load_failed');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [dealId, loadModel]);

  useEffect(() => {
    function onFocus() { if (!editing && !builderOpen && docId) loadModel(docId).catch(() => {}); }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [editing, builderOpen, docId, loadModel]);

  const patchDoc = useCallback(async (patch) => {
    if (!docId) return;
    setBusy(true);
    try { await api.quoteDocuments.update(docId, patch); await loadModel(docId); }
    catch (e) { setError(e?.payload?.error || e?.message || 'save_failed'); }
    finally { setBusy(false); }
  }, [docId, loadModel]);

  const refresh = useCallback(async () => {
    if (!docId) return;
    setBusy(true);
    try { const [, dealRes] = await Promise.all([loadModel(docId), api.deals.get(dealId)]); setDeal(dealRes); }
    finally { setBusy(false); }
  }, [docId, dealId, loadModel]);

  const resetAll = useCallback(async () => {
    if (!docId) return;
    setBusy(true);
    try { await api.quoteDocuments.resetToSource(docId); await loadModel(docId); }
    finally { setBusy(false); }
  }, [docId, loadModel]);

  const priceContext = useMemo(() => {
    if (!deal) return null;
    const k = deal.activityType === 'group' ? 'public' : deal.activityType;
    return {
      productId: deal.productId || null,
      productVariantId: deal.productVariantId || null,
      activityTypeId: activityTypes.find((a) => a.key === k)?.id || null,
      organizationTypeId: deal.organizationTypeId || deal.organization?.organizationTypeId || null,
      organizationSubtypeId: deal.organizationSubtypeId || null,
      participantCount: deal.participants ?? 0,
    };
  }, [deal, activityTypes]);

  function routeFor(t) {
    switch (t?.kind) {
      case 'deal': return `/admin/crm/deals/${dealId}`;
      case 'product': return t.id ? `/admin/settings/crm/products/${t.id}` : '/admin/settings/crm/products';
      case 'location': return '/admin/settings/crm/locations';
      case 'orgType': return '/admin/settings/crm/organization-types';
      case 'quoteSections': return '/admin/settings/crm/quote-sections';
      case 'signers': return '/admin/documents/signers';
      default: return null;
    }
  }
  function onEdit(block) {
    const t = block.editTarget;
    if (block.type === 'personal_intro') return setEditing({ key: block.key, mode: 'intro', value: doc.personalIntro || '' });
    if (t?.dialog) return setBuilderOpen(true);
    const route = routeFor(t);
    if (route) window.open(route, '_blank', 'noopener');
  }
  function persistComposition(nextBlocks) {
    return patchDoc({ compositionDraft: { blocks: nextBlocks.map((b) => ({ key: b.key, hidden: !!b.hidden })) } });
  }
  function onReorder(ids) {
    const byKey = Object.fromEntries(model.blocks.map((b) => [b.key, b]));
    persistComposition(ids.map((k) => byKey[k]));
  }
  function toggleHidden(key) {
    persistComposition(model.blocks.map((b) => (b.key === key ? { ...b, hidden: !b.hidden } : b)));
  }
  function jumpTo(key) {
    setWarnOpen(false);
    document.getElementById(`sec-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  if (loading) return <div className="p-16 text-center text-gray-400">טוען הצעת מחיר…</div>;
  if (error) return <div className="p-16 text-center text-red-600">שגיאה: {error}</div>;
  if (!model) return null;

  const lang = model.language;
  const hero = model.blocks.find((b) => b.type === 'hero' && !b.hidden);
  const heroData = hero?.data || {};
  const customer = [heroData.customerName, heroData.organizationName].filter(Boolean).join(' · ');
  const body = model.blocks.filter((b) => !b.hidden && b.type !== 'hero' && hasContent(b));

  // Hover affordance shared by hero + body sections.
  function Controls({ block, onLight }) {
    if (previewMode) return null;
    const t = block.editTarget;
    return (
      <div className={`absolute -top-3 left-2 z-10 flex items-center gap-1 transition-opacity ${onLight ? 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
        {block.type === 'hero' && (
          <PillBtn onClick={() => setEditing({ key: block.key, mode: 'name', value: doc.displayProductName || '' })}>✎ שם לתצוגה</PillBtn>
        )}
        {t && (block.type === 'personal_intro' || t.kind !== 'quote') && <PillBtn onClick={() => onEdit(block)}>✎ {t.label}</PillBtn>}
        <InfoBtn block={block} />
      </div>
    );
  }

  function NameEditor({ block }) {
    return (
      <div className="absolute left-2 top-6 z-20 w-80 rounded-xl border border-gray-200 bg-white p-3 shadow-xl">
        <label className="mb-1 block text-[12px] text-gray-500">שם מוצר לתצוגה בהצעה</label>
        <input autoFocus value={editing.value} onChange={(e) => setEditing((s) => ({ ...s, value: e.target.value }))}
          placeholder={block.data?.productName || 'שם המוצר'} className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
        <div className="flex items-center justify-between">
          <SaveCancel busy={busy}
            onSave={async () => { await patchDoc({ displayProductName: editing.value || null }); setEditing(null); }}
            onCancel={() => setEditing(null)} />
          {model.displayProductNameOverridden && (
            <button type="button" onClick={async () => { await patchDoc({ displayProductName: null }); setEditing(null); }}
              className="text-[12px] hover:underline" style={{ color: TEAL }}>↺ למקור</button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="min-h-screen bg-gray-100">
      {/* slim top bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-gray-200 bg-white/85 px-4 py-2.5 backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
          <Link to={`/admin/crm/deals/${dealId}`} className="text-sm text-gray-500 hover:text-gray-900">← חזרה לעסקה</Link>
          <span className="truncate text-sm font-semibold text-gray-800">הצעת מחיר{customer ? ` · ${customer}` : ''}</span>
        </div>
        <div className="flex items-center gap-2">
          {busy && <span className="text-[12px] text-gray-400">שומר…</span>}
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[12px] text-gray-500">{lang === 'en' ? 'EN' : 'עברית'}</span>
          {model.warnings.length > 0 && (
            <div className="relative">
              <button type="button" onClick={() => setWarnOpen((o) => !o)}
                className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[13px] text-amber-700 hover:bg-amber-100">⚠ {model.warnings.length}</button>
              {warnOpen && (
                <div className="absolute left-0 top-10 z-40 w-72 rounded-xl border border-gray-200 bg-white p-3 text-right shadow-xl">
                  <div className="mb-1 text-sm font-semibold text-amber-700">תוכן חסר בשפת ההצעה</div>
                  <ul className="space-y-1 text-[13px]">
                    {model.warnings.map((w, i) => (
                      <li key={i}><button onClick={() => jumpTo(w.blockKey)} className="text-gray-600 hover:text-gray-900 hover:underline">{LABELS[w.blockKey] || w.blockKey} — חסר תוכן</button></li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          <button type="button" onClick={() => setPreviewMode((p) => !p)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">{previewMode ? 'יציאה מתצוגה' : '👁 תצוגה'}</button>
          {!previewMode && <button type="button" onClick={() => setPanelOpen(true)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">⋯ מקטעים</button>}
        </div>
      </div>

      {/* the document — wide, premium */}
      <div className="mx-auto w-full max-w-[1400px] px-3 py-6 lg:px-6 lg:py-8">
        <article className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-200/70">
          {/* full-bleed hero (no margin/rounding gap above the image) */}
          {hero && (
            <div id={`sec-${hero.key}`} className="group relative">
              <Controls block={hero} onLight />
              {editing?.key === hero.key && editing.mode === 'name' && <NameEditor block={hero} />}
              <QuoteBlock block={hero} lang={lang} />
            </div>
          )}

          {/* padded body — generous whitespace, RTL-first */}
          <div className="space-y-20 px-8 py-16 lg:px-24 lg:py-20">
            {body.map((block) => {
              const isIntroEdit = editing?.key === block.key && editing.mode === 'intro';
              return (
                <section key={block.key} id={`sec-${block.key}`} className="group relative">
                  <Controls block={block} />
                  {isIntroEdit ? (
                    <div>
                      <RichEditor value={editing.value} onChange={(html) => setEditing((s) => ({ ...s, value: html }))} ariaLabel="פתיח אישי" />
                      <div className="mt-2"><SaveCancel busy={busy}
                        onSave={async () => { await patchDoc({ personalIntro: editing.value || null }); setEditing(null); }}
                        onCancel={() => setEditing(null)} /></div>
                    </div>
                  ) : (
                    <QuoteBlock block={block} lang={lang} />
                  )}
                </section>
              );
            })}
          </div>
        </article>
        <p className="mt-6 text-center text-[12px] text-gray-400">טיוטה — התוכן נשאב מ-GOS. הפקה, עמוד ציבורי, חתימה ו-PDF בשלבים הבאים.</p>
      </div>

      {/* sections panel */}
      {panelOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setPanelOpen(false)}>
          <div className="absolute inset-0 bg-black/20" />
          <div className="absolute inset-y-0 left-0 flex w-80 flex-col bg-white p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-bold text-gray-800">מקטעי ההצעה</span>
              <button type="button" onClick={() => setPanelOpen(false)} className="text-gray-400 hover:text-gray-700">✕</button>
            </div>
            <div className="mb-3 flex gap-2">
              <button type="button" onClick={refresh} disabled={busy} className="flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-[13px] text-gray-700 hover:bg-gray-50 disabled:opacity-50">רענן מהמקור</button>
              <button type="button" onClick={resetAll} disabled={busy} className="flex-1 rounded-lg border border-red-200 px-2 py-1.5 text-[13px] text-red-600 hover:bg-red-50 disabled:opacity-50">אפס הכל</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ReorderableList
                items={model.blocks.map((b) => ({ id: b.key, block: b }))}
                onReorder={onReorder} emptyText="אין מקטעים"
                renderRow={({ block }, { handle }) => (
                  <div className={`flex items-center gap-2 rounded-lg border border-gray-200 px-2 py-1.5 ${block.hidden ? 'opacity-50' : ''}`}>
                    {handle}
                    <span className="flex-1 truncate text-[13px] text-gray-800">{LABELS[block.type] || block.key}</span>
                    {block.overridden && <span className="h-2 w-2 rounded-full" style={{ background: TEAL }} title="מותאם" />}
                    <button type="button" onClick={() => toggleHidden(block.key)} disabled={!block.removable}
                      className="rounded px-1.5 py-0.5 text-[12px] text-gray-600 hover:bg-gray-100 disabled:opacity-30">{block.hidden ? 'הצג' : 'הסתר'}</button>
                  </div>
                )}
              />
            </div>
          </div>
        </div>
      )}

      {/* Builder overlay */}
      {builderOpen && deal && (
        resolveFinanceWorkspace(deal) === FINANCE_WORKSPACE.TICKET_BUILDER ? (
          <GroupTicketBuilderDialog deal={deal} context={priceContext} open onClose={() => setBuilderOpen(false)} onSaved={() => { setBuilderOpen(false); refresh(); }} />
        ) : (
          <PriceBuilderDialog deal={deal} context={priceContext} open onClose={() => setBuilderOpen(false)} onSaved={() => { setBuilderOpen(false); refresh(); }} />
        )
      )}
    </div>
  );
}
