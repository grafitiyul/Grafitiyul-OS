import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import ProposalCard from './ProposalCard.jsx';

const POLL_MS = 45_000;

const FILTERS = [
  { key: 'open', label: 'ממתין לאישור' },
  { key: 'shadow', label: 'נרשם בצל' },
  { key: 'all', label: 'הכל' },
];

// לאישור — the operator's queue.
//
// Approval must not become a bottleneck, so this screen is deliberately a
// SECONDARY surface: the primary place to approve a suggestion is inside the
// WhatsApp conversation, where the operator already is. This is the catch-up
// view for whoever works a backlog, and the place escalations surface.
export default function AgentReview() {
  const [filter, setFilter] = useState('open');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await api.aiAgent.proposals({ status: filter, limit: 50 });
      setRows(res.proposals || []);
      setError(null);
    } catch (e) {
      setError(e?.payload?.error || e.message);
    }
  }, [filter]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [load]);

  return (
    <div className="mx-auto max-w-4xl p-4">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="gos-title text-[18px]">לאישור</h1>
        <div className="ms-auto flex items-center gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-md px-2.5 py-1 text-[13px] transition ${
                filter === f.key ? 'bg-blue-50 font-semibold text-blue-700' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="mb-3 rounded bg-rose-50 px-3 py-2 text-[13px] text-rose-800">{error}</div>}

      {rows === null && <div className="gos-meta">טוען…</div>}

      {rows?.length === 0 && (
        <div className="rounded-xl border border-gray-200 bg-white px-6 py-10 text-center">
          <div className="gos-title-sm text-gray-900">
            {filter === 'open' ? 'אין הצעות שממתינות לך' : filter === 'shadow' ? 'אין עדיין רשומות צל' : 'אין רשומות להצגה'}
          </div>
          <p className="gos-detail mx-auto mt-1 max-w-xl text-gray-600">
            {filter === 'open'
              ? 'הצעה מגיעה לכאן רק מקטגוריה שהעברת למצב "דורש אישור". כל עוד הכל במצב צל, הסוכן רק רושם מה היה עונה — ואת זה רואים בלשונית "נרשם בצל".'
              : filter === 'shadow'
                ? 'ברגע שלקוח יכתוב הודעה והסוכן ינתח אותה, מה שהוא היה עונה יופיע כאן. אם עברו כמה ימים ואין כלום — בדוק במסך הבית שהסוכן דלוק.'
                : 'עדיין לא נוצרו הצעות.'}
          </p>
        </div>
      )}

      <div className="space-y-3">
        {(rows || []).map((p) => (
          <ProposalCard key={p.id} proposal={p} onHandled={load} />
        ))}
      </div>
    </div>
  );
}
