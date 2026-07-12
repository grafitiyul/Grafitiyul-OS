import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { MODULE_LABELS, SEVERITY_BY_KEY, entityHref, fmtDetected } from './config.js';
import { apiActionHandler } from './issueActions.js';

const BTN_STYLES = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700 border-transparent',
  danger: 'bg-white text-red-600 border-red-300 hover:bg-red-50',
  default: 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50',
};

// One operational issue card — severity stripe, title + module chip + detected
// time, explanation, optional diff table, and the server-declared actions.
export default function IssueCard({ issue, onChanged, onNeedsInput }) {
  const navigate = useNavigate();
  const sev = SEVERITY_BY_KEY[issue.severity] || SEVERITY_BY_KEY.info;
  const [busyKey, setBusyKey] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [showDiffs, setShowDiffs] = useState(false);
  const diffs = Array.isArray(issue.data?.diffs) ? issue.data.diffs : null;
  const acknowledged = issue.status === 'acknowledged';

  async function runAction(action) {
    setError(null);
    setNotice(null);
    if (action.kind === 'link') {
      const href = entityHref(action.target);
      if (href) navigate(href);
      return;
    }
    if (action.confirm && !window.confirm(action.confirm)) return;
    setBusyKey(action.key);
    try {
      if (action.kind === 'server') {
        const res = await api.control.action(issue.id, action.key);
        if (res?.message) setNotice(res.message);
      } else if (action.kind === 'api') {
        const handler = apiActionHandler(issue.type, action.key);
        if (!handler) throw new Error('פעולה לא מוכרת');
        const result = await handler(issue);
        if (result?.needsInput) {
          setBusyKey(null);
          onNeedsInput?.(issue, action, result.needsInput);
          return;
        }
        await api.control.recheck(issue.id).catch(() => {});
      }
      onChanged?.();
    } catch (e) {
      setError(e?.payload?.error ? actionErrorHe(e.payload.error) : e.message);
    } finally {
      setBusyKey(null);
    }
  }

  async function toggleAcknowledge() {
    setError(null);
    try {
      if (acknowledged) await api.control.unacknowledge(issue.id);
      else await api.control.acknowledge(issue.id);
      onChanged?.();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div
      className={`rounded-xl border border-gray-200 bg-white border-s-4 ${sev.stripe} px-4 py-3 ${
        acknowledged ? 'opacity-60' : ''
      }`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`inline-block w-2 h-2 rounded-full ${sev.dot}`} />
        <span className="font-semibold text-gray-900 text-[14px]">{issue.title}</span>
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${sev.chip}`}>
          {MODULE_LABELS[issue.sourceModule] || issue.sourceModule}
        </span>
        <span className="ms-auto text-[12px] text-gray-400" title={new Date(issue.detectedAt).toLocaleString('he-IL')}>
          {fmtDetected(issue.detectedAt)}
        </span>
      </div>
      <p className="mt-1.5 text-[13px] text-gray-600 leading-relaxed whitespace-pre-line">{issue.explanation}</p>

      {diffs && showDiffs && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-[12.5px] border border-gray-200 rounded-lg overflow-hidden">
            <thead>
              <tr className="bg-gray-50 text-gray-500">
                <th className="text-right font-medium px-3 py-1.5">שדה</th>
                <th className="text-right font-medium px-3 py-1.5">בדיל (רצוי)</th>
                <th className="text-right font-medium px-3 py-1.5">בסיור (בפועל)</th>
              </tr>
            </thead>
            <tbody>
              {diffs.map((d) => (
                <tr key={d.field} className="border-t border-gray-100">
                  <td className="px-3 py-1.5 text-gray-700 font-medium">{d.labelHe}</td>
                  <td className="px-3 py-1.5 text-gray-900">{d.dealDisplay ?? '—'}</td>
                  <td className="px-3 py-1.5 text-gray-500">{d.tourDisplay ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && (
        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[12.5px] text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[12.5px] text-emerald-700">
          {notice}
        </div>
      )}

      <div className="mt-2.5 flex items-center gap-2 flex-wrap">
        {diffs && (
          <button
            type="button"
            onClick={() => setShowDiffs((v) => !v)}
            className={`rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition ${BTN_STYLES.default}`}
          >
            {showDiffs ? 'הסתר הבדלים' : 'הצג הבדלים'}
          </button>
        )}
        {(issue.actions || []).map((action) => (
          <button
            key={action.key}
            type="button"
            disabled={busyKey !== null}
            onClick={() => runAction(action)}
            className={`rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition disabled:opacity-50 ${
              BTN_STYLES[action.style] || BTN_STYLES.default
            }`}
          >
            {busyKey === action.key ? '…' : action.label}
          </button>
        ))}
        <button
          type="button"
          onClick={toggleAcknowledge}
          className="ms-auto text-[12px] text-gray-400 hover:text-gray-600 transition"
        >
          {acknowledged ? 'החזר לרשימה' : 'השתק'}
        </button>
      </div>
    </div>
  );
}

function actionErrorHe(code) {
  const MAP = {
    tour_still_cancelled: 'הסיור עדיין מבוטל — אין סיור פעיל להתחבר אליו.',
    gallery_missing: 'הגלריה כבר לא קיימת.',
    gallery_empty: 'אין מדיה בגלריה.',
    not_cancellable: 'ההודעה כבר לא במצב שניתן לבטל.',
    not_editable: 'ההודעה כבר לא במצב שניתן לערוך.',
    already_resolved: 'הבעיה כבר טופלה.',
    action_failed: 'הפעולה נכשלה.',
  };
  return MAP[code] || `הפעולה נכשלה (${code})`;
}
