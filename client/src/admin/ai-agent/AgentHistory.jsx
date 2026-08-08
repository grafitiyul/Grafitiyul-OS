import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import WhyPanel from './WhyPanel.jsx';
import { PROPOSAL_STATUS, CONFIDENCE_LABELS, MODE_LABELS, fmtDateTime } from './config.js';

const FILTERS = [
  { key: '', label: 'הכל' },
  { key: 'succeeded', label: 'הצליחו' },
  { key: 'failed', label: 'תקלות' },
  { key: 'skipped', label: 'דולגו' },
];

const RUN_STATUS = {
  succeeded: { label: 'הושלם', style: 'bg-emerald-50 text-emerald-700' },
  failed: { label: 'תקלה', style: 'bg-rose-50 text-rose-700' },
  skipped: { label: 'דולג', style: 'bg-gray-100 text-gray-600' },
  pending: { label: 'בעיבוד', style: 'bg-amber-50 text-amber-800' },
};

// היסטוריה — every run, with enough detail to diagnose the inevitable first
// problems: what triggered it, what it decided, how long it took, which model
// and which configuration version, and what happened to the proposal.
//
// "טעינת AI נכשלה" is never the whole story here — the error CODE and message
// are shown verbatim, because an operator who can read the failure can tell you
// what to fix.
export default function AgentHistory() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const escalated = params.get('escalated') === '1';
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await api.aiAgent.runs({
        limit: 50,
        ...(status ? { status } : {}),
        ...(escalated ? { escalated: 1 } : {}),
      });
      setRows(res.runs || []);
      setError(null);
    } catch (e) {
      setError(e?.payload?.error || e.message);
    }
  }, [status, escalated]);

  useEffect(() => { load(); }, [load]);

  function setFilter(next) {
    const p = new URLSearchParams(params);
    if (next) p.set('status', next); else p.delete('status');
    setParams(p, { replace: true });
  }

  return (
    <div className="mx-auto max-w-5xl p-4">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="gos-title text-[18px]">היסטוריה</h1>
        <div className="ms-auto flex flex-wrap items-center gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key || 'all'}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-md px-2.5 py-1 text-[13px] transition ${
                status === f.key ? 'bg-blue-50 font-semibold text-blue-700' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {f.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              const p = new URLSearchParams(params);
              if (escalated) p.delete('escalated'); else p.set('escalated', '1');
              setParams(p, { replace: true });
            }}
            className={`rounded-md px-2.5 py-1 text-[13px] transition ${
              escalated ? 'bg-orange-50 font-semibold text-orange-800' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            הועברו לאדם
          </button>
        </div>
      </div>

      {error && <div className="mb-3 rounded bg-rose-50 px-3 py-2 text-[13px] text-rose-800">{error}</div>}
      {rows === null && <div className="gos-meta">טוען…</div>}
      {rows?.length === 0 && (
        <div className="rounded-xl border border-gray-200 bg-white px-6 py-10 text-center">
          <div className="gos-detail text-gray-700">אין ריצות להצגה.</div>
          <div className="gos-meta mt-1">הסוכן רושם כאן כל ניתוח — כולל דילוגים ותקלות.</div>
        </div>
      )}

      <div className="space-y-2">
        {(rows || []).map((r) => {
          const st = RUN_STATUS[r.status] || { label: r.status, style: 'bg-gray-100 text-gray-600' };
          const prop = r.proposals?.[0] || null;
          const propSt = prop ? PROPOSAL_STATUS[prop.status] : null;
          const isOpen = openId === r.id;
          return (
            <article key={r.id} className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-[12px] ${st.style}`}>{st.label}</span>
                {r.intent && <span className="gos-title-sm text-gray-900">{r.intent}</span>}
                {r.escalate && (
                  <span className="rounded bg-orange-50 px-2 py-0.5 text-[12px] text-orange-800">הועבר לאדם</span>
                )}
                {propSt && <span className={`rounded px-2 py-0.5 text-[12px] ${propSt.style}`}>{propSt.label}</span>}
                <span className="gos-meta ms-auto">{fmtDateTime(r.createdAt)}</span>
              </div>

              <div className="gos-meta mt-1 flex flex-wrap gap-x-3">
                {r.authorityMode && <span>סמכות: {MODE_LABELS[r.authorityMode] || r.authorityMode}</span>}
                {r.confidence && <span>{CONFIDENCE_LABELS[r.confidence]}</span>}
                {r.latencyMs != null && <span>{(r.latencyMs / 1000).toFixed(1)} שנ׳</span>}
                {r.model && <span dir="ltr" className="font-mono text-[11px]">{r.model}</span>}
                {r.promptVersion && <span dir="ltr" className="font-mono text-[11px]">{r.promptVersion}</span>}
                {r.inputTokens != null && <span>{r.inputTokens}/{r.outputTokens ?? 0} טוקנים</span>}
              </div>

              {r.escalationReason && (
                <div className="gos-detail mt-1 text-orange-900">{r.escalationReason}</div>
              )}
              {r.status === 'failed' && (
                <div className="mt-1 rounded bg-rose-50 px-3 py-2 text-[13px] text-rose-900">
                  <code dir="ltr" className="font-mono text-[12px]">{r.errorCode || 'unknown'}</code>
                  {r.errorMessage ? ` — ${r.errorMessage}` : ''}
                </div>
              )}
              {r.status === 'skipped' && r.skipReason && (
                <div className="gos-meta mt-1">{r.skipReason}</div>
              )}

              <button
                type="button"
                onClick={() => setOpenId(isOpen ? null : r.id)}
                className="mt-2 rounded-lg border border-gray-300 px-3 py-1 text-[13px] text-gray-700 hover:bg-gray-50"
              >
                {isOpen ? 'סגור' : 'למה?'}
              </button>
              {isOpen && <div className="mt-2"><RunDetail runId={r.id} /></div>}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function RunDetail({ runId }) {
  const [run, setRun] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.aiAgent.run(runId)
      .then((res) => { if (!cancelled) setRun(res.run); })
      .catch((e) => { if (!cancelled) setError(e?.payload?.error || e.message); });
    return () => { cancelled = true; };
  }, [runId]);

  if (error) return <div className="gos-meta text-rose-700">{error}</div>;
  if (!run) return <div className="gos-meta">טוען…</div>;

  return (
    <div className="space-y-2">
      {run.proposals?.map((p) => (
        <div key={p.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <div className="gos-meta mb-1">מה הסוכן הציע</div>
          <div dir="auto" className="gos-detail whitespace-pre-wrap text-gray-800">
            {p.proposedText || '—'}
          </div>
          {p.finalText && p.finalText !== p.proposedText && (
            <>
              <div className="gos-meta mb-1 mt-2">מה נשלח בפועל</div>
              <div dir="auto" className="gos-detail whitespace-pre-wrap text-emerald-900">{p.finalText}</div>
            </>
          )}
          {p.rejectReason && <div className="gos-meta mt-1">סיבת דחייה: {p.rejectReason}</div>}
        </div>
      ))}
      <WhyPanel run={run} />
    </div>
  );
}
