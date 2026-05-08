import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useOutletContext } from 'react-router-dom';
import { api } from '../../../lib/api.js';
import { relativeHebrew } from '../../../lib/relativeTime.js';
import { titleToPlain } from '../../../editor/TitleEditor.jsx';
import Dialog from '../../common/Dialog.jsx';
import ConfirmDialog from '../../common/ConfirmDialog.jsx';

// Admin approval detail. Loads the review payload for one attempt, which
// includes every question with its full version history and the content
// nodes that precede it. Per-question approve / reject controls only.
// When every question's latest version becomes 'approved', the server
// promotes the attempt to 'approved' on its own.
export default function ApprovalDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const outletContext = useOutletContext() || {};
  const refreshList = outletContext.refresh;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Reset/delete state. Lives here at the page level so the modal
  // survives intermediate re-renders.
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState(null);

  async function performReset() {
    if (resetting) return;
    setResetError(null);
    setResetting(true);
    try {
      await api.attempts.remove(id);
      await refreshList?.();
      // The attempt is gone — leave the detail view.
      navigate('/admin/procedures/approvals', { replace: true });
    } catch (e) {
      setResetError(e?.message || 'איפוס נכשל');
      setResetting(false);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await api.reviews.get(id);
      setData(d);
    } catch (e) {
      setError(e.message || 'שגיאה');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // The server review payload returns each block as `{ step, node, ... }`
  // where `node` is an alias for `step` and carries `stepId` (NOT `id`).
  // Calling these with `node.id` (undefined) hit /questions/undefined/...
  // and quietly 404'd, which is why approve/reject "did nothing". The
  // URL param is still legacy-named `flowNodeId` server-side; the value
  // we send is a stepId, which the handler treats as such.
  async function approve(stepId) {
    await api.reviews.approveQuestion(id, stepId);
    await load();
    await refreshList?.();
  }

  async function reject(stepId, comment) {
    await api.reviews.rejectQuestion(id, stepId, comment);
    await load();
    await refreshList?.();
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-gray-500">
        טוען…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <div className="text-red-600 mb-2">שגיאה בטעינה</div>
          <div className="text-xs text-gray-500 mb-3 font-mono" dir="ltr">
            {error}
          </div>
          <button
            onClick={load}
            className="text-sm border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-50"
          >
            נסה שוב
          </button>
        </div>
      </div>
    );
  }
  if (!data) return null;

  const { attempt, flow, blocks } = data;
  const total = blocks.length;
  const approved = blocks.filter((b) => b.latest?.status === 'approved').length;
  const rejected = blocks.filter((b) => b.latest?.status === 'rejected').length;
  const pending = total - approved - rejected;

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-5 py-3 shrink-0">
        <div className="flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-0.5">
              אישור תשובות
            </div>
            <h1 className="text-xl font-semibold text-gray-900 truncate">
              {attempt.learnerName}
            </h1>
            <div className="text-sm text-gray-600 mt-0.5 truncate">
              זרימה: {flow.title}
            </div>
            <div className="text-[12px] text-gray-500 mt-1">
              הוגש {attempt.submittedAt ? relativeHebrew(attempt.submittedAt) : '—'}
            </div>
          </div>
          <div className="shrink-0 flex flex-col items-end gap-2">
            <AttemptStatusBadge status={attempt.status} />
            <button
              type="button"
              onClick={() => setResetOpen(true)}
              className="text-[12px] text-red-700 border border-red-200 hover:bg-red-50 rounded px-2 py-0.5"
              title="אפס ניסיון — ימחק את הניסיון והתשובות, המדריך יוכל להתחיל מחדש"
            >
              ⟲ אפס ניסיון
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
          <Chip color="gray">{total} שאלות</Chip>
          {approved > 0 && <Chip color="green">{approved} אושרו</Chip>}
          {rejected > 0 && <Chip color="red">{rejected} נדחו</Chip>}
          {pending > 0 && <Chip color="amber">{pending} ממתינות</Chip>}
        </div>
      </header>

      <ConfirmDialog
        open={resetOpen}
        title="איפוס ניסיון"
        body={
          <div className="space-y-3 text-sm text-gray-800">
            <div>
              איפוס ימחק לצמיתות את הניסיון של <b>{attempt.learnerName}</b> עבור
              הזרימה <b>{flow.title}</b>, כולל כל התשובות וההיסטוריה. המדריך יוכל
              להתחיל את הזרימה מחדש מתוך הפורטל שלו.
            </div>
            {resetError && (
              <div className="bg-red-50 border border-red-200 text-red-800 rounded p-2 text-[13px]">
                {resetError}
              </div>
            )}
            {resetting && (
              <div className="text-[12px] text-gray-500">מבצע איפוס בשרת…</div>
            )}
          </div>
        }
        confirmLabel={resetting ? 'מאפס…' : 'אפס ניסיון'}
        cancelLabel="ביטול"
        danger
        onCancel={() => {
          if (resetting) return;
          setResetOpen(false);
          setResetError(null);
        }}
        onConfirm={performReset}
      />

      {attempt.status === 'approved' && (
        <div className="bg-green-50 border-b border-green-200 px-5 py-3 text-sm text-green-900 flex items-center gap-2">
          <span>✓</span>
          <span className="font-medium">הניסיון אושר במלואו</span>
          <span className="text-green-700">
            — {attempt.approvedAt ? relativeHebrew(attempt.approvedAt) : ''}
          </span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-5 py-5">
        {blocks.length === 0 && (
          <div className="text-center text-gray-500 py-12">
            אין שאלות בזרימה זו.
          </div>
        )}
        <div className="space-y-4 max-w-3xl">
          {blocks.map((b) => {
            // `b.step` is the canonical identity (server returns
            // `step` and a `node` alias of the same object). stepId
            // exists for both real flow nodes and folderRef-derived
            // synthetic steps; .id does NOT.
            const stepId = b.step?.stepId || b.node?.stepId;
            return (
              <QuestionBlock
                key={stepId}
                block={b}
                readOnly={attempt.status === 'approved'}
                onApprove={() => approve(stepId)}
                onReject={(comment) => reject(stepId, comment)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AttemptStatusBadge({ status }) {
  const map = {
    in_progress: { label: 'בתהליך', cls: 'bg-gray-100 text-gray-700 border-gray-200' },
    submitted: { label: 'הוגש לבדיקה', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
    approved: { label: 'אושר', cls: 'bg-green-100 text-green-800 border-green-200' },
  };
  const m = map[status] || map.in_progress;
  return (
    <span
      className={`shrink-0 text-[12px] font-medium border rounded-full px-3 py-1 ${m.cls}`}
    >
      {m.label}
    </span>
  );
}

function Chip({ children, color }) {
  const cls = {
    gray: 'bg-gray-100 text-gray-700 border-gray-200',
    green: 'bg-green-100 text-green-800 border-green-200',
    red: 'bg-red-100 text-red-800 border-red-200',
    amber: 'bg-amber-100 text-amber-800 border-amber-200',
  }[color];
  return (
    <span className={`inline-flex items-center border rounded-full px-2 py-0.5 ${cls}`}>
      {children}
    </span>
  );
}

function QuestionBlock({ block, readOnly, onApprove, onReject }) {
  const { node, precedingContent, history, latest } = block;
  const qi = node.questionItem;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectComment, setRejectComment] = useState(latest?.adminComment || '');
  const [busy, setBusy] = useState(false);
  // Inline action error — the previous try/finally swallowed failures
  // silently, which is exactly how the "approve does nothing" bug went
  // unseen for a slice. Anything that throws is now surfaced.
  const [actionError, setActionError] = useState(null);

  const status = latest?.status || 'pending';
  const statusCls = {
    pending: 'bg-amber-50 border-amber-200',
    approved: 'bg-green-50 border-green-200',
    rejected: 'bg-red-50 border-red-200',
  }[status];

  function describeError(e) {
    return (
      e?.payload?.error || e?.message || 'הפעולה נכשלה'
    );
  }

  async function doApprove() {
    setBusy(true);
    setActionError(null);
    try {
      await onApprove();
    } catch (e) {
      setActionError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function doReject() {
    if (!rejectComment.trim()) return;
    setBusy(true);
    setActionError(null);
    try {
      await onReject(rejectComment.trim());
      setRejectOpen(false);
    } catch (e) {
      setActionError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      {precedingContent.length > 0 && (
        <details className="border-b border-gray-100 group">
          <summary className="list-none cursor-pointer px-5 py-3 text-[12px] text-gray-600 hover:bg-gray-50 flex items-center gap-2">
            <span className="text-gray-400 transition group-open:rotate-90">▸</span>
            <span>תוכן שקדם לשאלה ({precedingContent.length})</span>
          </summary>
          <div className="px-5 pb-4 space-y-3">
            {precedingContent.map((c) => (
              <div key={c.id} className="bg-gray-50 rounded p-3">
                <div className="text-sm font-medium text-gray-800 mb-1">
                  {/* Titles are TipTap HTML — strip tags for display.
                      Body below stays rich via dangerouslySetInnerHTML. */}
                  {titleToPlain(c.contentItem?.title || '') || 'ללא כותרת'}
                </div>
                <div
                  className="gos-prose text-sm text-gray-700"
                  dangerouslySetInnerHTML={{ __html: c.contentItem?.body || '' }}
                />
              </div>
            ))}
          </div>
        </details>
      )}

      <div className="px-5 py-4 border-b border-gray-100">
        <h3 className="font-semibold text-base text-gray-900 mb-1">
          {/* Question titles are TipTap HTML; strip tags so the
              admin sees clean text instead of "<p>...</p>". The
              questionText body below remains rich. */}
          {titleToPlain(qi?.title || '') || 'ללא כותרת'}
        </h3>
        <div
          className="gos-prose text-sm text-gray-700"
          dangerouslySetInnerHTML={{ __html: qi?.questionText || '' }}
        />
      </div>

      <div className={`px-5 py-4 border-t ${statusCls}`}>
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="text-[11px] text-gray-600 uppercase tracking-wide">
            תשובה אחרונה {latest ? `(גרסה ${latest.version})` : ''}
          </div>
          <LatestStatusBadge status={status} />
        </div>
        {latest ? (
          <div className="text-gray-900 text-sm whitespace-pre-wrap">
            {latest.answerLabel || latest.answerChoice || latest.openText || '(ריק)'}
          </div>
        ) : (
          <div className="text-sm text-gray-500 italic">אין תשובה עדיין</div>
        )}
        {latest?.adminComment && status === 'rejected' && (
          <div className="mt-3 bg-white border border-red-200 rounded p-3">
            <div className="text-[11px] text-red-700 uppercase tracking-wide mb-1 font-semibold">
              הערת דחייה
            </div>
            <div className="text-sm text-red-900 whitespace-pre-wrap">
              {latest.adminComment}
            </div>
          </div>
        )}
      </div>

      {history.length > 1 && (
        <div className="px-5 py-2 border-t border-gray-100 text-[12px]">
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            className="text-blue-700 hover:underline"
          >
            {historyOpen
              ? 'הסתר היסטוריה'
              : `הצג היסטוריה (${history.length - 1} גרסאות קודמות)`}
          </button>
          {historyOpen && (
            <ul className="mt-2 space-y-2">
              {[...history].reverse().slice(1).map((h) => (
                <li
                  key={h.id}
                  className="bg-gray-50 border border-gray-200 rounded p-3"
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-[11px] text-gray-500">
                      גרסה {h.version} • {relativeHebrew(h.createdAt)}
                    </div>
                    <LatestStatusBadge status={h.status} small />
                  </div>
                  <div className="text-sm text-gray-800 whitespace-pre-wrap">
                    {h.answerLabel || h.answerChoice || h.openText || '(ריק)'}
                  </div>
                  {h.adminComment && (
                    <div className="mt-2 text-xs text-red-700">
                      הערה: {h.adminComment}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!readOnly && latest && (
        <>
          {actionError && (
            <div className="px-5 pt-3 bg-white">
              <div className="bg-red-50 border border-red-200 text-red-800 rounded p-2 text-[13px]">
                {actionError}
              </div>
            </div>
          )}
          <div className="px-5 py-3 border-t border-gray-100 bg-white flex items-center gap-2">
            <button
              disabled={busy || status === 'approved'}
              onClick={doApprove}
              className="flex-1 sm:flex-none px-4 py-2 rounded-md text-sm font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-40"
            >
              {busy && status !== 'rejected' ? 'מאשר…' : 'אישור'}
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setRejectComment(latest?.adminComment || '');
                setActionError(null);
                setRejectOpen(true);
              }}
              className="flex-1 sm:flex-none px-4 py-2 rounded-md text-sm font-medium border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-40"
            >
              {status === 'rejected' ? 'עדכן הערת דחייה' : 'דחייה'}
            </button>
          </div>
        </>
      )}

      <Dialog
        open={rejectOpen}
        onClose={() => {
          if (busy) return;
          setRejectOpen(false);
          setActionError(null);
        }}
        title="דחיית תשובה"
        size="md"
        footer={
          <>
            <button
              onClick={() => {
                if (busy) return;
                setRejectOpen(false);
                setActionError(null);
              }}
              className="text-sm border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-50"
            >
              ביטול
            </button>
            <button
              onClick={doReject}
              disabled={!rejectComment.trim() || busy}
              className="text-sm bg-red-600 text-white rounded px-3 py-1.5 hover:bg-red-700 disabled:opacity-40"
            >
              {busy ? 'שומר…' : 'דחה ושלח לתיקון'}
            </button>
          </>
        }
      >
        <div className="space-y-2">
          <div className="text-sm text-gray-700">
            הוסף הערה לעובד — הסבר למה התשובה צריכה עדכון. ההערה תוצג לו במסך התיקון.
          </div>
          <textarea
            autoFocus
            value={rejectComment}
            onChange={(e) => setRejectComment(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2 h-32 text-sm focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400"
            placeholder="לדוגמה: חסר הסבר לגבי..."
          />
          {actionError && (
            <div className="bg-red-50 border border-red-200 text-red-800 rounded p-2 text-[13px]">
              {actionError}
            </div>
          )}
        </div>
      </Dialog>
    </div>
  );
}

function LatestStatusBadge({ status, small }) {
  const map = {
    pending: { label: 'ממתין', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
    approved: { label: 'אושר', cls: 'bg-green-100 text-green-800 border-green-200' },
    rejected: { label: 'נדחה', cls: 'bg-red-100 text-red-800 border-red-200' },
  };
  const m = map[status] || map.pending;
  const sizeCls = small ? 'text-[10px] px-1.5 py-0' : 'text-[11px] px-2 py-0.5';
  return (
    <span
      className={`inline-flex items-center border rounded-full ${sizeCls} ${m.cls}`}
    >
      {m.label}
    </span>
  );
}
