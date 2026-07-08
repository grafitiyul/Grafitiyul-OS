import { useState } from 'react';
import { api } from '../../../lib/api.js';

// "שייך מסמך אחר מאייקאונט" — search iCount for a document that was NOT
// issued through GOS, confirm it ("האם זה המסמך הנכון?"), and link it to the
// deal so it becomes a base-document candidate. Linking is idempotent
// server-side. Search routes one free-text query by shape (email / docnum /
// ח.פ / customer name — phone is not an iCount doc-search filter) plus an
// optional type filter.

const FIELD = 'w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-400 focus:outline-none';

const STATUS_LABEL = { open: 'פתוח', closed: 'סגור', partial: 'סגור חלקית' };

const fmtIls = (n) =>
  n == null ? '—' : `₪${Number(n).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function LinkExternalDocumentPanel({ dealId, docTypes, onLinked, onClose }) {
  const [query, setQuery] = useState('');
  const [doctype, setDoctype] = useState('');
  const [results, setResults] = useState(null); // null = not searched yet
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);
  const [candidate, setCandidate] = useState(null); // confirmation step
  const [linking, setLinking] = useState(false);

  async function search() {
    if (searching || (!query.trim() && !doctype)) return;
    setSearching(true);
    setError(null);
    setCandidate(null);
    try {
      const { documents } = await api.deals.icountSearchDocuments(dealId, query.trim(), doctype || undefined);
      setResults(documents);
    } catch (e) {
      const code = e.payload?.error;
      setError(
        code === 'phone_search_unsupported'
          ? 'חיפוש לפי מספר טלפון אינו נתמך ע״י אייקאונט — חפשו לפי אימייל, שם לקוח, ח.פ או מספר מסמך.'
          : e.payload?.reason || code || e.message,
      );
      setResults(null);
    } finally {
      setSearching(false);
    }
  }

  async function confirmLink() {
    if (linking || !candidate) return;
    setLinking(true);
    setError(null);
    try {
      const { document } = await api.deals.icountLinkDocument(dealId, {
        doctype: candidate.doctype,
        docnum: candidate.docnum,
      });
      onLinked(document);
    } catch (e) {
      setError(e.payload?.reason || e.payload?.error || e.message);
      setLinking(false);
    }
  }

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-3">
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-semibold text-blue-900">שיוך מסמך קיים מאייקאונט לדיל</p>
        <button type="button" onClick={onClose} className="text-[12px] text-gray-500 hover:text-gray-700">סגירה</button>
      </div>

      {candidate ? (
        /* ── Confirmation step ── */
        <div className="mt-2 space-y-2">
          <p className="text-[13.5px] font-semibold text-gray-900">האם זה המסמך הנכון?</p>
          <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800">
            <p className="font-semibold">{candidate.doctypeLabel} מס׳ {candidate.docnum}</p>
            <p className="text-gray-600">
              {candidate.clientName || 'לקוח לא מזוהה'} · {fmtIls(candidate.amountIls)}
              {candidate.issuedAt && <span> · {candidate.issuedAt}</span>}
              <span> · {STATUS_LABEL[candidate.status] || candidate.status}</span>
            </p>
            {(candidate.email || candidate.phone) && (
              <p className="text-[12px] text-gray-500" dir="ltr">{[candidate.email, candidate.phone].filter(Boolean).join(' · ')}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={confirmLink} disabled={linking}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {linking ? 'משייך…' : 'כן — שיוך לדיל'}
            </button>
            <button type="button" onClick={() => setCandidate(null)} disabled={linking}
              className="rounded-lg px-3 py-1.5 text-[13px] text-gray-600 hover:bg-gray-100 disabled:opacity-50">
              חזרה לתוצאות
            </button>
          </div>
        </div>
      ) : (
        /* ── Search step ── */
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), search())}
              placeholder="שם לקוח / אימייל / ח.פ / מספר מסמך"
              className={`${FIELD} flex-1 min-w-[12rem]`}
            />
            <select value={doctype} onChange={(e) => setDoctype(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">כל הסוגים</option>
              {docTypes.map((t) => (<option key={t.key} value={t.key}>{t.label}</option>))}
            </select>
            <button type="button" onClick={search} disabled={searching || (!query.trim() && !doctype)}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {searching ? 'מחפש…' : 'חיפוש'}
            </button>
          </div>
          <p className="mt-1 text-[11px] text-gray-500">החיפוש רץ מול אייקאונט לפי שם לקוח, אימייל, ח.פ או מספר מסמך (חיפוש לפי טלפון אינו נתמך ע״י אייקאונט).</p>

          {results !== null && (
            <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
              {results.length === 0 ? (
                <p className="px-1 py-2 text-[13px] text-gray-500">לא נמצאו מסמכים מתאימים.</p>
              ) : (
                results.map((d) => (
                  <button key={`${d.doctype}:${d.docnum}`} type="button" onClick={() => setCandidate(d)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-right hover:border-blue-400 hover:bg-blue-50">
                    <span className="min-w-0 flex-1">
                      <span className="text-[13px] font-medium text-gray-900">{d.doctypeLabel} מס׳ {d.docnum}</span>
                      <span className="block truncate text-[12px] text-gray-500">
                        {d.clientName || '—'}{d.email ? ` · ${d.email}` : ''}{d.issuedAt ? ` · ${d.issuedAt}` : ''}
                      </span>
                    </span>
                    <span className="shrink-0 text-[12.5px] text-gray-700" dir="ltr">{fmtIls(d.amountIls)}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium ring-1 ${
                      d.status === 'closed' ? 'bg-gray-100 text-gray-600 ring-gray-200' : 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                    }`}>
                      {STATUS_LABEL[d.status] || d.status}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </>
      )}

      {error && (
        <p className="mt-2 text-[12.5px] text-red-600">שגיאה: <span dir="ltr" className="font-mono">{error}</span></p>
      )}
    </div>
  );
}
