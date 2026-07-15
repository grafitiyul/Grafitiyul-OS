import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { migrationApi } from '../api.js';
import { num, dateTime } from '../components/format.js';

// Stage & configuration — the FROZEN, owner-approved migration decisions.
// Read-only by design: these were approved at spec freeze and the owner is never
// asked to re-approve them. Rendered as plain label→value facts, never raw JSON.
export default function StageConfigTab() {
  const { reload } = useOutletContext() || {};
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Idempotent: seeds the approved configuration on first visit, no-op after.
        await migrationApi.seed();
        const q = await migrationApi.queue('stage_config');
        if (cancelled) return;
        setData(q);
        reload?.();
      } catch (e) {
        if (!cancelled) setError(e?.status === 401 ? 'אין הרשאה' : 'טעינת ההגדרות נכשלה');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return <div className="p-6"><div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div></div>;
  }
  if (!data) return <div className="p-6 text-sm text-gray-500">טוען…</div>;

  const stages = data.decisions.filter((d) => d.proposal?.kind === 'stage_mapping');
  const rules = data.decisions.filter((d) => d.proposal?.kind === 'rule');
  const decidedAt = data.decisions[0]?.decidedAt;
  const decidedBy = data.decisions[0]?.decidedByName;

  return (
    <div className="p-4 space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-sm font-semibold text-gray-900">ההגדרות המאושרות של המיגרציה</h2>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-semibold">מאושר</span>
        </div>
        <p className="text-sm text-gray-500 leading-relaxed">
          אלה ההחלטות שאושרו והוקפאו. הן מוצגות כאן לצפייה בלבד — אין צורך לאשר אותן שוב.
        </p>
        {decidedBy && (
          <p className="text-[12px] text-gray-400 mt-2">
            אושר על ידי {decidedBy} · {dateTime(decidedAt)} · {num(data.decisions.length)} החלטות
          </p>
        )}
      </div>

      {/* Stage mapping */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-900">מיפוי שלבים</h3>
          <p className="text-[12px] text-gray-500 mt-0.5">כל שלב במערכת הקודמת ולאן הוא עובר ב-GOS. השלב המקורי תמיד נשמר ברשומת המקור.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-right font-medium px-4 py-2">צינור מקורי</th>
                <th className="text-right font-medium px-4 py-2">שלב מקורי</th>
                <th className="text-right font-medium px-4 py-2">עסקאות</th>
                <th className="text-right font-medium px-4 py-2">שלב היעד ב-GOS</th>
                <th className="text-right font-medium px-4 py-2">כללים מיוחדים</th>
              </tr>
            </thead>
            <tbody>
              {stages.map((d) => {
                const p = d.proposal;
                return (
                  <tr key={d.subjectKey} className="border-t border-gray-100 align-top">
                    <td className="px-4 py-2 text-gray-700 whitespace-nowrap">{p.pipeline}</td>
                    <td className="px-4 py-2 text-gray-900">{p.stage}</td>
                    <td className="px-4 py-2 tabular-nums whitespace-nowrap">
                      <div className="text-gray-900">{num(p.deals)}</div>
                      {p.breakdown && (
                        <div className="text-[11px] text-gray-400">
                          {num(p.breakdown.open)} פתוחות · {num(p.breakdown.won)} זכייה · {num(p.breakdown.lost)} אבודות
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span className="inline-block px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 font-medium">{p.targetStageLabel}</span>
                    </td>
                    <td className="px-4 py-2 text-gray-600 leading-relaxed max-w-md">{p.rule || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Rules */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-900">כללי המיגרציה</h3>
        </div>
        <ul className="divide-y divide-gray-100">
          {rules.map((d) => (
            <li key={d.subjectKey} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-[13px] font-medium text-gray-900">{d.proposal.title}</span>
                <span className="text-[13px] text-blue-700 font-semibold">{d.proposal.value}</span>
              </div>
              {d.proposal.detail && (
                <p className="text-[12px] text-gray-500 leading-relaxed mt-1">{d.proposal.detail}</p>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
