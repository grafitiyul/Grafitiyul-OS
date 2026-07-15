import { useEffect, useState, useCallback } from 'react';
import { migrationApi } from '../api.js';
import SourceRecord from '../components/SourceRecord.jsx';
import { num } from '../components/format.js';

// Read-only Snapshot Browser — inspect the SOURCE records behind a review
// decision. Deliberately compact: pick an entity, page or look up an id, open one
// record. Not a data platform, not a search engine.
export default function SnapshotBrowserTab() {
  const [entities, setEntities] = useState(null);
  const [entity, setEntity] = useState(null);
  const [page, setPage] = useState(null);
  const [offset, setOffset] = useState(0);
  const [q, setQ] = useState('');
  const [matches, setMatches] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [error, setError] = useState(null);
  const LIMIT = 25;

  useEffect(() => {
    migrationApi.browserEntities()
      .then((r) => {
        setEntities(r.entities);
        if (r.entities.length) setEntity(r.entities[0].key);
      })
      .catch((e) => setError(e?.status === 404 ? 'לא נמצא צילום' : 'טעינת הצילום נכשלה'));
  }, []);

  const load = useCallback(async () => {
    if (!entity) return;
    try {
      setPage(await migrationApi.browserRecords(entity, offset, LIMIT));
      setError(null);
    } catch (e) { setError('טעינת הרשומות נכשלה'); }
  }, [entity, offset]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setOffset(0); setOpenId(null); setQ(''); setMatches(null); }, [entity]);

  async function runFilter(e) {
    e.preventDefault();
    if (!q.trim()) { setMatches(null); return; }
    try { setMatches((await migrationApi.browserFilter(entity, q.trim())).matches); }
    catch (err) { setError(err?.status === 503 ? 'הצילום טרם אונדקס — חיפוש לא זמין' : 'החיפוש נכשל'); }
  }

  const rows = matches ?? page?.rows ?? [];

  return (
    <div className="p-4">
      {error && <div className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      <div className="bg-white border border-gray-200 rounded-xl p-3 mb-3">
        <p className="text-[12px] text-gray-500 mb-2">
          עיון לקריאה בלבד בנתוני המקור כפי שנשמרו בצילום. שום דבר כאן אינו משנה נתונים.
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          <select
            value={entity || ''}
            onChange={(e) => setEntity(e.target.value)}
            className="text-[13px] border border-gray-200 rounded-md px-2 py-1.5 bg-white"
          >
            {(entities || []).map((e) => (
              <option key={e.key} value={e.key}>
                {e.system === 'pipedrive' ? 'Pipedrive' : 'Airtable'} · {e.label} ({num(e.records)})
              </option>
            ))}
          </select>
          <form onSubmit={runFilter} className="flex gap-1">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="חיפוש לפי שם או מזהה מקור"
              className="text-[13px] border border-gray-200 rounded-md px-2 py-1.5 w-56"
            />
            <button type="submit" className="text-[13px] px-3 py-1.5 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-700">חפש</button>
            {matches && (
              <button type="button" onClick={() => { setQ(''); setMatches(null); }} className="text-[13px] px-2 py-1.5 text-gray-500 hover:underline">נקה</button>
            )}
          </form>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* List */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between">
            <span className="text-[12px] text-gray-500">
              {matches ? `${num(rows.length)} תוצאות` : `${num(page?.total ?? 0)} רשומות`}
            </span>
            {!matches && page && (
              <div className="flex items-center gap-1">
                <button
                  type="button" disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - LIMIT))}
                  className="text-[12px] px-2 py-1 rounded border border-gray-200 disabled:opacity-40"
                >הקודם</button>
                <span className="text-[11px] text-gray-400 tabular-nums px-1">
                  {num(offset + 1)}–{num(Math.min(offset + LIMIT, page.total))}
                </span>
                <button
                  type="button" disabled={offset + LIMIT >= (page.total || 0)}
                  onClick={() => setOffset(offset + LIMIT)}
                  className="text-[12px] px-2 py-1 rounded border border-gray-200 disabled:opacity-40"
                >הבא</button>
              </div>
            )}
          </div>
          <ul className="divide-y divide-gray-100 max-h-[60vh] overflow-y-auto">
            {rows.map((r) => (
              <li key={String(r.id)}>
                <button
                  type="button"
                  onClick={() => setOpenId(r.id)}
                  className={`w-full text-right px-3 py-2 text-[13px] hover:bg-gray-50 ${String(openId) === String(r.id) ? 'bg-blue-50 text-blue-800' : 'text-gray-800'}`}
                >
                  {r.label}
                </button>
              </li>
            ))}
            {!rows.length && <li className="px-3 py-6 text-center text-[13px] text-gray-400">אין רשומות להצגה</li>}
          </ul>
        </div>

        {/* Record */}
        <div className="bg-white border border-gray-200 rounded-xl p-3 min-h-[12rem]">
          {openId == null ? (
            <div className="h-full flex items-center justify-center text-[13px] text-gray-400 py-10">בחר רשומה כדי לראות את פרטי המקור</div>
          ) : (
            <SourceRecord
              entity={entity}
              id={openId}
              onOpenRef={(ref) => { setEntity(ref.entity); setTimeout(() => setOpenId(ref.id), 0); }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
