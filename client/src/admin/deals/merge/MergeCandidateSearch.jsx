import { useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api.js';
import { money, fmtDate, STATUS_HE } from './mergeFormat.js';

// Finding the second deal.
//
// This is the CANONICAL global search (/api/search, category=deals) — the same
// provider, the same ranking, the same match reasons the header search uses. It
// already matches on deal number (exact + partial), title, contact names in
// both languages, normalized phone, email, organization, unit, product, variant
// city, source, status, tour date, notes and timeline text; re-implementing any
// of that here would create a second answer to "how do I find a deal".
//
// Two narrowing options are passed, and they are the only difference:
//   excludeIds  — the deal we are merging FROM is never its own candidate
//   activeOnly  — a deal already retired by an earlier merge cannot be merged
//
// The ROW is richer than the header's, because the question is different: the
// header asks "which deal do I want to open", this asks "are these two deals
// the same transaction" — which needs price, participants and the customer's
// phone visible BEFORE opening anything.

const DEBOUNCE_MS = 220;

export default function MergeCandidateSearch({ currentDeal, selected, onSelect }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setRows([]);
      setSearched(false);
      return undefined;
    }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.search.query({
          q: term,
          category: 'deals',
          excludeIds: [currentDeal.id],
          activeOnly: true,
        });
        if (mine !== seq.current) return;
        setRows(res.groups?.[0]?.results || []);
        setSearched(true);
      } catch {
        if (mine === seq.current) setRows([]);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q, currentDeal.id]);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
        <div className="text-[11px] text-gray-400">הדיל הנוכחי</div>
        <div className="text-[13px] font-semibold text-gray-800">
          דיל #{currentDeal.orderNo} — {currentDeal.title}
        </div>
      </div>

      <div>
        <label className="mb-1 block text-[12px] font-semibold text-gray-500">
          חיפוש הדיל השני
        </label>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
          placeholder="מספר הזמנה, שם לקוח, טלפון, אימייל, ארגון, מוצר…"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-800 focus:outline-none"
        />
        <p className="mt-1 text-[11px] text-gray-400">
          אותו חיפוש של החיפוש הראשי במערכת. הדיל הנוכחי ודילים שכבר אוחדו אינם מוצגים.
        </p>
      </div>

      {loading && <div className="py-4 text-center text-sm text-gray-500">מחפש…</div>}

      {!loading && searched && !rows.length && (
        <div className="rounded-lg bg-gray-50 px-3 py-4 text-center text-sm text-gray-500">
          לא נמצאו דילים מתאימים.
        </div>
      )}

      {!loading && rows.length > 0 && (
        <ul className="max-h-[340px] space-y-1.5 overflow-y-auto">
          {rows.map((r) => (
            <li key={r.id}>
              <CandidateRow row={r} selected={selected?.id === r.id} onSelect={() => onSelect(r)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const STATUS_TONE = {
  won: 'bg-emerald-50 text-emerald-700',
  lost: 'bg-gray-100 text-gray-500',
  open: 'bg-blue-50 text-blue-700',
};

function CandidateRow({ row, selected, onSelect }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-xl border p-3 text-right transition ${
        selected ? 'border-gray-800 bg-gray-50 ring-1 ring-gray-800' : 'border-gray-200 bg-white hover:bg-gray-50'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-gray-900">#{row.orderNo}</span>
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_TONE[row.status] || 'bg-gray-100 text-gray-600'}`}>
              {STATUS_HE[row.status] || row.status}
            </span>
            {row.stageLabel && <span className="text-[11px] text-gray-400">{row.stageLabel}</span>}
          </div>
          <div className="mt-0.5 truncate text-[13px] text-gray-700">{row.title}</div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-gray-500">
            {row.contactName && <span>{row.contactName}</span>}
            {row.organizationName && <span>· {row.organizationName}</span>}
            {row.contactPhone && <span dir="ltr">· {row.contactPhone}</span>}
            {row.contactEmail && <span dir="ltr">· {row.contactEmail}</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-gray-500">
            {row.variant && <span>{row.variant}</span>}
            {row.tourDate && <span>· {fmtDate(row.tourDate)}</span>}
            {row.participants != null && <span>· {row.participants} משתתפים</span>}
            <span>· נוצר {fmtDate(row.createdAt)}</span>
          </div>
          {/* WHY this row matched — the same reason chips the header search
              shows, so an unexpected result is explainable rather than magic. */}
          {row.reasons?.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {row.reasons.map((reason, i) => (
                <span
                  key={i}
                  className={`rounded px-1.5 py-0.5 text-[10px] ${reason.strong ? 'bg-amber-50 text-amber-800' : 'bg-gray-100 text-gray-500'}`}
                >
                  {reason.label}
                  {reason.text ? `: ${reason.text}` : ''}
                </span>
              ))}
            </div>
          )}
        </div>
        {/* Price is deliberately the most prominent thing on the right: it is
            the fastest way to tell two deals for the same customer apart. */}
        <div className="shrink-0 text-left">
          <div className="text-[15px] font-semibold text-gray-900">{money(row.valueMinor, row.currency)}</div>
          <div className="text-[11px] text-gray-400">סכום הדיל</div>
        </div>
      </div>
    </button>
  );
}
