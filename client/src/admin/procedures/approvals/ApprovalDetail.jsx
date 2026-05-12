import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useOutletContext } from 'react-router-dom';
import { api } from '../../../lib/api.js';
import { relativeHebrew } from '../../../lib/relativeTime.js';
import { titleToPlain } from '../../../editor/TitleEditor.jsx';
import { normalizeRichHtml } from '../../../editor/htmlNormalize.js';
import Dialog from '../../common/Dialog.jsx';
import ConfirmDialog from '../../common/ConfirmDialog.jsx';

// Per-attempt scroll-position key. sessionStorage so the value
// survives a tab refresh / brief navigation within the same browser
// tab, but doesn't bleed across truly-separate browser sessions where
// the saved offset would no longer be meaningful.
function scrollKey(attemptId) {
  return `gos.approval.scroll.${attemptId}`;
}

// Merge a per-block server payload with any local optimistic override.
// The override wins unless:
//   * server's latest answer is a NEWER version (correction came in;
//     the admin's pending approve/reject targeted the old version, so
//     the new pending answer takes precedence).
//   * server's latest already reports the same status (state has
//     caught up — override is redundant; let the server payload through
//     so adminComment / reviewedAt etc. stay accurate).
// The shape returned matches the server `block` so QuestionBlock
// renders identically regardless of who owns the truth right now.
function applyOverride(block, override) {
  if (!override || !block?.latest) return block;
  const sv = block.latest;
  if (sv.version > override.version) return block;
  if (sv.status === override.status) return block;
  return {
    ...block,
    latest: {
      ...sv,
      status: override.status,
      adminComment: override.adminComment ?? null,
    },
  };
}

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

  // Optimistic per-stepId overrides. Keyed by stepId; each entry is
  // `{ status: 'approved'|'rejected', adminComment, version }`.
  // Wins over server data at render time until either the server
  // payload catches up (status matches) or a newer answer version
  // appears (the learner submitted a correction after we approved /
  // rejected the previous version — in which case the override would
  // have targeted the old version and is no longer meaningful).
  const [localOverrides, setLocalOverrides] = useState({});
  // Per-stepId action errors so a failed approve/reject shows inline
  // on the right block and we can revert that override.
  const [actionErrors, setActionErrors] = useState({});

  // Generation counter. Bumped on every admin action so the periodic
  // softRefresh polling can detect when a response was overtaken by a
  // newer action mid-flight and discard the stale payload. Without
  // this the polling fetch — which uses Postgres snapshot isolation —
  // can return a snapshot taken BEFORE the approve committed, and
  // overwriting setData with that snapshot is exactly the
  // "approval reverts after a minute" bug the user reported.
  const genRef = useRef(0);

  // Scroll container ref + persistence. sessionStorage key is per-
  // attempt so switching to another person doesn't drag the old
  // scroll offset onto the new page.
  const scrollRef = useRef(null);
  const scrollRestoredRef = useRef(false);
  const scrollSaveTimerRef = useRef(null);

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

  // Two refresh modes (mirrors ApprovalsHome):
  //   * initialLoad — sets loading=true; used on first mount / id
  //     change so the user sees a clear loading state when there's
  //     genuinely no data on screen yet.
  //   * softRefresh — silent re-fetch, no loading flag, no remount.
  //     Used after approve/reject so the page doesn't collapse to
  //     "טוען…" and scroll back to the top after every click.
  const initialLoad = useCallback(async () => {
    setLoading(true);
    setError(null);
    const myGen = genRef.current;
    try {
      const d = await api.reviews.get(id);
      // Discard a stale initial load if an action superseded us (rare
      // but possible if the user clicks approve while loading).
      if (myGen !== genRef.current) return;
      setData(d);
    } catch (e) {
      setError(e.message || 'שגיאה');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const softRefresh = useCallback(async () => {
    const myGen = genRef.current;
    try {
      const d = await api.reviews.get(id);
      // Stale-response guard: if a newer admin action ran while this
      // fetch was in flight, drop the payload. The action's own
      // refetch (or the next poll tick) will land authoritative data.
      if (myGen !== genRef.current) return;
      setData(d);
      setError(null);
    } catch (e) {
      // Don't override the on-screen data on a transient failure —
      // the next action's refresh, or the side pane's polling, will
      // catch up. Log so persistent failures are diagnosable.
      console.warn('[approval detail soft refresh] failed', e);
    }
  }, [id]);

  useEffect(() => {
    // New attempt id → drop any overrides from the previous attempt,
    // reset scroll-restore guard, and let initialLoad replace the data.
    setLocalOverrides({});
    setActionErrors({});
    scrollRestoredRef.current = false;
    initialLoad();
  }, [initialLoad]);

  // Prune overrides once the server payload has caught up. Without
  // this the override would stay in place forever even after the
  // server reports the same status, and a subsequent learner
  // correction that drops version back to pending would still get
  // rendered as approved (because override.status='approved' wins).
  useEffect(() => {
    if (!data?.blocks) return;
    setLocalOverrides((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const block of data.blocks) {
        const stepId = block.step?.stepId || block.node?.stepId;
        const ov = next[stepId];
        if (!ov) continue;
        const sv = block.latest;
        if (!sv) continue;
        if (sv.version > ov.version) {
          delete next[stepId];
          changed = true;
          continue;
        }
        if (sv.status === ov.status) {
          delete next[stepId];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [data]);

  // Quiet live refresh — picks up learner activity (new corrections,
  // re-submissions) without flashing the page. softRefresh keeps the
  // user's scroll position, the open detail card, the filter pane,
  // any expanded history accordion, and any open dialogs intact
  // because it only swaps the `data` prop; React reconciles per
  // QuestionBlock via stable `key={stepId}`. Polling at 10s mirrors
  // the runtime's review-status cadence so the two sides stay
  // roughly in sync; focus/visibilitychange give an instant catch-up
  // when the admin tabs back in.
  useEffect(() => {
    if (!id) return undefined;
    const t = setInterval(softRefresh, 10000);
    const onVis = () => {
      if (document.visibilityState === 'visible') softRefresh();
    };
    const onFocus = () => softRefresh();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
    };
  }, [id, softRefresh]);

  // Look up the current latest answer for a step so the optimistic
  // override can carry the right version. If a learner submits a
  // correction AFTER our optimistic action lands but BEFORE the
  // server refresh, this version field is how the prune effect
  // recognises the override as stale.
  function latestVersionFor(stepId) {
    const block = data?.blocks?.find(
      (b) => (b.step?.stepId || b.node?.stepId) === stepId,
    );
    return block?.latest?.version ?? 0;
  }

  // Optimistic approve. Status flips instantly in the UI via the
  // local override; the API + refetch run in the background. On
  // failure the override is rolled back and an inline error is set
  // on the affected block. The generation counter ensures polling
  // softRefresh responses that started BEFORE this action are
  // discarded when they finally land.
  async function approve(stepId) {
    const version = latestVersionFor(stepId);
    genRef.current += 1;
    setLocalOverrides((prev) => ({
      ...prev,
      [stepId]: { status: 'approved', adminComment: null, version },
    }));
    setActionErrors((prev) => {
      if (!prev[stepId]) return prev;
      const next = { ...prev };
      delete next[stepId];
      return next;
    });
    try {
      await api.reviews.approveQuestion(id, stepId);
      // Background refetch picks up the authoritative state.
      // softRefresh's gen guard handles the race; the prune effect
      // clears the override once the server payload matches.
      softRefresh();
      refreshList?.();
    } catch (e) {
      setLocalOverrides((prev) => {
        const next = { ...prev };
        delete next[stepId];
        return next;
      });
      setActionErrors((prev) => ({
        ...prev,
        [stepId]: e?.payload?.error || e?.message || 'אישור נכשל',
      }));
    }
  }

  async function reject(stepId, comment) {
    const version = latestVersionFor(stepId);
    const trimmed = String(comment || '').trim();
    if (!trimmed) return;
    genRef.current += 1;
    setLocalOverrides((prev) => ({
      ...prev,
      [stepId]: {
        status: 'rejected',
        adminComment: trimmed,
        version,
      },
    }));
    setActionErrors((prev) => {
      if (!prev[stepId]) return prev;
      const next = { ...prev };
      delete next[stepId];
      return next;
    });
    try {
      await api.reviews.rejectQuestion(id, stepId, trimmed);
      softRefresh();
      refreshList?.();
    } catch (e) {
      setLocalOverrides((prev) => {
        const next = { ...prev };
        delete next[stepId];
        return next;
      });
      setActionErrors((prev) => ({
        ...prev,
        [stepId]: e?.payload?.error || e?.message || 'דחייה נכשלה',
      }));
    }
  }

  // ── Scroll persistence ──────────────────────────────────────────
  //
  // Three problems the previous implementation had:
  //
  //   1. RESTORE TIMING. A single rAF after first paint sets scrollTop
  //      while content height is still growing — images, embeds, the
  //      gos-prose body — so the browser clamps to the max available
  //      scroll at that instant (often smaller than the saved offset)
  //      and the value never recovers. Fixed below with a retry loop:
  //      re-set scrollTop each rAF until either (a) it lands on the
  //      target, or (b) the container has enough scrollHeight to do so.
  //
  //   2. STALE CLOSURE. onScroll captured `id` via useCallback's [id]
  //      dependency. When id changes mid-throttle (user navigates to
  //      another person within 200ms of scrolling) the pending
  //      setTimeout still uses the old `id` AND old scrollKey(id) —
  //      but reads scrollRef.current.scrollTop AFTER the new render,
  //      writing the NEW position to the OLD key. Fixed by holding
  //      the current id in a ref the timer reads at fire time.
  //
  //   3. NO TRANSITION FLUSH. Switching attempts (id change) doesn't
  //      unmount the component, so the `useEffect [] cleanup` never
  //      fired and the last unsaved scroll position could be lost
  //      (cleared throttle without flushing). Fixed with a per-id
  //      effect that runs cleanup on id change AND flushes scrollTop
  //      synchronously to the OLD id's sessionStorage key.
  //
  // sessionStorage is the right scope: survives tab refresh + admin-
  // page round-trips, doesn't bleed across truly-separate sessions
  // where the saved offset would no longer be meaningful.

  // Always-current id reference for the throttled save's closure.
  const idRef = useRef(id);
  useEffect(() => {
    idRef.current = id;
  }, [id]);

  const onScroll = useCallback(() => {
    if (scrollSaveTimerRef.current) return;
    scrollSaveTimerRef.current = setTimeout(() => {
      scrollSaveTimerRef.current = null;
      try {
        const el = scrollRef.current;
        if (el) {
          sessionStorage.setItem(
            scrollKey(idRef.current),
            String(el.scrollTop),
          );
        }
      } catch {
        /* ignore */
      }
    }, 200);
  }, []);

  // Per-id transition: when id changes or component unmounts, cancel
  // any pending throttled save AND write the CURRENT scrollTop
  // synchronously to the OLD id's key. This is the path that keeps
  // "scroll → quickly navigate away → come back" working.
  useEffect(() => {
    const idAtMount = id;
    return () => {
      if (scrollSaveTimerRef.current) {
        clearTimeout(scrollSaveTimerRef.current);
        scrollSaveTimerRef.current = null;
      }
      try {
        const el = scrollRef.current;
        if (el) {
          sessionStorage.setItem(
            scrollKey(idAtMount),
            String(el.scrollTop),
          );
        }
      } catch {
        /* ignore */
      }
    };
  }, [id]);

  // Restore with a retry loop. Each rAF: set scrollTop, then verify.
  // If the browser clamped us short because content is still loading,
  // try again on the next frame. Stop on hit OR after MAX_ATTEMPTS
  // (~500ms) to avoid spinning on attempts whose saved offset is
  // genuinely larger than the final scrollHeight (content shrank
  // since save — rare; ending at the bottom is acceptable).
  useEffect(() => {
    if (!data || scrollRestoredRef.current) return;
    scrollRestoredRef.current = true;

    let saved = null;
    try {
      saved = sessionStorage.getItem(scrollKey(id));
    } catch {
      saved = null;
    }
    if (saved == null) return;
    const target = Number(saved);
    if (!Number.isFinite(target) || target <= 0) return;

    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 30; // ~500ms at 60fps

    function tryRestore() {
      if (cancelled) return;
      const el = scrollRef.current;
      if (!el) {
        if (attempts++ < MAX_ATTEMPTS) requestAnimationFrame(tryRestore);
        return;
      }
      const maxScroll = el.scrollHeight - el.clientHeight;
      const aim = Math.min(target, Math.max(0, maxScroll));
      if (Math.abs(el.scrollTop - aim) > 0.5) {
        el.scrollTop = aim;
      }
      // Done when we've reached target (content fully loaded) OR
      // we've reached the current max and content can't grow further
      // this attempt.
      const reachedTarget = el.scrollTop >= target - 1;
      const atCurrentMax = aim >= maxScroll;
      if (reachedTarget) return;
      if (attempts++ >= MAX_ATTEMPTS) return;
      // Keep trying — content may still be loading and scrollHeight
      // may grow on subsequent frames.
      if (!atCurrentMax || maxScroll < target) {
        requestAnimationFrame(tryRestore);
      } else if (attempts < MAX_ATTEMPTS) {
        // We're at current max but content might still grow; keep
        // poking until we get to target or run out of attempts.
        requestAnimationFrame(tryRestore);
      }
    }

    requestAnimationFrame(tryRestore);
    return () => {
      cancelled = true;
    };
  }, [data, id]);

  // ── HOOK ORDER NOTE ─────────────────────────────────────────────
  //
  // Every hook MUST be called above the early returns below.
  // Previously `useMemo(visibleBlocks)` lived after the
  // `if (loading) / if (error) / if (!data) return …` block, which
  // broke the rules-of-hooks contract: first render (loading=true)
  // never reached the useMemo; second render (loading=false) did,
  // and React threw error #310 ("Rendered more hooks than during
  // the previous render"). The memo is now declared here, BEFORE
  // any early return, and handles the `data == null` case via the
  // `data?.blocks || []` fallback inside the memo body.
  const visibleBlocks = useMemo(() => {
    const list = data?.blocks || [];
    return list
      .filter((b) => !!b.latest)
      .map((b) => {
        const stepId = b.step?.stepId || b.node?.stepId;
        return applyOverride(b, localOverrides[stepId]);
      });
  }, [data, localOverrides]);

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
            onClick={initialLoad}
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
  // `visibleBlocks` was computed above (before the early returns) so
  // the hook order stays stable across renders. It already filters
  // out unanswered questions AND merges optimistic overrides, so
  // counts + per-block rendering both consume the same projection
  // and an in-flight approve flips chip + block in the same React
  // commit.
  const total = visibleBlocks.length;
  const approved = visibleBlocks.filter(
    (b) => b.latest?.status === 'approved',
  ).length;
  const rejected = visibleBlocks.filter(
    (b) => b.latest?.status === 'rejected',
  ).length;
  const pending = total - approved - rejected;
  const hiddenUntouched = blocks.length - visibleBlocks.length;

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

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-5 py-5"
      >
        {visibleBlocks.length === 0 && (
          <div className="text-center text-gray-500 py-12">
            {blocks.length === 0
              ? 'אין שאלות בזרימה זו.'
              : 'המדריך עדיין לא ענה על אף שאלה לבדיקה.'}
          </div>
        )}
        <div className="space-y-4 max-w-3xl">
          {visibleBlocks.map((b) => {
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
                externalError={actionErrors[stepId]}
              />
            );
          })}
          {hiddenUntouched > 0 && (
            <div className="text-[12px] text-gray-500 text-center py-2">
              {hiddenUntouched === 1
                ? 'שאלה אחת נוספת בזרימה שעדיין לא נענתה.'
                : `${hiddenUntouched} שאלות נוספות בזרימה שעדיין לא נענו.`}
            </div>
          )}
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

function QuestionBlock({ block, readOnly, onApprove, onReject, externalError }) {
  const { node, precedingContent, history, latest } = block;
  const qi = node.questionItem;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectComment, setRejectComment] = useState(latest?.adminComment || '');
  const [busy, setBusy] = useState(false);
  // Locally-raised error (e.g. validation). Combined with the parent's
  // `externalError` (raised when an optimistic approve/reject was
  // rolled back) we always show a meaningful message inline on the
  // affected block — no global toast, no other block touched.
  const [actionError, setActionError] = useState(null);
  const visibleError = actionError || externalError || null;

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
                  dangerouslySetInnerHTML={{
                    __html: normalizeRichHtml(c.contentItem?.body || ''),
                  }}
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
          dangerouslySetInnerHTML={{
            __html: normalizeRichHtml(qi?.questionText || ''),
          }}
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
          {visibleError && (
            <div className="px-5 pt-3 bg-white">
              <div className="bg-red-50 border border-red-200 text-red-800 rounded p-2 text-[13px]">
                {visibleError}
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
