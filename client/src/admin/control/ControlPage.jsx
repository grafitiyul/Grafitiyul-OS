import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { SEVERITIES, SEVERITY_BY_KEY, fmtDetected, MODULE_LABELS } from './config.js';
import IssueCard from './IssueCard.jsx';
import RescheduleDialog from './RescheduleDialog.jsx';
import { apiActionHandler } from './issueActions.js';

const POLL_MS = 60_000;

// בקרה — the operational control center and the admin landing page. Answers
// ONE question: "מה דורש טיפול עכשיו?" — severity counters on top, actionable
// issue cards below. Data is the canonical OperationalIssue list; issues
// resolve themselves (detector auto-resolve) or via the card actions.
export default function ControlPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [needsInput, setNeedsInput] = useState(null); // { issue, action, input }
  const timerRef = useRef(null);

  const load = useCallback(async () => {
    try {
      setData(await api.control.issues());
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    timerRef.current = setInterval(load, POLL_MS);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timerRef.current);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  const issues = data?.issues || [];
  const counts = data?.counts || { critical: 0, warning: 0, info: 0 };
  const open = issues.filter((i) => i.status === 'open');
  const acknowledged = issues.filter((i) => i.status === 'acknowledged');
  const resolvedRecent = data?.resolvedRecent || [];

  async function submitNeedsInput(payload) {
    const { issue, action } = needsInput;
    const handler = apiActionHandler(issue.type, action.key);
    if (!handler) throw new Error('פעולה לא מוכרת');
    await handler(issue, payload);
    await api.control.recheck(issue.id).catch(() => {});
    await load();
  }

  return (
    <div className="px-5 py-6 lg:px-10 lg:py-8 w-full">
      <header className="mb-6 flex items-end gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">בקרה</h1>
          <p className="text-[14px] text-gray-500 mt-1">מה דורש טיפול עכשיו?</p>
        </div>
        <button
          type="button"
          onClick={load}
          className="ms-auto rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[12.5px] text-gray-600 hover:bg-gray-50"
        >
          רענון
        </button>
      </header>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700">
          שגיאה בטעינת הבקרה: {error}
        </div>
      )}

      {/* Severity counters */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
        {SEVERITIES.map((s) => (
          <div key={s.key} className={`rounded-2xl border ${s.cardBorder} ${s.cardBg} px-5 py-4`}>
            <div className="flex items-center gap-2">
              <span className={`inline-block w-2.5 h-2.5 rounded-full ${s.dot}`} />
              <span className="text-[13px] font-medium text-gray-600">{s.countLabel}</span>
            </div>
            <div className={`mt-1 text-3xl font-bold ${s.countText}`} dir="ltr">
              {counts[s.key] ?? 0}
            </div>
          </div>
        ))}
      </div>

      {data && open.length === 0 && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-6 py-10 text-center mb-8">
          <div className="text-3xl mb-2">✅</div>
          <div className="text-[15px] font-semibold text-emerald-800">הכל תקין</div>
          <div className="text-[13px] text-emerald-700 mt-1">אין בעיות תפעוליות שדורשות טיפול כרגע.</div>
        </div>
      )}

      {/* Open issues, grouped by severity */}
      {SEVERITIES.map((s) => {
        const group = open.filter((i) => i.severity === s.key);
        if (!group.length) return null;
        return (
          <section key={s.key} className="mb-7">
            <h2 className="flex items-center gap-2 text-[13px] font-semibold text-gray-500 mb-2.5">
              <span className={`inline-block w-2 h-2 rounded-full ${s.dot}`} />
              {s.countLabel}
              <span className="text-gray-400 font-normal" dir="ltr">
                {group.length}
              </span>
            </h2>
            <div className="space-y-2.5">
              {group.map((issue) => (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  onChanged={load}
                  onNeedsInput={(iss, action, input) => setNeedsInput({ issue: iss, action, input })}
                />
              ))}
            </div>
          </section>
        );
      })}

      {/* Acknowledged (muted) issues */}
      {acknowledged.length > 0 && (
        <section className="mb-7">
          <h2 className="text-[13px] font-semibold text-gray-500 mb-2.5">
            מושתקות <span className="text-gray-400 font-normal" dir="ltr">{acknowledged.length}</span>
          </h2>
          <div className="space-y-2.5">
            {acknowledged.map((issue) => (
              <IssueCard
                key={issue.id}
                issue={issue}
                onChanged={load}
                onNeedsInput={(iss, action, input) => setNeedsInput({ issue: iss, action, input })}
              />
            ))}
          </div>
        </section>
      )}

      {/* Recently resolved — read-only trail */}
      {resolvedRecent.length > 0 && (
        <section className="mb-4">
          <h2 className="text-[13px] font-semibold text-gray-500 mb-2.5">טופלו לאחרונה</h2>
          <div className="space-y-1.5">
            {resolvedRecent.map((issue) => {
              const sev = SEVERITY_BY_KEY[issue.severity] || SEVERITY_BY_KEY.info;
              return (
                <div
                  key={issue.id}
                  className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3.5 py-2 text-[12.5px] text-gray-500 flex-wrap"
                >
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${sev.dot} opacity-50`} />
                  <span className="text-gray-600">{issue.title}</span>
                  <span className="text-gray-400">·</span>
                  <span>{MODULE_LABELS[issue.sourceModule] || issue.sourceModule}</span>
                  <span className="ms-auto text-gray-400">
                    {issue.resolvedByName ? `טופל ע״י ${issue.resolvedByName}` : 'נפתר אוטומטית'}
                    {' · '}
                    {fmtDetected(issue.resolvedAt)}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {!data && !error && <div className="py-16 text-center text-sm text-gray-400">טוען…</div>}

      <RescheduleDialog
        open={Boolean(needsInput)}
        title={needsInput?.action?.label}
        onClose={() => setNeedsInput(null)}
        onSubmit={submitNeedsInput}
      />
    </div>
  );
}
