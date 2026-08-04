import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { usePortalLanguage } from './PortalLanguage.jsx';

// נהלים — the procedures task feed, a page inside the portal shell
// (hamburger → נהלים). The feed logic (5-bucket model, correction-priority
// gate, silent polling) moved VERBATIM from the old single-page GuidePortal;
// the shell owns the header, token persistence and 404/403 gating.
//
// LANGUAGE: every word on this screen comes from the ONE portal registry. The
// procedure TITLES and the reviewer's rejection comments are authored content
// (Flow.title / FlowAnswer.adminComment are single-language columns — there is
// no English source in the schema) and are shown exactly as written.

export default function ProceduresPage() {
  const { token } = useOutletContext();
  const { t, rtl } = usePortalLanguage();
  const navigate = useNavigate();

  const [state, setState] = useState({ phase: 'loading' });
  const [startingId, setStartingId] = useState(null);
  const [startError, setStartError] = useState(null);
  // Correction-priority gate — see CorrectionPrompt below.
  const [correctionPrompt, setCorrectionPrompt] = useState(null);

  // Two load modes: loud (mount/retry) vs silent (poll/focus) — silent keeps
  // the last good data so scroll position and mid-tap state survive.
  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setState({ phase: 'loading' });
      try {
        const res = await fetch(`/api/portal/${encodeURIComponent(token)}`, {
          cache: 'no-store',
        });
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`HTTP ${res.status} ${txt}`);
        }
        const data = await res.json();
        setState((prev) =>
          silent && prev.phase !== 'ready' ? prev : { phase: 'ready', data },
        );
      } catch (e) {
        if (!silent) {
          setState({ phase: 'error', message: e?.message || 'network_error' });
        }
        // Silent failure on background refresh: keep showing the last
        // good data, the next poll will retry.
      }
    },
    [token],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Soft polling so admin reviews / new published flows surface
  // automatically; refresh on focus/visibility too.
  useEffect(() => {
    if (!token) return undefined;
    const timer = setInterval(() => load({ silent: true }), 15000);
    const onVis = () => {
      if (document.visibilityState === 'visible') load({ silent: true });
    };
    const onFocus = () => load({ silent: true });
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
    };
  }, [token, load]);

  const startTask = useCallback(
    async (task, { correctionMode = false } = {}) => {
      if (startingId) return;
      setStartError(null);
      setStartingId(task.id);
      try {
        const res = await fetch(
          `/api/portal/${encodeURIComponent(token)}/tasks/${encodeURIComponent(task.id)}/start`,
          { method: 'POST', cache: 'no-store' },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { attemptId } = await res.json();
        if (!attemptId) throw new Error('missing_attempt_id');
        if (correctionMode) {
          // Tab-scoped flag — the runtime reads it on first load, jumps
          // to the first rejected step, then clears it.
          try {
            sessionStorage.setItem(`gos.enterCorrection.${attemptId}`, '1');
          } catch {
            /* private mode — runtime falls back to natural rendering */
          }
        }
        navigate(`/attempt/${attemptId}?p=${encodeURIComponent(token)}`);
      } catch (e) {
        setStartError(e?.message || t.procedures.openError);
        setStartingId(null);
      }
    },
    [token, navigate, startingId, t],
  );

  const handleOpen = useCallback(
    async (task) => {
      if (task.type !== 'procedure') return;
      if (startingId) return; // double-tap guard
      // Corrections take priority over normal continuation.
      const rejectedCount = task.metadata?.rejectedCount || 0;
      if (rejectedCount > 0) {
        setCorrectionPrompt({ task, rejectedCount });
        return;
      }
      startTask(task, { correctionMode: false });
    },
    [startingId, startTask],
  );

  if (state.phase === 'loading') {
    return <div className="py-10 text-center text-sm text-gray-500">{t.common.loading}</div>;
  }
  if (state.phase === 'error') {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
        <div className="mb-1 text-base font-semibold text-gray-800">{t.procedures.errorTitle}</div>
        <div className="mb-2 text-[12px] font-mono text-gray-400" dir="ltr">
          {state.message}
        </div>
        <button
          type="button"
          onClick={() => load()}
          className="mt-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 active:bg-gray-100"
        >
          {t.common.retry}
        </button>
      </div>
    );
  }

  const tasks = Array.isArray(state.data?.tasks) ? state.data.tasks : [];
  return (
    <div>
      <h1 className="mb-3 px-1 text-[17px] font-bold text-gray-900">{t.procedures.title}</h1>
      {startError && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          {startError}
        </div>
      )}
      <PortalSummary tasks={tasks} />
      <Sections tasks={tasks} startingId={startingId} onOpen={handleOpen} rtl={rtl} />
      {correctionPrompt && (
        <CorrectionPrompt
          task={correctionPrompt.task}
          rejectedCount={correctionPrompt.rejectedCount}
          starting={startingId === correctionPrompt.task.id}
          onCancel={() => setCorrectionPrompt(null)}
          onConfirm={() => {
            const task = correctionPrompt.task;
            setCorrectionPrompt(null);
            startTask(task, { correctionMode: true });
          }}
          onSkip={() => {
            const task = correctionPrompt.task;
            setCorrectionPrompt(null);
            startTask(task, { correctionMode: false });
          }}
        />
      )}
    </div>
  );
}

// ── CorrectionPrompt ──────────────────────────────────────────────
//
// Bottom sheet (mobile) / centered modal (desktop) shown when the guide taps
// "continue" on a procedure that has rejected answers.
function CorrectionPrompt({ task, rejectedCount, starting, onCancel, onConfirm, onSkip }) {
  const { t, dir, rtl } = usePortalLanguage();
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      dir={dir}
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div
        className="bg-white w-full sm:max-w-md rounded-t-xl sm:rounded-xl shadow-xl border border-gray-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-4 pb-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-red-100 text-red-700 text-base">
              ⚠
            </span>
            <h2 className="text-base font-semibold text-gray-900 flex-1">
              {t.procedures.promptTitle}
            </h2>
            <button
              type="button"
              onClick={onCancel}
              disabled={starting}
              aria-label={t.common.close}
              className="text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded p-1"
            >
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden>
                <path
                  d="M3 3l10 10M13 3L3 13"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
          <div className="text-sm text-gray-700 leading-snug mb-2">
            {t.procedures.promptBody(
              task.title || t.procedures.promptThisProcedure,
              rejectedCount,
            )}
          </div>
          <div className="text-[12px] text-gray-600">{t.procedures.promptNote}</div>
        </div>
        <div className="px-5 py-3 border-t border-gray-200 flex flex-col-reverse sm:flex-row sm:items-center gap-2">
          <button
            type="button"
            onClick={onSkip}
            disabled={starting}
            className="w-full sm:w-auto px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-md disabled:opacity-40"
          >
            {t.procedures.promptSkip}
          </button>
          <div className="hidden sm:block flex-1" />
          <button
            type="button"
            onClick={onConfirm}
            disabled={starting}
            className="w-full sm:w-auto px-5 py-2.5 text-sm font-semibold bg-red-600 hover:bg-red-700 text-white rounded-md inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
          >
            {starting ? t.common.opening : t.procedures.promptConfirm}
            {!starting && <ChevronForward rtl={rtl} />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Section grouping (5-bucket model) ─────────────────────────────
// Order and accent are structure; the words come from the registry.
const SECTION_KEYS = ['correction', 'todo', 'available', 'pending_review', 'approved'];
const SECTION_ACCENT = { correction: 'red' };

// Legacy-server-compatibility shim (old 3-bucket model → 5 buckets). The badge
// is matched on its stable KEY; `label` is legacy wire text and is only used
// when an older server ships no key.
function resolveBucket(task) {
  const b = task.bucket;
  if (b === 'todo' && task.badge?.tone === 'warning') return 'correction';
  if (b === 'done') {
    const isPending =
      task.badge?.key === 'pending_review' || task.badge?.label === 'ממתין לאישור';
    return isPending ? 'pending_review' : 'approved';
  }
  if (SECTION_KEYS.includes(b)) return b;
  return 'todo';
}

// Compact 3-pill summary above the task list (procedure-level counts).
function PortalSummary({ tasks }) {
  const { t } = usePortalLanguage();
  let pending = 0;
  let approved = 0;
  let correction = 0;
  for (const task of tasks) {
    const b = resolveBucket(task);
    if (b === 'pending_review') pending += 1;
    else if (b === 'approved') approved += 1;
    else if (b === 'correction') correction += 1;
  }
  if (pending + approved + correction === 0) return null;
  return (
    <div
      className="mb-4 flex items-center gap-1.5 text-[12px] font-medium text-gray-700 bg-white border border-gray-200 rounded-md px-2.5 py-2 shadow-sm"
      role="status"
      aria-label={t.procedures.summaryAria}
    >
      <span className="text-[10px] uppercase tracking-wide text-gray-500">
        {t.procedures.summaryLabel}
      </span>
      <span className="flex-1" />
      <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-900 rounded-full px-2 py-0.5">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" aria-hidden />
        {t.procedures.summaryPending} {pending}
      </span>
      <span className="inline-flex items-center gap-1 bg-green-100 text-green-900 rounded-full px-2 py-0.5">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500" aria-hidden />
        {t.procedures.summaryApproved} {approved}
      </span>
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
          correction > 0 ? 'bg-red-100 text-red-900' : 'bg-gray-100 text-gray-600'
        }`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${correction > 0 ? 'bg-red-500' : 'bg-gray-400'}`}
          aria-hidden
        />
        {t.procedures.summaryToFix} {correction}
      </span>
    </div>
  );
}

function Sections({ tasks, startingId, onOpen, rtl }) {
  const { t } = usePortalLanguage();
  const grouped = useMemo(() => {
    const out = {
      correction: [],
      todo: [],
      available: [],
      pending_review: [],
      approved: [],
    };
    for (const task of tasks) {
      const b = resolveBucket(task);
      const normalised = task.bucket === b ? task : { ...task, bucket: b };
      (out[b] || out.todo).push(normalised);
    }
    return out;
  }, [tasks]);

  const totalVisible = SECTION_KEYS.reduce((n, key) => n + (grouped[key]?.length || 0), 0);
  if (totalVisible === 0) return <EmptyState />;

  return (
    <div className="space-y-6">
      {SECTION_KEYS.map((key) => {
        const items = grouped[key];
        if (!items || items.length === 0) return null;
        const section = t.procedures.sections[key];
        const titleColor = SECTION_ACCENT[key] === 'red' ? 'text-red-800' : 'text-gray-900';
        return (
          <section key={key}>
            <div className="px-1 mb-2">
              <h2 className={`text-sm font-bold ${titleColor}`}>
                {section.title}
                <span className="ms-2 text-[11px] font-medium text-gray-500">({items.length})</span>
              </h2>
              <div className="text-[11px] text-gray-500">{section.subtitle}</div>
            </div>
            <ul className="space-y-3">
              {items.map((task) => (
                <li key={task.id}>
                  <TaskCard
                    task={task}
                    starting={startingId === task.id}
                    disabled={!!startingId && startingId !== task.id}
                    onOpen={() => onOpen(task)}
                    rtl={rtl}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

// Per-bucket card styling. Colour only — the words live in the registry.
function bucketStyle(bucket) {
  switch (bucket) {
    case 'correction':
      return {
        border: 'border-red-300 hover:border-red-400 active:bg-red-50/50',
        ring: 'bg-red-50 text-red-700 border-red-200',
        statusCls: 'bg-red-100 text-red-800',
        ctaCls: 'text-red-700',
      };
    case 'pending_review':
      return {
        border: 'border-gray-200',
        ring: 'bg-amber-50 text-amber-700 border-amber-200',
        statusCls: 'bg-amber-100 text-amber-900',
        ctaCls: 'text-gray-600',
      };
    case 'approved':
      return {
        border: 'border-gray-200',
        ring: 'bg-green-50 text-green-700 border-green-200',
        statusCls: 'bg-green-100 text-green-800',
        ctaCls: 'text-gray-600',
      };
    case 'available':
      return {
        border: 'border-gray-200 hover:border-blue-300 active:bg-blue-50/50',
        ring: 'bg-blue-50 text-blue-700 border-blue-200',
        statusCls: 'bg-gray-100 text-gray-700',
        ctaCls: 'text-blue-700',
      };
    case 'todo':
    default:
      return {
        border: 'border-gray-200 hover:border-blue-300 active:bg-blue-50/50',
        ring: 'bg-blue-50 text-blue-700 border-blue-200',
        statusCls: 'bg-blue-100 text-blue-800',
        ctaCls: 'text-blue-700',
      };
  }
}

function TaskCard({ task, starting, disabled, onOpen, rtl }) {
  const { t } = usePortalLanguage();
  const bucket = task.bucket || 'todo';
  const style = bucketStyle(bucket);
  // A never-started procedure says "start", a resumed one "continue".
  const cta =
    bucket === 'todo' && !task.metadata?.attemptId
      ? t.procedures.cta.start
      : t.procedures.cta[bucket] || t.procedures.cta.todo;
  const isCompleted = bucket === 'approved' || bucket === 'pending_review';
  const isCorrection = bucket === 'correction';
  const rejectionComment = task.metadata?.rejectionComment;
  const rejectedCount = task.metadata?.rejectedCount || 0;

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      className={`w-full ${
        rtl ? 'text-right' : 'text-left'
      } bg-white border rounded-xl p-4 sm:p-5 transition shadow-sm flex gap-3 items-start ${style.border} ${
        isCompleted ? 'opacity-95' : ''
      } ${disabled ? 'opacity-50' : ''}`}
    >
      <TaskIcon type={task.type} ring={style.ring} bucket={bucket} />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
            {t.procedures.kindNoun[task.type] || task.type}
          </span>
          {task.metadata?.mandatory && !isCompleted && (
            <span className="text-[10px] font-semibold bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded">
              {t.procedures.mandatory}
            </span>
          )}
        </div>
        {/* Authored content — single-language by schema, shown verbatim. */}
        <div className="text-base sm:text-lg font-semibold text-gray-900 leading-snug">
          {task.title || t.procedures.untitled}
        </div>
        {task.description && !isCorrection && (
          <div className="text-sm text-gray-600 mt-1 line-clamp-2">{task.description}</div>
        )}

        {isCorrection && (
          <div className="mt-2 bg-red-50 border border-red-300 rounded-md p-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-600 text-white text-[11px] font-bold">
                !
              </span>
              <span className="text-[13px] font-bold text-red-800">
                {t.procedures.correctionsRequired(rejectedCount)}
              </span>
            </div>
            {rejectionComment && (
              <div className="text-[12px] text-red-900 line-clamp-3 whitespace-pre-wrap">
                <span className="font-semibold">{t.procedures.reviewerComment}</span>
                {rejectionComment}
              </div>
            )}
          </div>
        )}

        <div className="mt-3 flex items-center justify-between">
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${style.statusCls}`}>
            {t.procedures.status[bucket] || t.procedures.status.todo}
          </span>
          {cta && (
            <span className={`text-sm font-semibold inline-flex items-center gap-1 ${style.ctaCls}`}>
              {starting ? t.common.opening : cta}
              {!starting && <ChevronForward rtl={rtl} />}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function TaskIcon({ type, ring, bucket }) {
  const glyph =
    bucket === 'correction'
      ? '⚠'
      : bucket === 'approved'
      ? '✓'
      : bucket === 'pending_review'
      ? '⏳'
      : type === 'procedure'
      ? '📋'
      : '•';
  return (
    <div
      className={`w-10 h-10 sm:w-11 sm:h-11 shrink-0 rounded-full border flex items-center justify-center text-lg ${ring}`}
      aria-hidden
    >
      {glyph}
    </div>
  );
}

function EmptyState() {
  const { t } = usePortalLanguage();
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
      <div className="text-4xl mb-3 opacity-50">📭</div>
      <div className="text-base font-semibold text-gray-800 mb-1">{t.procedures.emptyTitle}</div>
      <div className="text-sm text-gray-500">{t.procedures.emptyBody}</div>
    </div>
  );
}

// "Proceed" chevron. Direction-explicit SVG — never left to the bidi resolver:
// forward is LEFT in RTL and RIGHT in LTR.
function ChevronForward({ rtl }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden>
      <path
        d={rtl ? 'M10 4l-4 4 4 4' : 'M6 4l4 4-4 4'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
