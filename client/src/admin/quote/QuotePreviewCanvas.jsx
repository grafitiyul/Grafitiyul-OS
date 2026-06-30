import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import ReorderableList from '../common/ReorderableList.jsx';
import RichEditor from '../../editor/RichEditor.jsx';
import { QuoteBlock } from '../../quote/QuoteBlockRenderer.jsx';

// Quote Preview Canvas — Slice 3.
//
// The internal admin workspace for a DRAFT quote, BEFORE Produce. It renders the
// composed preview model through the SAME shared renderer (QuoteBlock) that will
// later power the public page + PDF, and wraps each block with admin controls
// (hide/show, reorder, edit, reset, source). Pricing is read-only here — its data
// is edited only in the Builder (single source of commercial data).
//
// NOT in this slice: public page, token route, PDF, signature, acceptance,
// delivery, finance, Produce/Freeze.

const BLOCK_LABELS = {
  hero: 'כותרת',
  personal_intro: 'פתיח אישי',
  tour_details: 'פרטי הסיור',
  product_marketing: 'שיווק מוצר',
  why_grafitiyul: 'למה גרפיתיול',
  classification: 'תוכן לפי סוג ארגון',
  pricing: 'תמחור',
  payment_terms: 'תנאי תשלום',
  faq: 'שאלות נפוצות',
  cancellation: 'מדיניות ביטול',
  participant_policy: 'מדיניות משתתפים',
  signature: 'חתימה / אישור',
};

// Blocks whose body is editable as rich content in the preview (whole-body
// override). Pricing/hero/tour_details/payment/signature are NOT here.
const EDITABLE_CONTENT = new Set([
  'product_marketing',
  'classification',
  'why_grafitiyul',
  'faq',
  'cancellation',
  'participant_policy',
]);

// Current HTML to seed the editor for a content block (override or source).
function blockHtml(block) {
  const d = block.data || {};
  if (d.customHtml != null) return d.customHtml;
  if (d.html != null) return d.html;
  if (Array.isArray(d.items)) return d.items.map((i) => i.html || '').filter(Boolean).join('\n');
  return '';
}

function Chip({ children, tone = 'amber' }) {
  const tones = {
    amber: 'bg-amber-100 text-amber-800',
    gray: 'bg-gray-100 text-gray-600',
    blue: 'bg-blue-100 text-blue-700',
  };
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] ${tones[tone]}`}>{children}</span>;
}

export default function QuotePreviewCanvas() {
  const { dealId } = useParams();
  const navigate = useNavigate();
  const [docId, setDocId] = useState(null);
  const [doc, setDoc] = useState(null);
  const [model, setModel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // { key, type, html }
  const [nameDraft, setNameDraft] = useState('');

  const loadModel = useCallback(async (id) => {
    const [d, m] = await Promise.all([api.quoteDocuments.get(id), api.quoteDocuments.composePreview(id)]);
    setDoc(d.quoteDocument);
    setNameDraft(d.quoteDocument.displayProductName || '');
    setModel(m);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const ens = await api.deals.quoteDocument(dealId); // ensure draft exists
        if (!alive) return;
        const id = ens.quoteDocument.id;
        setDocId(id);
        await loadModel(id);
      } catch (e) {
        if (alive) setError(e?.payload?.error || e?.message || 'load_failed');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [dealId, loadModel]);

  const patchDoc = useCallback(
    async (patch) => {
      if (!docId) return;
      setBusy(true);
      try {
        await api.quoteDocuments.update(docId, patch);
        await loadModel(docId);
      } catch (e) {
        setError(e?.payload?.error || e?.message || 'save_failed');
      } finally {
        setBusy(false);
      }
    },
    [docId, loadModel],
  );

  const refresh = useCallback(async () => {
    if (!docId) return;
    setBusy(true);
    try {
      await loadModel(docId); // re-pulls source for non-overridden fields; keeps overrides
    } finally {
      setBusy(false);
    }
  }, [docId, loadModel]);

  const resetAll = useCallback(async () => {
    if (!docId) return;
    setBusy(true);
    try {
      await api.quoteDocuments.resetToSource(docId);
      await loadModel(docId);
    } finally {
      setBusy(false);
    }
  }, [docId, loadModel]);

  // Persist order/hidden from the current model + a single mutation.
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

  function startEdit(block) {
    if (block.type === 'personal_intro') setEditing({ key: block.key, type: 'personal_intro', html: doc.personalIntro || '' });
    else setEditing({ key: block.key, type: 'content', html: blockHtml(block) });
  }
  async function saveEdit() {
    if (!editing) return;
    if (editing.type === 'personal_intro') {
      await patchDoc({ personalIntro: editing.html || null });
    } else {
      const blocks = { ...(doc.overrideState?.blocks || {}) };
      blocks[editing.key] = { ...(blocks[editing.key] || {}), html: editing.html };
      await patchDoc({ overrideState: { blocks } });
    }
    setEditing(null);
  }
  function clearContentOverride(key) {
    const blocks = { ...(doc.overrideState?.blocks || {}) };
    delete blocks[key];
    patchDoc({ overrideState: Object.keys(blocks).length ? { blocks } : null });
  }

  if (loading) return <div className="p-10 text-center text-gray-400">טוען הצעת מחיר…</div>;
  if (error) return <div className="p-10 text-center text-red-600">שגיאה: {error}</div>;
  if (!model) return null;

  const items = model.blocks.map((b) => ({ id: b.key, block: b }));

  return (
    <div dir="rtl" className="mx-auto max-w-4xl px-4 py-6">
      {/* ── Toolbar ─────────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <Link to={`/admin/crm/deals/${dealId}`} className="text-sm text-blue-600 hover:underline">← חזרה לעסקה</Link>
          <h1 className="text-lg font-bold text-gray-900">הצעת מחיר (בטא)</h1>
          <Chip tone="gray">שפה: {model.language === 'en' ? 'אנגלית' : 'עברית'}</Chip>
          <Chip tone="gray">טיוטה</Chip>
          {busy && <span className="text-[12px] text-gray-400">שומר…</span>}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={refresh} disabled={busy}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            רענן תוכן שלא נערך
          </button>
          <button type="button" onClick={resetAll} disabled={busy}
            className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50">
            אפס הכל למקור
          </button>
        </div>
      </div>

      {/* ── Quote Display Product Name (one override, whole document) ── */}
      <div className="mb-4 rounded-xl border border-gray-200 bg-white px-4 py-3">
        <label className="mb-1 block text-[12px] text-gray-500">שם מוצר לתצוגה בהצעה (override — לא משנה את העסקה/הקטלוג)</label>
        <div className="flex items-center gap-2">
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => { if ((nameDraft || '') !== (doc.displayProductName || '')) patchDoc({ displayProductName: nameDraft || null }); }}
            placeholder={model.displayProductName || 'שם המוצר מהקטלוג'}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
          />
          {model.displayProductNameOverridden && (
            <>
              <Chip>נערך ידנית</Chip>
              <button type="button" onClick={() => patchDoc({ displayProductName: null })}
                className="text-[12px] text-blue-600 hover:underline">↺ אפס למקור</button>
            </>
          )}
        </div>
      </div>

      {/* ── Missing-content warnings ───────────────────────────── */}
      {model.warnings.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="mb-1 text-sm font-semibold text-amber-800">תוכן חסר בשפת ההצעה ({model.language === 'en' ? 'אנגלית' : 'עברית'})</div>
          <ul className="list-disc pr-5 text-[13px] text-amber-700">
            {model.warnings.map((w, i) => (
              <li key={i}>{BLOCK_LABELS[w.blockKey] || w.blockKey} — חסר תוכן ({w.field})</li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Document canvas with per-block admin controls ──────── */}
      <ReorderableList
        items={items}
        onReorder={onReorder}
        emptyText="אין בלוקים"
        renderRow={({ block }, { handle }) => {
          const label = BLOCK_LABELS[block.type] || block.key;
          const editable = block.type === 'personal_intro' || EDITABLE_CONTENT.has(block.type);
          const isPricing = block.type === 'pricing';
          const isEditingThis = editing?.key === block.key;
          return (
            <div className={`mb-3 rounded-xl border bg-white ${block.hidden ? 'border-gray-200 opacity-60' : 'border-gray-200'}`}>
              {/* Block control bar */}
              <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-3 py-2">
                {handle}
                <span className="text-sm font-semibold text-gray-800">{label}</span>
                {block.source && <Chip tone="gray">מקור: {block.source}</Chip>}
                {block.hidden && <Chip tone="gray">מוסתר</Chip>}
                {block.overridden && <Chip>נערך ידנית</Chip>}
                {!block.removable && <Chip tone="blue">קבוע</Chip>}
                <div className="ms-auto flex items-center gap-1">
                  {isPricing && (
                    <button type="button" onClick={() => navigate(`/admin/crm/deals/${dealId}`)}
                      className="rounded-md border border-gray-300 px-2 py-1 text-[12px] text-gray-700 hover:bg-gray-50">
                      ערוך מחירים בבנאי
                    </button>
                  )}
                  {editable && !isEditingThis && (
                    <button type="button" onClick={() => startEdit(block)}
                      className="rounded-md border border-gray-300 px-2 py-1 text-[12px] text-gray-700 hover:bg-gray-50">
                      ערוך
                    </button>
                  )}
                  {block.overridden && block.type !== 'personal_intro' && EDITABLE_CONTENT.has(block.type) && (
                    <button type="button" onClick={() => clearContentOverride(block.key)}
                      className="rounded-md px-2 py-1 text-[12px] text-blue-600 hover:underline">↺ אפס למקור</button>
                  )}
                  {block.type === 'personal_intro' && block.overridden && (
                    <button type="button" onClick={() => patchDoc({ personalIntro: null })}
                      className="rounded-md px-2 py-1 text-[12px] text-blue-600 hover:underline">↺ אפס</button>
                  )}
                  <button type="button" onClick={() => toggleHidden(block.key)} disabled={!block.removable}
                    title={block.removable ? '' : 'בלוק קבוע — לא ניתן להסתרה'}
                    className="rounded-md border border-gray-300 px-2 py-1 text-[12px] text-gray-700 hover:bg-gray-50 disabled:opacity-40">
                    {block.hidden ? 'הצג' : 'הסתר'}
                  </button>
                </div>
              </div>

              {/* Block body */}
              <div className="px-5 py-4">
                {block.hidden ? (
                  <p className="text-sm italic text-gray-400">בלוק מוסתר — לא יופיע בהצעה</p>
                ) : isEditingThis ? (
                  <div>
                    <RichEditor value={editing.html} onChange={(html) => setEditing((e) => ({ ...e, html }))} ariaLabel={`עריכת ${label}`} />
                    <div className="mt-2 flex items-center gap-2">
                      <button type="button" onClick={saveEdit} disabled={busy}
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">שמור</button>
                      <button type="button" onClick={() => setEditing(null)}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">בטל</button>
                    </div>
                  </div>
                ) : (
                  <QuoteBlock block={block} />
                )}
              </div>
            </div>
          );
        }}
      />

      <p className="mt-6 text-center text-[12px] text-gray-400">
        טיוטה — עריכה בלבד. הפקה/הקפאה, עמוד ציבורי, חתימה ו-PDF ייבנו בשלבים הבאים.
      </p>
    </div>
  );
}
