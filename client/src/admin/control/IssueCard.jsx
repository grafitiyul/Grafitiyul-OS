import { useEffect, useState } from 'react';
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
  const [showNotify, setShowNotify] = useState(false);
  const isImpact = issue.type === 'tour_change_impact';
  const needsCustomers = (issue.requirements || []).some(
    (r) => r.kind === 'customer_notification' && !['completed', 'waived'].includes(r.state),
  );
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

      {/* Part 4: requirement progress + the עדכן לקוחות flow */}
      {(issue.requirements || []).length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {issue.requirements.map((r) => (
            <RequirementChip key={r.id} req={r} />
          ))}
        </div>
      )}
      {isImpact && showNotify && (
        <NotifyPanel issue={issue} onChanged={onChanged} onClose={() => setShowNotify(false)} />
      )}

      <div className="mt-2.5 flex items-center gap-2 flex-wrap">
        {isImpact && needsCustomers && (
          <button
            type="button"
            onClick={() => setShowNotify((v) => !v)}
            className={`rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition ${BTN_STYLES.primary}`}
          >
            {showNotify ? 'סגור' : 'עדכן לקוחות'}
          </button>
        )}
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

const REQ_LABEL = {
  customer_notification: 'עדכון לקוחות',
  calendar_sync: 'Google Calendar',
  woo_sync: 'סנכרון אתר',
  guide_notification: 'עדכון מדריכים',
  manual_decision: 'החלטה ידנית',
};
const REQ_STATE = {
  pending: 'bg-gray-100 text-gray-500',
  in_progress: 'bg-amber-50 text-amber-700',
  completed: 'bg-green-50 text-green-700',
  failed: 'bg-red-50 text-red-700',
  waived: 'bg-gray-100 text-gray-400',
};
const REQ_STATE_HE = { pending: 'ממתין', in_progress: 'בתהליך', completed: 'הושלם', failed: 'נכשל', waived: 'נסגר ידנית' };
function RequirementChip({ req }) {
  return (
    <span className={'rounded-full px-2 py-0.5 text-[11px] font-medium ' + (REQ_STATE[req.state] || REQ_STATE.pending)}>
      {REQ_LABEL[req.kind] || req.kind}: {REQ_STATE_HE[req.state] || req.state}
    </span>
  );
}

// "עדכן לקוחות" — recipients + editable message (email/WhatsApp) with per-recipient
// status + retry, plus manual-handle (note required). Reuses the server notify
// flow (existing email/WhatsApp pipelines).
function NotifyPanel({ issue, onChanged, onClose }) {
  const [detail, setDetail] = useState(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [channels, setChannels] = useState(['email']);
  const [picked, setPicked] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function load() {
    try {
      const d = await api.control.issueDetail(issue.id);
      setDetail(d);
      setSubject(d.defaultMessage?.subject || '');
      setBody(d.defaultMessage?.body || '');
      setPicked(new Set((d.recipients || []).map((r) => r.recipientKey)));
    } catch (e) {
      setErr(e.message);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue.id]);

  const cn = (detail?.requirements || []).find((r) => r.kind === 'customer_notification');
  const notifByKey = new Map((cn?.notifications || []).map((n) => [`${n.recipientKey}:${n.channel}`, n]));

  async function send() {
    setBusy(true);
    setErr(null);
    try {
      await api.control.notify(issue.id, { subject, body, channels, recipientKeys: [...picked] });
      await load();
      onChanged?.();
    } catch (e) {
      setErr(e.payload?.error || e.message);
    } finally {
      setBusy(false);
    }
  }
  async function retry() {
    setBusy(true);
    try {
      await api.control.notifyRetry(issue.id);
      await load();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }
  async function markHandled() {
    const note = window.prompt('הערה חובה לסגירה ידנית (מה נעשה):');
    if (!note || !note.trim()) return;
    if (!cn) return;
    setBusy(true);
    try {
      await api.control.resolveRequirement(issue.id, cn.id, { state: 'completed', note, manual: true });
      await load();
      onChanged?.();
    } catch (e) {
      setErr(e.payload?.error === 'note_required' ? 'נדרשת הערה.' : e.message);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (k, set, val) => {
    const next = new Set(set);
    next.has(val) ? next.delete(val) : next.add(val);
    k(next);
  };

  return (
    <div className="mt-2 rounded-xl border border-blue-200 bg-blue-50/40 p-3">
      {err && <div className="mb-2 rounded bg-red-50 px-2 py-1 text-[12px] text-red-700">{err}</div>}
      {!detail ? (
        <div className="text-[12px] text-gray-400">טוען…</div>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap gap-2 text-[12px]">
            {['email', 'whatsapp'].map((ch) => (
              <label key={ch} className="flex items-center gap-1">
                <input type="checkbox" checked={channels.includes(ch)} onChange={() => toggle(setChannels, channels, ch)} />
                {ch === 'email' ? 'אימייל' : 'וואטסאפ'}
              </label>
            ))}
          </div>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="נושא"
            className="mb-1.5 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-[13px]"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-[13px]"
          />
          <div className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
            {(detail.recipients || []).map((r) => (
              <div key={r.recipientKey} className="flex flex-wrap items-center gap-2 px-2.5 py-1.5 text-[12px]">
                <input type="checkbox" checked={picked.has(r.recipientKey)} onChange={() => toggle(setPicked, picked, r.recipientKey)} />
                <span className="font-medium text-gray-700">{r.name || 'לקוח'}</span>
                <span className="text-gray-400" dir="ltr">{r.email || '—'}{r.phone ? ' · ' + r.phone : ''}</span>
                <span className="ms-auto flex gap-1">
                  {channels.map((ch) => {
                    const n = notifByKey.get(`${r.recipientKey}:${ch}`);
                    const cls = n?.status === 'sent' ? 'text-green-600' : n?.status === 'failed' ? 'text-red-600' : 'text-gray-300';
                    return <span key={ch} className={cls} title={`${ch}: ${n?.status || 'טרם'}`}>{ch === 'email' ? '✉' : '💬'}</span>;
                  })}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy || !picked.size} onClick={send} className={`rounded-lg border px-3 py-1.5 text-[12.5px] font-medium ${BTN_STYLES.primary} disabled:opacity-50`}>
              {busy ? '…' : 'שלח'}
            </button>
            {(cn?.notifications || []).some((n) => n.status === 'failed') && (
              <button type="button" disabled={busy} onClick={retry} className={`rounded-lg border px-3 py-1.5 text-[12.5px] font-medium ${BTN_STYLES.default}`}>
                נסה שוב כשלים
              </button>
            )}
            <button type="button" disabled={busy} onClick={markHandled} className="text-[12px] text-gray-500 hover:text-gray-700">
              סמן כטופל ידנית
            </button>
            <button type="button" onClick={onClose} className="ms-auto text-[12px] text-gray-400 hover:text-gray-600">סגור</button>
          </div>
        </>
      )}
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
