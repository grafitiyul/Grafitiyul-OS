import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { formatMinor } from '../../lib/money.js';
import { dealPath } from '../deals/config.js';
import { OpenDocumentButton } from '../deals/DealCollectionCard.jsx';

// התאמות גבייה לבדיקה — the operator queue for second-stage matches.
//
// The second-stage matcher links a document to a deal automatically ONLY when
// the two are each other's only candidate. Everything else lands here as a
// QUESTION with all of its evidence attached: the candidate document's real
// customer, date and amount straight from the local iCount mirror, why it was
// suggested, which other deals could claim it, and which other documents could
// settle this deal.
//
// The point is that the operator never has to go and search iCount by hand. One
// screen, one question per deal, four possible answers.

const ACTIONS = [
  { key: 'link', label: 'שייך לעסקה', tone: 'primary', hint: 'המסמך שייך לעסקה הזו' },
  { key: 'shared', label: 'מסמך משותף', tone: 'shared', hint: 'סוגר גם עסקאות אחרות — ייספר פעם אחת בדוחות' },
  { key: 'reject', label: 'לא שייך', tone: 'ghost', hint: 'המסמך אינו של העסקה הזו' },
  { key: 'unresolved', label: 'לא ניתן להכריע', tone: 'ghost', hint: 'להשאיר פתוח לבירור' },
];

const TONE = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700',
  shared: 'bg-purple-600 text-white hover:bg-purple-700',
  ghost: 'border border-gray-300 text-gray-700 hover:bg-gray-50',
};

const fmtDay = (v) => (v ? new Date(v).toLocaleDateString('he-IL') : '—');

function ReasonChip({ reason }) {
  const strong = ['icount_client_id', 'tax_id', 'exact_amount', 'exact_name'].includes(reason.code);
  return (
    <span
      title={reason.detail != null ? String(reason.detail) : undefined}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium ring-1 ${
        strong ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-gray-50 text-gray-600 ring-gray-200'
      }`}
    >
      {reason.label}
      {reason.code === 'date_distance_days' && reason.detail != null ? `: ${reason.detail}` : ''}
    </span>
  );
}

function CandidateCard({ dealRow, cand, onResolve, busy }) {
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  const doc = cand.document;
  const amountMatches = doc && Math.abs(doc.amountMinor - dealRow.dealValueMinor) <= 10;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13.5px] font-semibold text-gray-900">
              {cand.doctypeLabel} מס׳ {cand.docnum}
            </span>
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10.5px] font-semibold text-blue-800 ring-1 ring-blue-200">
              ודאות {cand.score}
            </span>
            {doc?.countsAsPayment && (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-medium text-emerald-800 ring-1 ring-emerald-200">
                מהווה תשלום
              </span>
            )}
            {doc?.cancelled && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10.5px] font-medium text-gray-600 ring-1 ring-gray-200">
                מבוטל
              </span>
            )}
          </div>
          {doc && (
            <div className="mt-1 text-[12.5px] text-gray-600">
              {doc.clientName || '—'} · {fmtDay(doc.issuedAt)} ·{' '}
              <span dir="ltr" className={amountMatches ? 'font-semibold text-emerald-700' : 'text-gray-800'}>
                {formatMinor(doc.amountMinor, doc.currency)}
              </span>
              {!amountMatches && (
                <span className="text-gray-400"> (סכום העסקה {formatMinor(dealRow.dealValueMinor, dealRow.currency)})</span>
              )}
            </div>
          )}
          <div className="mt-1.5 flex flex-wrap gap-1">
            {cand.reasons.map((r, i) => <ReasonChip key={i} reason={r} />)}
          </div>
        </div>
        {/* The operator must be able to LOOK at the candidate before deciding —
            resolved read-only through the canonical iCount integration. */}
        <span className="shrink-0">
          <OpenDocumentButton dealId={dealRow.dealId} row={{ ...cand, docUrl: doc?.docUrl }} label />
        </span>
      </div>

      {/* Competitors — the whole reason this is a question and not a link. */}
      {(cand.competingDeals?.length > 0 || cand.competingDocs?.length > 0) && (
        <div className="mt-2 space-y-1 rounded-lg bg-amber-50/60 px-2.5 py-1.5 ring-1 ring-amber-100">
          {cand.competingDeals?.length > 0 && (
            <div className="text-[11.5px] text-amber-900">
              המסמך מתאים גם ל: {cand.competingDeals.map((d) => `#${d.orderNo} (${formatMinor(d.valueMinor, dealRow.currency)})`).join(' · ')}
            </div>
          )}
          {cand.competingDocs?.length > 0 && (
            <div className="text-[11.5px] text-amber-900">
              לעסקה מתאימים גם: {cand.competingDocs.map((d) => `${d.doctype} ${d.docnum} (${formatMinor(d.amountMinor, dealRow.currency)})`).join(' · ')}
            </div>
          )}
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {ACTIONS.map((a) => (
          <button key={a.key} type="button" title={a.hint} disabled={busy}
            onClick={() => onResolve(cand.id, a.key, note.trim() || undefined)}
            className={`rounded-lg px-3 py-1.5 text-[12.5px] font-medium disabled:opacity-50 ${TONE[a.tone]}`}>
            {a.label}
          </button>
        ))}
        <button type="button" onClick={() => setShowNote((s) => !s)}
          className="text-[12px] text-gray-500 hover:text-gray-700">
          {showNote ? 'הסתר הערה' : '+ הערה'}
        </button>
      </div>
      {showNote && (
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="הערה שתישמר עם ההחלטה"
          className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-400 focus:outline-none" />
      )}
    </div>
  );
}

export default function CollectionReviewPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [status, setStatus] = useState('open');

  const load = useCallback(async () => {
    try {
      setData(await api.collection.review({ status, limit: 100 }));
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  async function resolve(itemId, action, note) {
    setBusyId(itemId);
    try {
      await api.collection.resolveReviewItem(itemId, { action, note });
      await load();
    } catch (e) {
      setError(e?.payload?.error || e.message);
    } finally {
      setBusyId(null);
    }
  }

  const counts = data?.counts || {};

  return (
    <div className="mx-auto max-w-[1400px] px-5 py-4 lg:px-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold leading-tight tracking-tight text-gray-900 lg:text-2xl">
            התאמות גבייה לבדיקה
          </h1>
          <p className="text-[12px] text-gray-500">
            מסמכים שנמצאו באייקאונט ועשויים לשייך לעסקה — כל פריט מוצג עם כל הראיות, כדי שלא תצטרכו לחפש באייקאונט.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {[['open', 'פתוחים'], ['linked', 'שויכו'], ['shared', 'משותפים'], ['rejected', 'נדחו'], ['unresolved', 'לא הוכרעו']].map(([k, label]) => (
            <button key={k} type="button" onClick={() => setStatus(k)}
              className={`rounded-lg px-3 py-1.5 text-[12.5px] font-medium ${
                status === k ? 'bg-gray-900 text-white' : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}>
              {label}{counts[k] != null ? ` (${counts[k]})` : ''}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700 ring-1 ring-red-200">{error}</p>}

      {!data ? (
        <div className="py-20 text-center text-sm text-gray-400">טוען…</div>
      ) : data.deals.length === 0 ? (
        <div className="mx-auto max-w-sm py-20 text-center">
          <div className="mb-3 text-5xl opacity-70">✅</div>
          <h3 className="mb-1 text-lg font-semibold text-gray-900">אין פריטים בסטטוס הזה</h3>
          <p className="text-sm leading-relaxed text-gray-500">כל ההתאמות בסטטוס שנבחר טופלו.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.deals.map((d) => (
            <section key={d.dealId} className="rounded-xl border border-gray-200 bg-gray-50/50 p-3">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <button type="button" onClick={() => navigate(dealPath({ orderNo: d.orderNo, id: d.dealId }))}
                    className="text-[14px] font-semibold text-blue-700 hover:underline">
                    #{d.orderNo} · {d.title}
                  </button>
                  <div className="text-[12px] text-gray-600">
                    {d.customer || '—'}
                    {d.organizationUnit ? ` · ${d.organizationUnit}` : ''}
                    {' · '}סיור {fmtDay(d.tourDate)}
                  </div>
                </div>
                <div dir="ltr" className="text-[14px] font-bold tabular-nums text-gray-900">
                  {formatMinor(d.dealValueMinor, d.currency)}
                </div>
              </div>

              {/* The single question this deal poses. */}
              <p className="mb-2 rounded-lg bg-white px-3 py-2 text-[12.5px] font-medium text-gray-800 ring-1 ring-gray-200">
                {d.candidates[0]?.question}
              </p>

              <div className="space-y-2">
                {d.candidates.map((c) => (
                  <CandidateCard key={c.id} dealRow={d} cand={c} busy={busyId === c.id} onResolve={resolve} />
                ))}
              </div>
            </section>
          ))}
          {data.total > data.deals.length && (
            <p className="py-3 text-center text-[12px] text-gray-500">
              מוצגות {data.deals.length} עסקאות מתוך {data.total} פריטים פתוחים.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
