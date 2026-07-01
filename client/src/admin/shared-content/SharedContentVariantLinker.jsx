import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { TYPE_LABEL } from './sharedContentMeta.js';

// "קשר לוריאציות נוספות" — from a Shared Content item, choose which other variants
// should use it. Creates ProductVariantSharedContent references (no content copy).
// Never overwrites silently: a variant that already has a different block for this
// type requires an explicit replace-confirm; a variant with legacy columns is
// warned that it will switch to the shared item (legacy is NOT deleted).
//
// Produced quotes are unaffected (frozen snapshot); only drafts resolve the link.

const CTRL =
  'h-9 rounded-lg border border-gray-300 bg-white px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-200';

const FILTERS = [
  { key: 'all', label: 'הכל' },
  { key: 'free', label: 'פנויות' },
  { key: 'conflict', label: 'משויכות לאחר' },
  { key: 'legacy', label: 'תוכן ישן' },
];

export default function SharedContentVariantLinker({ sharedContentId, type, onChanged }) {
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [busyId, setBusyId] = useState(null);

  const reload = useCallback(async () => {
    try {
      setData(await api.sharedContent.linkCandidates(sharedContentId));
    } catch (e) {
      setData({ variants: [], error: e.message });
    }
  }, [sharedContentId]);
  useEffect(() => { reload(); }, [reload]);

  async function act(fn, variantId) {
    setBusyId(variantId);
    try {
      await fn();
      await reload();
      onChanged?.();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusyId(null);
    }
  }

  function link(v) {
    if (v.currentBlockId) {
      if (!confirm(`הוריאציה כבר משתמשת ב"${v.currentBlockName}" עבור ${TYPE_LABEL[type]}. להחליף בתוכן זה?`)) return;
      return act(() => api.sharedContent.link(sharedContentId, v.productVariantId, true), v.productVariantId);
    }
    if (v.legacyFilled) {
      if (!confirm('לוריאציה יש תוכן ישן עבור סוג זה. הקישור יגרום לה להשתמש בתוכן המשותף (התוכן הישן יישמר, לא נמחק). להמשיך?')) return;
    }
    return act(() => api.sharedContent.link(sharedContentId, v.productVariantId, false), v.productVariantId);
  }

  function detach(v) {
    if (!confirm('לנתק וריאציה זו מהתוכן המשותף? התוכן עצמו יישאר בספרייה.')) return;
    return act(() => api.sharedContent.detach(v.productVariantId, type), v.productVariantId);
  }

  if (!data) return <div className="text-[12px] text-gray-400">טוען וריאציות…</div>;

  const variants = data.variants || [];
  const linked = variants.filter((v) => v.linkedToThis);
  const others = variants
    .filter((v) => !v.linkedToThis)
    .filter((v) => {
      if (filter === 'free') return !v.currentBlockId && !v.legacyFilled;
      if (filter === 'conflict') return !!v.currentBlockId;
      if (filter === 'legacy') return v.legacyFilled && !v.currentBlockId;
      return true;
    })
    .filter((v) => {
      if (!q.trim()) return true;
      return `${v.productName} ${v.locationName}`.toLowerCase().includes(q.trim().toLowerCase());
    });

  return (
    <div className="border-t border-gray-200 pt-4 mt-1">
      <div className="text-[13px] font-semibold text-gray-800 mb-2">
        קשר לוריאציות נוספות <span className="text-[11px] font-normal text-gray-400">({TYPE_LABEL[type]})</span>
      </div>

      <div className="mb-3">
        <div className="text-[11px] text-gray-500 mb-1">מקושרות כרגע ({linked.length})</div>
        {linked.length === 0 ? (
          <div className="text-[12px] text-gray-400">אין וריאציות מקושרות עדיין.</div>
        ) : (
          <ul className="space-y-1">
            {linked.map((v) => (
              <li key={v.productVariantId} className="flex items-center gap-2 text-[13px]">
                <span className="flex-1 min-w-0 truncate">
                  {v.productName} <span className="text-gray-400">· {v.locationName}</span>
                  {!v.variantActive && <span className="text-[11px] text-amber-600"> · לא פעילה</span>}
                </span>
                <button type="button" onClick={() => detach(v)} disabled={busyId === v.productVariantId}
                  className="text-[12px] font-medium text-red-600 hover:text-red-700 px-2 py-0.5 rounded hover:bg-red-50 disabled:opacity-50">
                  נתק
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex gap-2 mb-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש מוצר / מיקום…" className={`${CTRL} flex-1`} />
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className={CTRL}>
          {FILTERS.map((f) => (<option key={f.key} value={f.key}>{f.label}</option>))}
        </select>
      </div>

      {others.length === 0 ? (
        <div className="text-[12px] text-gray-400 py-2">אין וריאציות תואמות.</div>
      ) : (
        <ul className="divide-y divide-gray-100 max-h-64 overflow-y-auto border border-gray-100 rounded-lg">
          {others.map((v) => (
            <li key={v.productVariantId} className="flex items-center gap-2 px-2 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-gray-800 truncate">
                  {v.productName} <span className="text-gray-400">· {v.locationName}</span>
                  {!v.variantActive && <span className="text-[11px] text-amber-600"> · לא פעילה</span>}
                </div>
                {v.currentBlockId ? (
                  <div className="text-[11px] text-amber-700">כבר משויך: {v.currentBlockName} — קישור יחליף</div>
                ) : v.legacyFilled ? (
                  <div className="text-[11px] text-amber-700">תוכן ישן — קישור יגרום לשימוש בתוכן המשותף</div>
                ) : (
                  <div className="text-[11px] text-gray-400">פנוי</div>
                )}
              </div>
              <button type="button" onClick={() => link(v)} disabled={busyId === v.productVariantId}
                className={`h-8 px-3 rounded-lg border text-[12px] font-medium disabled:opacity-50 ${
                  v.currentBlockId ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                }`}>
                {v.currentBlockId ? 'החלף וקשר' : 'קשר'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
