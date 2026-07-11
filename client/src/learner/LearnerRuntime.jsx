import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { validateAnswer } from '../lib/questionRequirement.js';
import { titleToPlain } from '../editor/TitleEditor.jsx';
import { normalizeRichHtml } from '../editor/htmlNormalize.js';

// Entry point at /flow/:id.
//   - ?preview=1 → local in-memory run that never hits /attempts (admin preview).
//   - otherwise  → name gate; on "start", create a new attempt and redirect
//                  to /attempt/:attemptId. That route is the canonical runtime
//                  (survives tab close / refresh / direct link).
export function FlowEntry() {
  const { id: flowId } = useParams();
  const [params] = useSearchParams();
  const isPreview = params.get('preview') === '1';
  const navigate = useNavigate();

  const [flow, setFlow] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [learnerName, setLearnerName] = useState(
    () => localStorage.getItem(`gos.name.${flowId}`) || '',
  );
  const [starting, setStarting] = useState(false);
  const [startErr, setStartErr] = useState(null);
  const [isMobile, setIsMobile] = useState(() =>
    window.matchMedia('(max-width: 640px)').matches,
  );

  // Preview-only local state. The step list for preview comes from
  // /api/flows/:id/expansion so it stays consistent with what an
  // actual attempt would render — including folderRef expansions.
  const [previewSteps, setPreviewSteps] = useState(null);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [previewAnswers, setPreviewAnswers] = useState({});
  // Same per-session completion memory as AttemptRuntime, keyed by
  // step id. Resets on flow change.
  const previewCompletedStepsRef = useRef(new Set());
  useEffect(() => {
    previewCompletedStepsRef.current = new Set();
  }, [flowId]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const f = await api.flows.get(flowId);
        setFlow(f);
      } catch (e) {
        setLoadErr(e.message || 'שגיאה');
      }
    })();
  }, [flowId]);

  // For preview mode, pull the live-resolved step list from the server
  // so folderRef nodes expand correctly. We don't compute this client-
  // side anymore — it'd have to mirror the bank traversal logic and
  // we want one source of truth.
  useEffect(() => {
    if (!isPreview) return;
    (async () => {
      try {
        const e = await api.flows.expansion(flowId);
        setPreviewSteps(e.steps || []);
      } catch (err) {
        setLoadErr(err.message || 'שגיאה');
      }
    })();
  }, [isPreview, flowId]);

  async function startAttempt() {
    if (!learnerName.trim() || starting) return;
    setStarting(true);
    setStartErr(null);
    localStorage.setItem(`gos.name.${flowId}`, learnerName.trim());
    try {
      const a = await api.attempts.create(
        flowId,
        learnerName.trim(),
        learnerName.trim(),
      );
      navigate(`/attempt/${a.id}`, { replace: true });
    } catch (e) {
      setStartErr(e.message || 'שגיאה ביצירת ניסיון');
      setStarting(false);
    }
  }

  if (loadErr) {
    return (
      <Screen>
        <div className="text-center">
          <div className="text-red-600 font-medium mb-2">שגיאה בטעינת הזרימה</div>
          <div className="text-xs text-gray-500 font-mono" dir="ltr">
            {loadErr}
          </div>
        </div>
      </Screen>
    );
  }
  if (!flow) {
    return (
      <Screen>
        <div className="text-gray-500">טוען…</div>
      </Screen>
    );
  }

  if (isPreview) {
    if (previewSteps == null) {
      return (
        <Screen preview>
          <div className="text-gray-500">טוען…</div>
        </Screen>
      );
    }
    if (previewIdx >= previewSteps.length)
      return <CompletedScreen preview />;
    const currentStep = previewSteps[previewIdx];
    return (
      <ItemScreen
        node={currentStep}
        isMobile={isMobile}
        isPreview
        existingAnswer={previewAnswers[currentStep.stepId]}
        completedStepsRef={previewCompletedStepsRef}
        onNext={(answerPayload) => {
          if (answerPayload) {
            setPreviewAnswers({
              ...previewAnswers,
              [currentStep.stepId]: answerPayload,
            });
          }
          setPreviewIdx(previewIdx + 1);
        }}
        onPrev={previewIdx > 0 ? () => setPreviewIdx(previewIdx - 1) : null}
        position={{
          index: previewIdx,
          total: previewSteps.length,
          isFirst: previewIdx === 0,
          isLast: previewIdx === previewSteps.length - 1,
        }}
      />
    );
  }

  return (
    <NameGate
      isMobile={isMobile}
      flow={flow}
      name={learnerName}
      setName={setLearnerName}
      busy={starting}
      error={startErr}
      onStart={startAttempt}
    />
  );
}

// Canonical worker runtime — /attempt/:attemptId. Opening this URL restores
// whatever state the attempt is in:
//   in_progress → item screens (or submit screen at the end)
//   submitted   → waiting screen OR resubmit screen (if any rejections)
//   approved    → read-only browser
export function AttemptRuntime() {
  const { attemptId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Per-attempt session memory of which step ids have been read to
  // bottom (or are non-scrollable). Survives normal next/back nav
  // (AttemptRuntime doesn't unmount), resets on attempt change.
  const completedStepsRef = useRef(new Set());
  useEffect(() => {
    completedStepsRef.current = new Set();
  }, [attemptId]);
  // Token resolution for the runtime's home button:
  //   1. URL `?p=<token>` (RESTful, bookmark-safe — the GuidePortal
  //      always navigates with this query param).
  //   2. sessionStorage fallback — the GuidePortal stashes the token
  //      there on mount, so a user who lands on /attempt/:id WITHOUT
  //      the query (refresh, pre-slice-deploy bookmark) still gets
  //      the home button as long as they came in via the portal in
  //      this tab.
  //   3. Else null — deep-linked attempt with no portal context. The
  //      home button hides itself when href is null.
  const portalToken = readPortalToken(searchParams);

  const [attempt, setAttempt] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [navError, setNavError] = useState(null);
  // Lifted modal state so the dialog can sit at the AttemptRuntime
  // level — that lets EVERY screen (ItemScreen, SubmitScreen,
  // WaitingScreen, ResubmitScreen, ApprovedBrowser) open the same
  // dialog without re-mounting it on each transition.
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  // Lightweight per-question review snapshot. Refreshed every 10s
  // and on focus/visibility change. Kept SEPARATE from `attempt` so
  // polling doesn't remount the screen, reset scroll position, blow
  // away in-flight answer drafts, or re-trigger the step animation.
  const [reviewStatus, setReviewStatus] = useState(null);
  // Correction flow state. Three layers, all client-side only:
  //
  //   correctionConfirm — the "are you sure?" sheet shown after the
  //     guide taps a rejected row in the modal. Carries enough
  //     metadata (title, admin comment) to preview the task in-place.
  //
  //   correctionDetour  — once confirmed, this is the active
  //     correction session. While set, AttemptRuntime renders the
  //     normal ItemScreen at `currentLocalStepId` (so the guide is
  //     INSIDE the procedure, with full prev/next nav to reread
  //     content) but with correction UI overlaid on the rejected
  //     question step. `returnStepId` is where "המשך מהמקום שבו
  //     עצרתי" jumps the guide back to after submitting — could be
  //     30 steps away, the goal is "resume where I was".
  //
  //   The shape:
  //     {
  //       currentLocalStepId,    // step ItemScreen renders during correction
  //       returnStepId,          // saved bookmark for the resume button
  //       phase,                 // 'editing' | 'success'
  //       justSubmittedStepId,   // which step the user just submitted a fix for
  //     }
  //
  //   No attempt mutation: navigation during correction is purely
  //   local — the server cursor (`attempt.currentStepId`) is left
  //   alone. That means cancelling the detour or hitting the resume
  //   button is a 0-network operation and the guide is back where
  //   they were instantly.
  const [correctionConfirm, setCorrectionConfirm] = useState(null);
  const [correctionDetour, setCorrectionDetour] = useState(null);
  // One-shot guard so the portal "enter correction" hand-off is only
  // applied once per attempt load, even if attempt + reviewStatus
  // refresh after the initial mount.
  const correctionEntryRef = useRef(false);
  const [isMobile, setIsMobile] = useState(() =>
    window.matchMedia('(max-width: 640px)').matches,
  );

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const loadAttempt = useCallback(async () => {
    try {
      const a = await api.attempts.get(attemptId);
      setAttempt(a);
      setLoadErr(null);
    } catch (e) {
      setLoadErr(e.message || 'שגיאה');
    }
  }, [attemptId]);

  useEffect(() => {
    loadAttempt();
  }, [loadAttempt]);

  // ── Lightweight review-status polling ─────────────────────────────
  //
  // Token-scoped, no-store. Only fires when we know the portal token
  // (the only context where the bar/modal are useful — a deep-linked
  // attempt without a token has no portal home and no reviewer
  // narrative to surface). Polls every 10s + on focus + on
  // visibilitychange so a guide who tabs back to the runtime sees
  // fresh review state immediately, without the heavy attempt reload.
  const fetchReviewStatus = useCallback(async () => {
    if (!portalToken || !attemptId) return null;
    try {
      const res = await fetch(
        `/api/portal/${encodeURIComponent(portalToken)}/attempts/${encodeURIComponent(attemptId)}/review-status`,
        { cache: 'no-store' },
      );
      if (!res.ok) return null;
      const data = await res.json();
      setReviewStatus(data);
      return data;
    } catch (e) {
      // Silent — the bar keeps showing the last good snapshot until
      // the next successful poll. Never tear the runtime down for a
      // background fetch.
      // eslint-disable-next-line no-console
      console.warn('[review-status] fetch failed', e);
      return null;
    }
  }, [portalToken, attemptId]);

  useEffect(() => {
    if (!portalToken || !attemptId) return undefined;
    fetchReviewStatus();
    const t = setInterval(fetchReviewStatus, 10000);
    const onVis = () => {
      if (document.visibilityState === 'visible') fetchReviewStatus();
    };
    const onFocus = () => fetchReviewStatus();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
    };
  }, [portalToken, attemptId, fetchReviewStatus]);

  // ── Portal hand-off: enter correction at first rejected step ─────
  //
  // The portal home stashes `gos.enterCorrection.<attemptId>=1` in
  // sessionStorage right before navigating, when the guide tapped
  // "מעבר לתיקונים" on a procedure with rejections. We pick that
  // signal up the FIRST time both `attempt` and `reviewStatus` are
  // populated (both are needed: attempt for the steps array, review-
  // status for the authoritative rejected list). The flag is removed
  // immediately so a tab refresh doesn't re-enter correction. Later
  // changes to attempt/reviewStatus don't re-trigger because
  // `correctionEntryRef` latches.
  useEffect(() => {
    if (correctionEntryRef.current) return;
    if (!attempt || !reviewStatus) return;
    let flag = null;
    try {
      flag = sessionStorage.getItem(`gos.enterCorrection.${attempt.id}`);
    } catch {
      /* private mode — ignore, nothing to consume */
    }
    if (!flag) {
      // No flag: still latch so a later poll-driven attempt refresh
      // can't accidentally re-enter correction.
      correctionEntryRef.current = true;
      return;
    }
    try {
      sessionStorage.removeItem(`gos.enterCorrection.${attempt.id}`);
    } catch {
      /* ignore */
    }
    correctionEntryRef.current = true;
    const firstRejected = (reviewStatus.questions || []).find(
      (q) => q.status === 'rejected',
    );
    if (!firstRejected) return;
    const lastStep = (attempt.steps || []).slice(-1)[0];
    setCorrectionDetour({
      currentLocalStepId: firstRejected.stepId,
      // Returning "where they were before correction" from a portal
      // entry-point: the procedure was already submitted, so the
      // natural learning bookmark is the END of the sequence (the
      // final step they completed before submitting). After fixing,
      // המשך מהמקום שבו עצרתי jumps them back there.
      returnStepId: lastStep?.stepId || null,
      phase: 'editing',
      justSubmittedStepId: null,
    });
  }, [attempt, reviewStatus]);

  // Branch-switch detector. When the lightweight poll surfaces a
  // change that would render a different screen — attempt.status
  // moved (in_progress → submitted → approved), or the rejection
  // count crossed the 0/non-zero boundary (WaitingScreen ↔
  // ResubmitScreen) — pull the heavy attempt payload so the runtime
  // catches up. We DON'T reload on every poll; only when the screen
  // would actually change.
  useEffect(() => {
    if (!reviewStatus || !attempt) return;
    const statusChanged = reviewStatus.attemptStatus !== attempt.status;
    const remoteRejected = reviewStatus.counts?.rejected || 0;
    const localLatest = latestAnswerByStep(attempt.answers || []);
    let localRejected = 0;
    for (const a of localLatest.values()) {
      if (a.status === 'rejected') localRejected += 1;
    }
    const rejectedBoundaryCrossed =
      (remoteRejected > 0 && localRejected === 0) ||
      (remoteRejected === 0 && localRejected > 0);
    if (statusChanged || rejectedBoundaryCrossed) {
      loadAttempt();
    }
  }, [reviewStatus, attempt, loadAttempt]);

  // Legacy 5s heavy poll while submitted — kept as a belt-and-braces
  // fallback for the brief window between server deploys (if the new
  // /review-status endpoint isn't live yet, this still picks up
  // approvals). Once the lightweight endpoint is everywhere, this
  // could be removed.
  const pollRef = useRef(null);
  useEffect(() => {
    if (!attempt || attempt.status !== 'submitted') return;
    pollRef.current = setInterval(loadAttempt, 5000);
    return () => clearInterval(pollRef.current);
  }, [attempt?.id, attempt?.status, loadAttempt]);

  const flow = attempt?.flow;
  // The server returns the resolved, hydrated step list directly on
  // the attempt — flow.nodes is no longer the source of truth for the
  // runtime since it doesn't carry folderRef expansions. Falls back to
  // [] before the first load.
  const steps = attempt?.steps || [];
  const currentStepId = attempt?.currentStepId || attempt?.currentNodeId;

  // ── Background persistence queue ─────────────────────────────────
  //
  // Step navigation used to be fully synchronous: every click fired
  // answer → advance → loadAttempt sequentially and `await`-ed each
  // round-trip before the UI changed. On Railway latency that ran ~1-2s
  // per click, which is the "stuck" feeling the user reported.
  //
  // New shape: optimistic local update fires immediately (UI changes
  // before any network call), and the persistence calls run in the
  // background through a serialized promise chain. Serialization
  // matters because two parallel `advance` calls would both read the
  // same currentStepId from the DB and converge to wrong server state.
  // The chain guarantees server state moves through the same sequence
  // the UI showed.
  const queueRef = useRef(Promise.resolve());

  function enqueue(label, fn) {
    queueRef.current = queueRef.current.then(async () => {
      try {
        await fn();
        // Clear any prior nav error on success — the queue caught up.
        setNavError(null);
      } catch (e) {
        console.error('[runtime nav]', label, e);
        setNavError(e?.message || 'שגיאה בעדכון השרת');
        // Don't re-throw — keep the chain alive so subsequent clicks
        // still get processed.
      }
    });
  }

  function handleNext(answerPayload) {
    if (!attempt) return;
    const idx = steps.findIndex((s) => s.stepId === currentStepId);
    if (idx < 0) return;
    const currentStep = steps[idx];
    const nextStep = steps[idx + 1] || null;

    // Optimistic local update — both the cursor AND, when an answer
    // payload is included, the new FlowAnswer row. The optimistic
    // answer carries `_optimistic: true` so debugging / future code
    // can tell it apart from server-confirmed rows. version is
    // bumped past the existing latest for this step so
    // `latestAnswerByStep()` picks it up immediately when the user
    // navigates back to this step.
    setAttempt((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      if (answerPayload) {
        const existing = (prev.answers || []).filter(
          (a) => a.stepId === currentStep.stepId,
        );
        const maxVersion = existing.reduce(
          (m, a) => Math.max(m, a.version || 0),
          0,
        );
        const optimistic = {
          id: `_opt_${currentStep.stepId}_${Date.now()}`,
          attemptId: prev.id,
          stepId: currentStep.stepId,
          flowNodeId: currentStep.flowNodeId || null,
          questionItemId: currentStep.questionItemId || null,
          openText: answerPayload.openText ?? null,
          answerChoice: answerPayload.answerChoice ?? null,
          answerLabel: answerPayload.answerLabel ?? null,
          version: maxVersion + 1,
          status: 'pending',
          _optimistic: true,
        };
        next.answers = [...(prev.answers || []), optimistic];
      }
      next.currentStepId = nextStep ? nextStep.stepId : null;
      next.currentNodeId = nextStep?.flowNodeId || null;
      return next;
    });

    enqueue('next', async () => {
      if (answerPayload) {
        await api.attempts.answer(attempt.id, {
          stepId: currentStep.stepId,
          ...answerPayload,
        });
      }
      await api.attempts.advance(attempt.id);
    });
  }

  function handlePrev() {
    if (!attempt || !steps.length) return;
    const idx = steps.findIndex((s) => s.stepId === currentStepId);
    let prevStep;
    if (idx < 0) {
      // currentStepId is null — we're on the SubmitScreen (past end).
      // Back lands on the last step, mirroring the server-side rule.
      prevStep = steps[steps.length - 1];
    } else if (idx > 0) {
      prevStep = steps[idx - 1];
    } else {
      return; // already at the first step, no-op
    }
    setAttempt((prev) =>
      prev
        ? {
            ...prev,
            currentStepId: prevStep.stepId,
            currentNodeId: prevStep.flowNodeId || null,
          }
        : prev,
    );
    enqueue('back', () => api.attempts.back(attempt.id));
  }

  if (loadErr) {
    // Context-aware fallback. The runtime is a PUBLIC route and is
    // typically reached from the guide portal — sending the user to
    // `/` (which redirects to `/admin`) would dump a guide on the
    // admin home, which is exactly the bug the user reported. If we
    // still know the portal token, return there. Otherwise, show
    // retry without an admin escape hatch.
    return (
      <Screen>
        <div className="text-center max-w-md">
          <div className="text-5xl mb-3">⚠️</div>
          <div className="text-red-600 font-medium mb-2">לא ניתן לטעון את הניסיון</div>
          <div className="text-xs text-gray-500 font-mono mb-4" dir="ltr">
            {loadErr}
          </div>
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={loadAttempt}
              className="text-sm border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-50"
            >
              נסה שוב
            </button>
            {portalToken && (
              <a
                href={`/p/${encodeURIComponent(portalToken)}/procedures`}
                className="text-sm bg-blue-600 text-white rounded px-3 py-1.5 hover:bg-blue-700"
              >
                חזרה לפורטל
              </a>
            )}
          </div>
        </div>
      </Screen>
    );
  }
  if (!attempt) {
    return (
      <Screen>
        <div className="text-gray-500">טוען…</div>
      </Screen>
    );
  }

  // Common review-status bag passed to every screen so each one can
  // render the bar on its own and trigger the modal from the same
  // store.
  const reviewBag = {
    reviewStatus,
    onOpenReviewModal: () => setReviewModalOpen(true),
  };
  // Procedure attempts come from the portal's נהלים page — return there.
  const homeHref = portalToken
    ? `/p/${encodeURIComponent(portalToken)}/procedures`
    : null;

  // ── Correction-mode local navigation ─────────────────────────────
  //
  // Prev/next during a correction detour walk the runtime steps
  // PURELY locally. The server cursor is left untouched — the user
  // is in a submitted attempt, the cursor doesn't apply, and we
  // don't want a stray /advance call to change state on the server
  // side. This is the "free reread" the guide needs: they can step
  // backward to revisit content, forward to compare, then submit
  // their fix when they land back on the rejected question.
  function correctionLocalNavigate(direction) {
    setCorrectionDetour((prev) => {
      if (!prev) return prev;
      const list = attempt?.steps || [];
      const idx = list.findIndex(
        (s) => s.stepId === prev.currentLocalStepId,
      );
      if (idx < 0) return prev;
      const nextIdx = direction === 'prev' ? idx - 1 : idx + 1;
      if (nextIdx < 0 || nextIdx >= list.length) return prev;
      return {
        ...prev,
        currentLocalStepId: list[nextIdx].stepId,
        phase: 'editing',
        justSubmittedStepId: null,
      };
    });
  }

  // Submit a single correction. Reuses the existing answer + submit
  // endpoints — no new server work, no duplicate runtime engine. If
  // there are still other rejections remaining, the submit call
  // returns 'outstanding_questions'; we treat that as expected and
  // keep the attempt in submitted state. On success, flip the
  // detour to its 'success' phase so ItemScreen renders the post-
  // submit body + CTA pair (תיקון הבא / המשך מהמקום שבו עצרתי).
  async function correctionSubmit(payload) {
    if (!attempt || !correctionDetour) return;
    const stepId = correctionDetour.currentLocalStepId;
    if (!stepId) return;
    try {
      await api.attempts.answer(attempt.id, { stepId, ...payload });
      try {
        await api.attempts.submit(attempt.id);
      } catch (e) {
        if (e.payload?.error !== 'outstanding_questions') throw e;
      }
      setCorrectionDetour((prev) =>
        prev
          ? { ...prev, phase: 'success', justSubmittedStepId: stepId }
          : prev,
      );
      // Refresh both layers so the success CTAs see up-to-date
      // counts (especially the "more rejected?" check that drives
      // whether תיקון הבא shows up).
      loadAttempt();
      fetchReviewStatus();
    } catch (e) {
      setNavError(e?.payload?.error || e?.message || 'שגיאה בשליחת התיקון');
    }
  }

  // Find the next still-rejected question step (in attempt order),
  // skipping the one the user just fixed. Wraps around if none
  // after the current step. If genuinely no rejections remain, the
  // CTA is hidden in ItemScreen — this is just a safe fallback.
  function jumpToNextCorrection() {
    if (!attempt || !correctionDetour) return;
    const list = attempt.steps || [];
    const latest = latestAnswerByStep(attempt.answers || []);
    const cur = correctionDetour.currentLocalStepId;
    const startIdx = Math.max(
      0,
      list.findIndex((s) => s.stepId === cur) + 1,
    );
    const find = (from, to) => {
      for (let i = from; i < to; i += 1) {
        const s = list[i];
        if (s.kind !== 'question') continue;
        if (latest.get(s.stepId)?.status === 'rejected') return s.stepId;
      }
      return null;
    };
    const target =
      find(startIdx, list.length) || find(0, startIdx) || null;
    if (!target) {
      setCorrectionDetour(null);
      return;
    }
    setCorrectionDetour((prev) =>
      prev
        ? {
            ...prev,
            currentLocalStepId: target,
            phase: 'editing',
            justSubmittedStepId: null,
          }
        : prev,
    );
  }

  // המשך מהמקום שבו עצרתי — the "resume where I was before
  // correction" button. Clears the detour entirely and refreshes
  // the attempt so natural rendering picks up the new pending
  // answers. The returnStepId currently has no server-side cursor
  // sync (corrections happen on submitted attempts where the cursor
  // is meaningless), but is preserved on the detour for future use
  // and for the local-jump shape we'd want if/when correction
  // becomes possible mid in_progress.
  function resumeLearning() {
    setCorrectionDetour(null);
    loadAttempt();
    fetchReviewStatus();
  }

  // The modal lives at the AttemptRuntime level so it overlays
  // every screen and survives status transitions without remount.
  // onClickRejected lifts the user from the list view into the
  // confirmation sheet; the modal closes simultaneously so the
  // sheet is the single focal point.
  const reviewModalNode = reviewModalOpen ? (
    <ReviewStatusModal
      data={reviewStatus}
      onClose={() => setReviewModalOpen(false)}
      onClickRejected={(q) => {
        setReviewModalOpen(false);
        setCorrectionConfirm({
          stepId: q.stepId,
          title: q.title || '',
          adminComment: q.adminComment || null,
        });
      }}
    />
  ) : null;

  // Correction confirmation sheet. Confirming starts a correction
  // detour at the picked step. The returnStepId saved here is the
  // user's CURRENT viewing position — for ItemScreen-mode users that
  // is `currentStepId` (live cursor), for submitted-state users it's
  // the last step in the sequence (their natural "end of learning"
  // bookmark).
  const correctionConfirmNode = correctionConfirm ? (
    <CorrectionConfirm
      data={correctionConfirm}
      onCancel={() => setCorrectionConfirm(null)}
      onConfirm={() => {
        const lastStep = steps[steps.length - 1] || null;
        const returnStepId =
          attempt?.status === 'in_progress' && currentStepId
            ? currentStepId
            : lastStep?.stepId || null;
        setCorrectionDetour({
          currentLocalStepId: correctionConfirm.stepId,
          returnStepId,
          phase: 'editing',
          justSubmittedStepId: null,
        });
        setCorrectionConfirm(null);
      }}
    />
  ) : null;

  // ── Correction detour render ─────────────────────────────────────
  //
  // While a detour is active, we render the NORMAL ItemScreen at
  // `currentLocalStepId` so the guide stays inside the procedure's
  // narrative — they can prev/next freely to reread content, the
  // home button works, the review-status bar is visible. ItemScreen
  // detects correction mode via the `correctionPhase` /
  // `isRejectedQuestion` props and swaps the body into a correction
  // form (admin comment + previous answer + new-answer input) for
  // the rejected question, or a read-only summary for non-rejected
  // questions, or the normal content render for content steps.
  if (correctionDetour && attempt) {
    const list = attempt.steps || [];
    const idx = list.findIndex(
      (s) => s.stepId === correctionDetour.currentLocalStepId,
    );
    const detourStep = idx >= 0 ? list[idx] : null;
    if (!detourStep) {
      // Unknown step — render a safe escape hatch instead of
      // trapping the user. Mutating state during render would loop;
      // the user clicks "ביטול" to exit and natural rendering picks
      // up. This branch is rare (would require the attempt's steps
      // to lose a referenced stepId between detour creation and
      // render), but the explicit fallback beats a blank screen.
      return (
        <Screen>
          <div className="text-center max-w-md">
            <div className="text-red-600 font-medium mb-2">
              השאלה לתיקון לא נמצאה ברצף
            </div>
            <button
              type="button"
              onClick={() => setCorrectionDetour(null)}
              className="text-sm border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-50"
            >
              חזרה
            </button>
          </div>
        </Screen>
      );
    }
    const latestForStep = latestAnswerByStep(attempt.answers || []).get(
      detourStep.stepId,
    );
    const stillRejectedSomewhere = list.some((s) => {
      if (s.kind !== 'question') return false;
      if (s.stepId === correctionDetour.justSubmittedStepId) return false;
      const la = latestAnswerByStep(attempt.answers || []).get(s.stepId);
      return la?.status === 'rejected';
    });
    return (
      <>
        <ItemScreen
          node={detourStep}
          isMobile={isMobile}
          existingAnswer={latestForStep}
          onNext={null}
          onPrev={idx > 0 ? () => correctionLocalNavigate('prev') : null}
          homeHref={homeHref}
          navError={navError}
          completedStepsRef={completedStepsRef}
          position={{
            index: idx,
            total: list.length,
            isFirst: idx === 0,
            isLast: idx === list.length - 1,
          }}
          {...reviewBag}
          // ── Correction-mode props ───────────────────────────────
          correctionMode
          correctionPhase={correctionDetour.phase}
          justSubmittedStepId={correctionDetour.justSubmittedStepId}
          hasMoreRejected={stillRejectedSomewhere}
          onCorrectionSubmit={correctionSubmit}
          onCorrectionLocalNext={
            idx < list.length - 1
              ? () => correctionLocalNavigate('next')
              : null
          }
          onResumeLearning={resumeLearning}
          onNextCorrection={
            stillRejectedSomewhere ? jumpToNextCorrection : null
          }
          onCancelCorrection={() => setCorrectionDetour(null)}
        />
        {reviewModalNode}
        {correctionConfirmNode}
      </>
    );
  }

  // --- status: approved ---
  if (attempt.status === 'approved') {
    return (
      <>
        <ApprovedBrowser
          flow={flow}
          attempt={attempt}
          isMobile={isMobile}
          {...reviewBag}
        />
        {reviewModalNode}
        {correctionConfirmNode}
      </>
    );
  }

  // --- status: submitted ---
  //
  // We no longer render the bulk ResubmitScreen here. Corrections
  // happen INSIDE the normal runtime via `correctionDetour` (entered
  // from the portal CTA's "מעבר לתיקונים" or from the review-status
  // modal). When the attempt has rejections but no detour is active
  // yet (deep-link / refresh case), WaitingScreen renders WITH a
  // prominent rejection banner that opens the modal. The modal click
  // → confirmation → correction detour pipeline takes over from there.
  if (attempt.status === 'submitted') {
    const latest = latestAnswerByStep(attempt.answers || []);
    let rejectedCount = 0;
    for (const a of latest.values()) {
      if (a.status === 'rejected') rejectedCount += 1;
    }
    return (
      <>
        <WaitingScreen
          rejectedCount={rejectedCount}
          {...reviewBag}
        />
        {reviewModalNode}
        {correctionConfirmNode}
      </>
    );
  }

  // --- status: in_progress ---
  const currentStepIndex = steps.findIndex((s) => s.stepId === currentStepId);
  const currentStep = currentStepIndex >= 0 ? steps[currentStepIndex] : null;

  if (!currentStep) {
    // End of linear sequence → submit screen. Allow stepping back.
    return (
      <>
        <SubmitScreen
          attempt={attempt}
          isMobile={isMobile}
          steps={steps}
          onSubmitted={loadAttempt}
          onPrev={steps.length > 0 ? handlePrev : null}
          homeHref={homeHref}
          completedStepsRef={completedStepsRef}
          {...reviewBag}
        />
        {reviewModalNode}
        {correctionConfirmNode}
      </>
    );
  }

  return (
    <>
      <ItemScreen
        node={currentStep}
        isMobile={isMobile}
        existingAnswer={latestAnswerByStep(attempt.answers || []).get(currentStep.stepId)}
        onNext={handleNext}
        onPrev={currentStepIndex > 0 ? handlePrev : null}
        homeHref={homeHref}
        navError={navError}
        completedStepsRef={completedStepsRef}
        position={{
          index: currentStepIndex,
          total: steps.length,
          isFirst: currentStepIndex === 0,
          isLast: currentStepIndex === steps.length - 1,
        }}
        {...reviewBag}
      />
      {reviewModalNode}
      {correctionConfirmNode}
    </>
  );
}

// ---------- shared helpers ----------

// ── useStepScrollGate ────────────────────────────────────────────
//
// Forces a "read to bottom before continuing" gate on scrollable
// steps, with per-step session memory so a step the learner has
// already read once never re-locks on revisit.
//
// What it does on every step change (keyed by `stepId`):
//   1. Scrolls the runtime scroll container to top (auto behavior —
//      no smooth scroll, the user shouldn't have to wait for an
//      animation before seeing the new step's start).
//   2. Seeds `hasReachedBottom` from `completedStepsRef`. If the user
//      already read this step earlier in the session, they're not
//      asked to scroll again.
//   3. Measures whether the new content overflows the container. If
//      not (short step), auto-marks it complete — short steps never
//      lock.
//   4. Listens to scroll events: once `scrollTop + clientHeight`
//      reaches `scrollHeight - tolerance`, marks complete and stops
//      caring. The 16px tolerance covers mobile rounding.
//   5. Subscribes a ResizeObserver to the inner content wrapper so
//      late image loads (the wrapper grows after first paint) don't
//      give a false "not scrollable" answer once they finish.
//
// The completion memory lives in a ref the parent (AttemptRuntime /
// FlowEntry) owns — that lets the parent reset it cleanly when the
// attempt or flow changes, AND keeps the gate stable across normal
// next/back navigation (which doesn't unmount AttemptRuntime).
function useStepScrollGate(scrollRef, stepId, completedStepsRef) {
  const [isScrollable, setIsScrollable] = useState(false);
  const [hasReachedBottom, setHasReachedBottom] = useState(false);

  useEffect(() => {
    if (!scrollRef.current || !stepId) return undefined;
    const el = scrollRef.current;

    // Always reset to top on step change. The shell uses an internal
    // scroll container (fixed inset-0 page; <main> scrolls), so
    // window.scrollTo would no-op — we have to address the actual
    // element.
    el.scrollTo({ top: 0, left: 0, behavior: 'auto' });

    // Seed from session memory.
    const already = completedStepsRef.current.has(stepId);
    setHasReachedBottom(already);
    setIsScrollable(false);

    function evaluate() {
      const scrollable = el.scrollHeight > el.clientHeight + 12;
      setIsScrollable(scrollable);
      if (!scrollable && !completedStepsRef.current.has(stepId)) {
        completedStepsRef.current.add(stepId);
        setHasReachedBottom(true);
      }
    }
    function onScroll() {
      if (completedStepsRef.current.has(stepId)) return;
      const atBottom =
        el.scrollTop + el.clientHeight >= el.scrollHeight - 16;
      if (atBottom) {
        completedStepsRef.current.add(stepId);
        setHasReachedBottom(true);
      }
    }

    evaluate();
    el.addEventListener('scroll', onScroll, { passive: true });

    // Watch for late layout changes (images, embeds, font swaps).
    // Observing both the container AND its first child catches both
    // viewport resizes and content-height changes.
    const ro = new ResizeObserver(evaluate);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);

    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
    // scrollRef.current and completedStepsRef are stable refs; only
    // stepId drives re-running the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepId]);

  return { isScrollable, hasReachedBottom };
}

// Resolve the guide portal token from any of three sources, in
// priority order:
//   1. URL `?p=<token>` — RESTful, bookmark-safe, the canonical
//      hand-off from the portal.
//   2. sessionStorage    — tab-scoped fallback for refreshes that
//      dropped the query string.
//   3. localStorage      — persistent across PWA relaunches; this is
//      what the root Landing route reads, but the runtime checks it
//      too so a guide who deep-links into /attempt/:id from an
//      installed PWA still gets the home button + portal context.
function readPortalToken(searchParams) {
  const fromUrl = searchParams.get('p');
  if (fromUrl) return fromUrl;
  try {
    const fromSession = sessionStorage.getItem('gos.portalToken');
    if (fromSession) return fromSession;
  } catch {
    /* ignore */
  }
  try {
    return localStorage.getItem('gos.portalToken') || null;
  } catch {
    return null;
  }
}

// Latest FlowAnswer per step for a given attempt's answer rows. Keyed
// by stepId so folderRef-expanded answers (which have null flowNodeId)
// match correctly.
function latestAnswerByStep(answers) {
  const out = new Map();
  for (const a of answers) {
    const cur = out.get(a.stepId);
    if (!cur || a.version > cur.version) out.set(a.stepId, a);
  }
  return out;
}

// ---------- shared UI ----------

function Screen({ children, preview }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      {preview && <PreviewBanner />}
      {children}
    </div>
  );
}

function PreviewBanner() {
  return (
    <div className="shrink-0 bg-amber-100 text-amber-900 text-xs text-center py-1">
      תצוגה מקדימה — הנתונים לא נשמרים
    </div>
  );
}

function NameGate({ isMobile, flow, name, setName, busy, error, onStart }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div
        className={`bg-white rounded-lg shadow ${
          isMobile ? 'w-full p-6' : 'max-w-md w-full p-8'
        }`}
      >
        <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">
          Grafitiyul OS
        </div>
        <h1 className="text-2xl font-semibold mb-6">{flow.title}</h1>
        <label className="block text-sm font-medium mb-2">שם מלא</label>
        <input
          autoFocus
          className="w-full border rounded px-3 py-3 mb-4 text-lg"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onStart()}
          disabled={busy}
        />
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded p-2 mb-3 text-sm">
            {error}
          </div>
        )}
        <button
          onClick={onStart}
          disabled={!name.trim() || busy}
          className="w-full bg-blue-600 text-white rounded px-4 py-3 text-lg disabled:opacity-40"
        >
          {busy ? 'פותח…' : 'התחל'}
        </button>
      </div>
    </div>
  );
}

function ItemScreen({
  node,
  isMobile,
  isPreview,
  existingAnswer,
  onNext,
  onPrev,
  position,
  homeHref,
  navError,
  completedStepsRef,
  reviewStatus,
  onOpenReviewModal,
  // ── Correction-mode props (all optional). When `correctionMode`
  // is true, ItemScreen runs INSIDE a correction detour: it uses the
  // local nav handler chain instead of the normal `onNext`, surfaces
  // the admin comment + previous answer for rejected steps, renders
  // a read-only summary for non-rejected questions (so prev/next
  // browsing through the procedure during correction doesn't let the
  // guide accidentally re-edit approved answers), and on submit
  // success swaps the body for a calm success state with two CTAs.
  correctionMode,
  correctionPhase,           // 'editing' | 'success'
  justSubmittedStepId,
  hasMoreRejected,
  onCorrectionSubmit,
  onCorrectionLocalNext,
  onResumeLearning,
  onNextCorrection,
  onCancelCorrection,
}) {
  const [openText, setOpenText] = useState('');
  const [selected, setSelected] = useState('');
  const scrollRef = useRef(null);
  const stepKey = node.stepId || node.id;
  const fallbackCompletedRef = useRef(new Set());
  const completedRef = completedStepsRef || fallbackCompletedRef;
  const { isScrollable, hasReachedBottom } = useStepScrollGate(
    scrollRef,
    stepKey,
    completedRef,
  );

  const isContent = node.kind === 'content';
  const qi = node.questionItem;
  const ci = node.contentItem;
  // ── Mode classification ──────────────────────────────────────────
  // Only set when correctionMode is on; in normal mode all branches
  // collapse to the legacy "edit my own answer" path.
  const isRejectedQuestion =
    correctionMode && !isContent && existingAnswer?.status === 'rejected';
  const showCorrectionSuccess =
    correctionMode &&
    correctionPhase === 'success' &&
    justSubmittedStepId === node.stepId;
  const showCorrectionForm =
    correctionMode && isRejectedQuestion && !showCorrectionSuccess;
  // Read-only summary for browsing through non-rejected question
  // steps during a correction detour. The user can scan their past
  // answer + status, but the form is hidden so they don't
  // accidentally re-edit an approved answer.
  const showReadOnlyAnswered =
    correctionMode && !isContent && !isRejectedQuestion && !!existingAnswer;

  // Seed the answer fields. In correction mode we START EMPTY for the
  // rejected step — the previous answer is shown in a separate banner
  // for context, but the input box is blank to invite a fresh
  // response. In normal mode we keep the existing pre-fill behavior.
  useEffect(() => {
    if (showCorrectionForm) {
      setOpenText('');
      setSelected('');
    } else {
      setOpenText(existingAnswer?.openText || '');
      setSelected(existingAnswer?.answerChoice || '');
    }
  }, [stepKey, existingAnswer, showCorrectionForm]);

  const hasChoices = Array.isArray(qi?.options) && qi.options.length > 0;
  const showText = !!qi?.allowTextAnswer;

  const answer = { choice: selected || null, text: openText };
  const validation = isContent
    ? { ok: true }
    : validateAnswer(
        {
          options: qi?.options || [],
          allowTextAnswer: showText,
          requirement: qi?.requirement || 'optional',
        },
        answer,
      );
  const answerOk = validation.ok;
  const scrollOk = !isScrollable || hasReachedBottom;
  // Submit gate only matters for the form path. In correction-success
  // / read-only / content-during-correction paths the button is
  // either absent or has different semantics.
  const canSubmit = answerOk && scrollOk;
  const showScrollHint = answerOk && isScrollable && !hasReachedBottom;

  function submit() {
    if (showCorrectionForm) {
      if (!canSubmit) return;
      const payload = {};
      if (selected) {
        payload.answerChoice = selected;
        payload.answerLabel = selected;
      }
      if (showText && openText.trim()) {
        payload.openText = openText;
      }
      onCorrectionSubmit?.(payload);
      return;
    }
    // Normal mode (or correction-mode browsing of a non-form step):
    // delegate to the legacy onNext handler if present.
    if (correctionMode) {
      // Browsing through correction — "next" navigates locally.
      onCorrectionLocalNext?.();
      return;
    }
    if (!canSubmit) return;
    if (isContent) {
      onNext();
      return;
    }
    const payload = {};
    if (selected) {
      payload.answerChoice = selected;
      payload.answerLabel = selected;
    }
    if (showText && openText.trim()) {
      payload.openText = openText;
    }
    onNext(payload);
  }

  // ── Footer dispatch ──────────────────────────────────────────────
  let footerNode;
  if (showCorrectionSuccess) {
    footerNode = (
      <CorrectionSuccessFooter
        hasMoreRejected={!!hasMoreRejected}
        onResumeLearning={onResumeLearning}
        onNextCorrection={onNextCorrection}
      />
    );
  } else if (correctionMode) {
    // Correction browsing footer. Next is either "submit fix" (on
    // the rejected form step) or local-next (everywhere else).
    const nextLabel = showCorrectionForm
      ? 'שלח תיקון'
      : 'הבא';
    const canNext = showCorrectionForm
      ? canSubmit
      : !!onCorrectionLocalNext;
    footerNode = (
      <NavFooter
        onPrev={onPrev}
        canPrev={!!onPrev}
        onNext={onCorrectionLocalNext || showCorrectionForm ? submit : null}
        canNext={canNext}
        nextLabel={nextLabel}
        scrollHint={showCorrectionForm ? showScrollHint : false}
      />
    );
  } else {
    footerNode = (
      <NavFooter
        onPrev={onPrev}
        onNext={submit}
        canPrev={!!onPrev}
        canNext={canSubmit}
        nextLabel="הבא"
        scrollHint={showScrollHint}
      />
    );
  }

  return (
    <RuntimeShell
      isMobile={isMobile}
      preview={isPreview}
      stepKey={stepKey}
      scrollRef={scrollRef}
      header={
        <RuntimeHeader
          position={position}
          kind={node.kind}
          homeHref={homeHref}
          isMobile={isMobile}
          reviewStatus={reviewStatus}
          onOpenReviewModal={onOpenReviewModal}
          correctionMode={correctionMode}
          onCancelCorrection={onCancelCorrection}
        />
      }
      footer={footerNode}
      banner={navError ? <NavErrorBanner message={navError} /> : null}
    >
      <article>
        {/* Correction-mode banners come first so the guide reads them
            BEFORE the question — the admin comment is the load-bearing
            context here, not the question itself. */}
        {showCorrectionForm && existingAnswer?.adminComment && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
            <div className="text-[11px] font-bold text-red-800 uppercase tracking-wide mb-1">
              הערת מאשר
            </div>
            <div className="text-sm text-red-900 whitespace-pre-wrap">
              {existingAnswer.adminComment}
            </div>
          </div>
        )}

        {showCorrectionSuccess ? (
          <div className="text-center py-6">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-3xl">
              ✓
            </div>
            <h1
              className={`font-bold text-gray-900 mb-2 leading-tight ${
                isMobile ? 'text-xl' : 'text-2xl'
              }`}
            >
              התיקון נשלח לבדיקה
            </h1>
            <p className="text-sm text-gray-600">
              התשובה חזרה למצב "ממתין לבדיקה". אפשר לחזור למקום שעצרת
              בלימוד או לעבור לתיקון הבא.
            </p>
          </div>
        ) : (
          <>
            <h1
              className={`font-bold text-gray-900 mb-3 leading-tight ${
                isMobile ? 'text-2xl' : 'text-3xl'
              }`}
            >
              {isContent
                ? titleToPlain(ci?.title || '') || '(תוכן נמחק)'
                : titleToPlain(qi?.title || '') || '(שאלה נמחקה)'}
            </h1>

            {isContent ? (
              <div
                className="gos-prose text-gray-800"
                dangerouslySetInnerHTML={{
                  __html: normalizeRichHtml(ci?.body || ''),
                }}
              />
            ) : (
              <>
                <div
                  className="gos-prose text-gray-700 mb-5"
                  dangerouslySetInnerHTML={{
                    __html: normalizeRichHtml(qi?.questionText || ''),
                  }}
                />

                {/* Previous-answer banner. Shown for the rejected step
                    being corrected AND for read-only browsing of any
                    non-rejected answered question during a detour. */}
                {(showCorrectionForm || showReadOnlyAnswered) &&
                  existingAnswer && (
                    <div className="bg-gray-50 border border-gray-200 rounded-md p-3 mb-4 text-sm">
                      <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-1 flex items-center gap-1.5">
                        <span>התשובה הקודמת שלך</span>
                        {showReadOnlyAnswered && (
                          <ReadOnlyStatusPill
                            status={existingAnswer.status}
                          />
                        )}
                      </div>
                      <div className="text-gray-800 whitespace-pre-wrap">
                        {existingAnswer.answerLabel ||
                          existingAnswer.answerChoice ||
                          existingAnswer.openText ||
                          '(ריק)'}
                      </div>
                    </div>
                  )}

                {/* Form. Hidden in read-only browsing mode + in
                    correction-success state. */}
                {!showReadOnlyAnswered && !showCorrectionSuccess && (
                  <>
                    {showCorrectionForm && (
                      <div className="text-sm font-medium text-gray-700 mb-2">
                        התשובה החדשה שלך
                      </div>
                    )}
                    {hasChoices && (
                      <div className="space-y-2 mb-5">
                        {qi.options.map((opt, i) => (
                          <label
                            key={i}
                            className={`block border-2 rounded-lg cursor-pointer transition px-4 py-3 ${
                              selected === opt
                                ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-200'
                                : 'border-gray-200 hover:border-gray-300 bg-white'
                            }`}
                          >
                            <input
                              type="radio"
                              name="opt"
                              value={opt}
                              checked={selected === opt}
                              onChange={(e) => setSelected(e.target.value)}
                              className="me-2"
                            />
                            <span
                              className={isMobile ? 'text-base' : 'text-lg'}
                            >
                              {opt}
                            </span>
                          </label>
                        ))}
                        {selected && (
                          <button
                            type="button"
                            onClick={() => setSelected('')}
                            className="text-[12px] text-gray-500 hover:text-gray-800"
                          >
                            נקה בחירה
                          </button>
                        )}
                      </div>
                    )}
                    {showText && (
                      <textarea
                        className={`w-full border border-gray-300 rounded-md px-3 py-3 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 ${
                          isMobile
                            ? 'h-32 text-base'
                            : 'h-44 text-lg px-4 py-4'
                        }`}
                        value={openText}
                        onChange={(e) => setOpenText(e.target.value)}
                        placeholder={
                          hasChoices
                            ? 'הערה נוספת (אופציונלי)'
                            : 'התשובה שלך…'
                        }
                      />
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}
      </article>
    </RuntimeShell>
  );
}

// Tiny status pill for the read-only browsing summary inside a
// correction detour. Keeps the visual language consistent with the
// review-status modal without re-importing STATUS_META wholesale.
function ReadOnlyStatusPill({ status }) {
  if (status === 'approved') {
    return (
      <span className="inline-block text-[10px] font-medium rounded-full px-2 py-0.5 bg-green-100 text-green-800">
        אושר
      </span>
    );
  }
  if (status === 'pending') {
    return (
      <span className="inline-block text-[10px] font-medium rounded-full px-2 py-0.5 bg-amber-100 text-amber-900">
        ממתין לבדיקה
      </span>
    );
  }
  return null;
}

// Footer rendered after a correction is submitted. Shows the resume
// CTA always, plus "next correction" when more rejections remain.
function CorrectionSuccessFooter({
  hasMoreRejected,
  onResumeLearning,
  onNextCorrection,
}) {
  return (
    <div className="px-4 sm:px-6 py-3">
      <div className="flex items-center gap-2">
        {hasMoreRejected && onNextCorrection && (
          <button
            type="button"
            onClick={onNextCorrection}
            className="px-4 py-2.5 text-sm font-semibold border border-red-300 text-red-700 bg-white hover:bg-red-50 rounded-md inline-flex items-center gap-1.5"
          >
            <span>תיקון הבא</span>
            <ChevronLeft />
          </button>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={onResumeLearning}
          className="px-5 py-3 text-base font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-md inline-flex items-center gap-1.5 min-w-[180px] justify-center"
        >
          <span>המשך מהמקום שבו עצרתי</span>
          <ChevronLeft />
        </button>
      </div>
    </div>
  );
}

function SubmitScreen({
  attempt,
  isMobile,
  steps,
  onSubmitted,
  onPrev,
  homeHref,
  completedStepsRef,
  reviewStatus,
  onOpenReviewModal,
}) {
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const questions = steps.filter((s) => s.kind === 'question');
  const latest = latestAnswerByStep(attempt.answers || []);
  const unanswered = questions.filter((q) => !latest.get(q.stepId));

  const scrollRef = useRef(null);
  // Treat the submit screen as its own "step" for gating purposes.
  // Keyed by a synthetic id that doesn't collide with any real
  // stepId. Short submit screens auto-complete; long ones (lots of
  // unanswered warnings) require reading.
  const fallbackCompletedRef = useRef(new Set());
  const completedRef = completedStepsRef || fallbackCompletedRef;
  const { isScrollable, hasReachedBottom } = useStepScrollGate(
    scrollRef,
    '__submit__',
    completedRef,
  );
  const scrollOk = !isScrollable || hasReachedBottom;
  const showScrollHint = isScrollable && !hasReachedBottom;

  async function submit() {
    setErr(null);
    setBusy(true);
    try {
      await api.attempts.submit(attempt.id);
      await onSubmitted();
    } catch (e) {
      setErr(e.payload?.error || e.message || 'שגיאה');
    } finally {
      setBusy(false);
    }
  }

  return (
    <RuntimeShell
      isMobile={isMobile}
      stepKey="submit"
      scrollRef={scrollRef}
      header={
        <RuntimeHeader
          position={{ index: steps.length, total: steps.length, isLast: true }}
          kind={null}
          finishedHint
          homeHref={homeHref}
          isMobile={isMobile}
          reviewStatus={reviewStatus}
          onOpenReviewModal={onOpenReviewModal}
        />
      }
      footer={
        <NavFooter
          onPrev={onPrev}
          canPrev={!!onPrev}
          onNext={submit}
          canNext={!busy && unanswered.length === 0 && scrollOk}
          nextLabel={busy ? 'שולח…' : 'שלח לאישור'}
          scrollHint={showScrollHint}
        />
      }
    >
      <div>
        <h1
          className={`font-bold text-gray-900 mb-3 leading-tight ${
            isMobile ? 'text-2xl' : 'text-3xl'
          }`}
        >
          סיימת את כל הפריטים
        </h1>
        <p className="text-gray-700 mb-5">
          לחיצה על "שלח לאישור" תעביר את התשובות לבדיקה.
        </p>
        {unanswered.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded p-3 mb-4 text-sm">
            <div className="font-medium mb-1">שים לב</div>
            יש {unanswered.length} שאלות ללא תשובה. חזרו ומלאו אותן לפני
            השליחה.
          </div>
        )}
        {err && (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded p-3 mb-4 text-sm">
            לא ניתן לשלוח:{' '}
            {err === 'outstanding_questions' ? 'יש שאלות ללא תשובה' : err}
          </div>
        )}
      </div>
    </RuntimeShell>
  );
}

// ── RuntimeShell ──────────────────────────────────────────────────
//
// Three-zone fixed-height layout used by every active runtime screen:
//
//     ┌ header ┐  ← shrink-0 (kind badge + step counter + progress bar)
//     ├ scroll ┤  ← flex-1 + overflow-y-auto
//     └ footer ┘  ← shrink-0 (prev / next nav, always in viewport)
//
// `position: fixed inset-0` is the bulletproof way to fill the visible
// viewport: the previous attempt with `height: 100dvh; minHeight: 100vh`
// caused trouble on iOS — when the URL bar was visible the element ran
// 100vh tall (taller than the visible area), pushing the footer below
// the fold. Fixed positioning anchors all four edges to the viewport
// directly, so the footer is always within reach regardless of
// browser-chrome state.
function RuntimeShell({
  header,
  footer,
  children,
  preview,
  isMobile,
  // Changes whenever the active step changes; used as React `key` on
  // the inner content wrapper so the wrapper re-mounts and the CSS
  // animation re-fires.
  stepKey,
  // Forwarded ref onto the actual scroll container (<main>). Owned
  // by the parent screen so it can drive scroll-to-top + bottom
  // detection via useStepScrollGate. The animation key takes care
  // of re-mounting the inner wrapper, but we need a stable element
  // ref for the scroll listener / ResizeObserver — that's <main>,
  // which doesn't remount.
  scrollRef,
  // Optional non-blocking error strip (e.g. background save failed).
  banner,
}) {
  return (
    <div
      dir="rtl"
      className="bg-gray-50 flex flex-col fixed inset-0 overflow-hidden"
    >
      {preview && <PreviewBanner />}
      {header && (
        <header className="shrink-0 bg-white border-b border-gray-200">
          {header}
        </header>
      )}
      {banner && <div className="shrink-0">{banner}</div>}
      <main ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
        <div
          key={stepKey}
          className={`mx-auto w-full runtime-step-anim ${
            isMobile
              ? 'max-w-full px-4 py-5'
              : 'max-w-2xl px-8 py-8'
          }`}
        >
          {children}
        </div>
      </main>
      {footer && (
        <footer className="shrink-0 bg-white border-t border-gray-200 shadow-[0_-2px_8px_rgba(0,0,0,0.04)]">
          {footer}
        </footer>
      )}
    </div>
  );
}

// Compact runtime header — kind chip + step counter + thin progress
// bar. Optional home button on the trailing edge (left in RTL) that
// returns to the guide portal /p/<token>. Hidden when the runtime
// was opened directly (no token in URL) so a deep-linked attempt
// doesn't show a dead button.
function RuntimeHeader({
  position,
  kind,
  finishedHint,
  homeHref,
  isMobile,
  reviewStatus,
  onOpenReviewModal,
  correctionMode,
  onCancelCorrection,
}) {
  const total = position?.total ?? 0;
  const idx = position?.index ?? 0;
  const display = finishedHint
    ? `${total} / ${total}`
    : total > 0
    ? `${Math.min(idx + 1, total)} / ${total}`
    : '';
  // Progress: percentage of completed-or-current steps.
  const pct =
    total > 0
      ? Math.min(100, Math.round(((finishedHint ? total : idx + 1) / total) * 100))
      : 0;
  return (
    <div className="px-4 sm:px-6 pt-3 pb-2">
      <div className="flex items-center gap-2 text-[12px] text-gray-600">
        {correctionMode && (
          <span className="text-[10px] font-semibold uppercase tracking-wide bg-red-100 text-red-800 rounded px-1.5 py-0.5">
            מצב תיקון
          </span>
        )}
        {!correctionMode && kind === 'content' && (
          <span className="text-[10px] font-semibold uppercase tracking-wide bg-blue-100 text-blue-800 rounded px-1.5 py-0.5">
            תוכן
          </span>
        )}
        {!correctionMode && kind === 'question' && (
          <span className="text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-800 rounded px-1.5 py-0.5">
            שאלה
          </span>
        )}
        {!correctionMode && finishedHint && (
          <span className="text-[10px] font-semibold uppercase tracking-wide bg-green-100 text-green-800 rounded px-1.5 py-0.5">
            סיום
          </span>
        )}
        <span className="flex-1" />
        <span className="font-mono text-[12px] tabular-nums">{display}</span>
        {correctionMode && onCancelCorrection && (
          <button
            type="button"
            onClick={onCancelCorrection}
            className="ms-1 text-[12px] text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded px-1.5 py-1"
            aria-label="ביטול תיקון"
          >
            ביטול
          </button>
        )}
        {homeHref && <HomeButton homeHref={homeHref} isMobile={isMobile} />}
      </div>
      {/* Review-status bar — only renders when there's something to
          report (any answer exists, in any state). Below the chip row,
          above the progress bar, so it never crowds the kind/counter
          line on narrow phones. */}
      <ReviewStatusBar
        data={reviewStatus}
        onOpen={onOpenReviewModal}
        compact
      />
      <div className="mt-2 h-1 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-600 transition-all"
          style={{ width: `${pct}%` }}
          aria-hidden
        />
      </div>
    </div>
  );
}

// ── ReviewStatusBar ───────────────────────────────────────────────
//
// Compact 3-pill summary of the attempt's per-question review state.
// Tapping anywhere on the bar opens the modal with the per-question
// breakdown (and admin comments).
//
// Hidden when there's nothing to report — i.e. every count is zero.
// That keeps the header clean during the very first run, before any
// answer has been recorded.
function ReviewStatusBar({ data, onOpen, compact }) {
  if (!data || !data.counts) return null;
  const { pending = 0, approved = 0, rejected = 0 } = data.counts;
  if (pending + approved + rejected === 0) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`mt-2 w-full flex items-center gap-1.5 ${
        compact ? 'text-[11px]' : 'text-[12px]'
      } font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-md px-2 py-1 transition-colors`}
      aria-label="פירוט סטטוס תשובות"
    >
      <span className="text-[10px] uppercase tracking-wide text-gray-500">
        סטטוס תשובות
      </span>
      <span className="flex-1" />
      <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-900 rounded-full px-1.5 py-0.5">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" aria-hidden />
        ממתין {pending}
      </span>
      <span className="inline-flex items-center gap-1 bg-green-100 text-green-900 rounded-full px-1.5 py-0.5">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500" aria-hidden />
        אושר {approved}
      </span>
      <span
        className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 ${
          rejected > 0
            ? 'bg-red-100 text-red-900'
            : 'bg-gray-100 text-gray-600'
        }`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            rejected > 0 ? 'bg-red-500' : 'bg-gray-400'
          }`}
          aria-hidden
        />
        לתיקון {rejected}
      </span>
    </button>
  );
}

// ── ReviewStatusModal ─────────────────────────────────────────────
//
// Full-list breakdown of per-question status with admin comments.
// Lifted to AttemptRuntime so it overlays every screen and survives
// status transitions without remounting.
//
// `data.questions` order mirrors the runtime's step order so the
// guide can scan the list top-to-bottom and recognise where they are.
function ReviewStatusModal({ data, onClose, onClickRejected }) {
  // The list intentionally ELIDES untouched future questions.
  // 'unanswered' = the guide has not yet provided an answer for this
  // question step — showing those would turn the dialog into a full
  // procedure outline, which is exactly the workflow noise the new UX
  // is fighting. The bar in the runtime header still reflects the
  // attempt-wide totals (server-computed), so the filter only changes
  // what the LIST displays.
  const visibleQuestions = (data?.questions || []).filter(
    (q) => q.status && q.status !== 'unanswered',
  );
  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-none sm:rounded-xl shadow-xl w-full sm:max-w-lg max-h-full sm:max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-4 py-3 border-b border-gray-200 flex items-center gap-2">
          <h2 className="text-base font-semibold text-gray-900 flex-1">
            התשובות שלי
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded p-1"
            aria-label="סגור"
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
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {visibleQuestions.length === 0 && (
            <div className="text-sm text-gray-500 text-center py-8">
              עדיין לא נשלחו תשובות לבדיקה.
            </div>
          )}
          {visibleQuestions.map((q, i) => (
            <ReviewStatusRow
              key={q.stepId}
              q={q}
              index={i + 1}
              onClickRejected={onClickRejected}
            />
          ))}
        </div>
        <div className="shrink-0 px-4 py-3 border-t border-gray-200 text-[11px] text-gray-500">
          המסך מתעדכן אוטומטית כשהמאשר מסיים בדיקה.
        </div>
      </div>
    </div>
  );
}

function ReviewStatusRow({ q, index, onClickRejected }) {
  const meta = STATUS_META[q.status] || STATUS_META.unanswered;
  const plainTitle = titleToPlain(q.title || '') || '(שאלה ללא כותרת)';
  const isRejected = q.status === 'rejected';
  // Rejected rows render as buttons so the row IS the affordance.
  // Other rows stay informational divs — clicking them does nothing,
  // because there's nothing actionable for an approved or pending
  // answer (the user can't re-edit those without admin action).
  const Wrapper = isRejected ? 'button' : 'div';
  const wrapperProps = isRejected
    ? {
        type: 'button',
        onClick: () => onClickRejected?.(q),
        className: `w-full text-right rounded-md border p-3 transition ${meta.cardCls} hover:bg-red-100 active:bg-red-100 cursor-pointer`,
        'aria-label': `תקן: ${plainTitle}`,
      }
    : {
        className: `rounded-md border p-3 ${meta.cardCls}`,
      };
  return (
    <Wrapper {...wrapperProps}>
      <div className="flex items-start gap-2">
        <span
          className={`shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-semibold ${meta.indexCls}`}
        >
          {index}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-900 leading-snug">
            {plainTitle}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span
              className={`inline-block text-[11px] font-medium rounded-full px-2 py-0.5 ${meta.pillCls}`}
            >
              {meta.label}
            </span>
            {isRejected && (
              <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-red-700">
                תקן עכשיו
                <ChevronLeft />
              </span>
            )}
          </div>
          {q.adminComment && isRejected && (
            <div className="mt-2 text-[12px] bg-red-50 border border-red-200 text-red-900 rounded p-2 whitespace-pre-wrap">
              <span className="font-semibold">הערת מאשר: </span>
              {q.adminComment}
            </div>
          )}
        </div>
      </div>
    </Wrapper>
  );
}

const STATUS_META = {
  approved: {
    label: 'אושר',
    cardCls: 'bg-green-50 border-green-200',
    pillCls: 'bg-green-100 text-green-800',
    indexCls: 'bg-green-500 text-white',
  },
  rejected: {
    label: 'דורש תיקון',
    cardCls: 'bg-red-50 border-red-200',
    pillCls: 'bg-red-100 text-red-800',
    indexCls: 'bg-red-500 text-white',
  },
  pending: {
    label: 'ממתין לבדיקה',
    cardCls: 'bg-amber-50 border-amber-200',
    pillCls: 'bg-amber-100 text-amber-900',
    indexCls: 'bg-amber-500 text-white',
  },
  unanswered: {
    label: 'טרם נענה',
    cardCls: 'bg-gray-50 border-gray-200',
    pillCls: 'bg-gray-100 text-gray-700',
    indexCls: 'bg-gray-300 text-gray-800',
  },
};

// ── CorrectionConfirm ─────────────────────────────────────────────
//
// Small bottom-anchored sheet (mobile) / centered modal (desktop)
// shown after the guide taps a rejected row in the review-status
// list. The whole point is to stop the abrupt "click → dumped into
// the runtime" jump — the sheet announces the correction task,
// previews the admin's comment, and asks for an explicit go-ahead.
//
// Why a separate component instead of an inline conditional?
//   * It overlays the runtime without touching its scroll position
//     or step animation.
//   * It can be dismissed without losing the user's place — cancel
//     just clears `correctionConfirm` in the parent.
function CorrectionConfirm({ data, onCancel, onConfirm }) {
  const plainTitle =
    titleToPlain(data?.title || '') || '(שאלה ללא כותרת)';
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div
        className="bg-white w-full sm:max-w-md rounded-t-xl sm:rounded-xl shadow-xl border border-gray-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-red-100 text-red-700 text-base">
              ⚠
            </span>
            <h2 className="text-base font-semibold text-gray-900">
              שאלה לתיקון
            </h2>
          </div>
          <div className="text-sm text-gray-700 leading-snug mb-3">
            {plainTitle}
          </div>
          {data?.adminComment && (
            <div className="text-[12px] bg-red-50 border border-red-200 text-red-900 rounded p-2.5 whitespace-pre-wrap mb-3">
              <div className="font-semibold mb-0.5">הערת מאשר</div>
              {data.adminComment}
            </div>
          )}
          <div className="text-[12px] text-gray-600">
            התיקון יישלח שוב לבדיקת המאשר. תוכל לחזור לשם שעצרת בלימוד
            בלחיצה על "המשך ללמוד" אחרי השליחה.
          </div>
        </div>
        <div className="px-5 py-3 border-t border-gray-200 flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 bg-white rounded-md hover:bg-gray-50"
          >
            ביטול
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onConfirm}
            className="px-5 py-2.5 text-sm font-semibold bg-red-600 hover:bg-red-700 text-white rounded-md inline-flex items-center gap-1.5"
          >
            תקן עכשיו
            <ChevronLeft />
          </button>
        </div>
      </div>
    </div>
  );
}

// Secondary, deterministic navigation back to the guide portal.
// SVG icon to bypass any bidi mirroring; aria-label in Hebrew for
// screen readers. Plain anchor (not router-navigate) so middle-click /
// long-press / open-in-new-tab work the way the platform expects.
function HomeButton({ homeHref, isMobile }) {
  return (
    <a
      href={homeHref}
      title="חזרה למערכת"
      aria-label="חזרה למערכת"
      className="ms-1 inline-flex items-center gap-1 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded px-1.5 py-1 transition-colors"
    >
      <HomeIcon />
      {!isMobile && <span className="text-[12px]">למערכת</span>}
    </a>
  );
}

function HomeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 11l9-7 9 7" />
      <path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" />
    </svg>
  );
}

// Subtle non-blocking strip shown when a background persistence call
// failed. The user keeps navigating; the strip clears automatically
// the next time a queued op succeeds.
function NavErrorBanner({ message }) {
  return (
    <div className="bg-red-50 border-b border-red-200 text-red-800 text-[12px] px-4 py-1.5">
      <span className="font-medium">שמירה נכשלה: </span>
      {message}
    </div>
  );
}

// Direction-explicit chevrons — drawn as SVG so they bypass the
// Unicode bidi resolver entirely. Single-character arrow glyphs
// (`›` / `‹` / `→` / `←`) get reordered or visually swapped in
// some RTL contexts depending on browser + font; SVG paths are
// always rendered exactly as drawn.
function ChevronRight(props) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      aria-hidden
      {...props}
    >
      <path
        d="M6 4l4 4-4 4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function ChevronLeft(props) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      aria-hidden
      {...props}
    >
      <path
        d="M10 4l-4 4 4 4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Sticky-footer nav. RTL flex puts the FIRST child on the right (start),
// LAST child on the left (end) — so הקודם (DOM-first) sits on the
// RIGHT and הבא (DOM-last) sits on the LEFT, matching Hebrew reading
// flow. SVG chevrons indicate direction of travel:
//   הקודם → ChevronRight (RTL "back" = toward where the reader started)
//   הבא   → ChevronLeft  (RTL "forward" = toward where the reader is going)
//
// `scrollHint` shows the "scroll to bottom to continue" copy above the
// buttons when scroll is the active blocker (caller decides this; we
// just render).
function NavFooter({
  onPrev,
  canPrev,
  onNext,
  canNext,
  nextLabel = 'הבא',
  scrollHint,
}) {
  return (
    <div className="px-4 sm:px-6 py-3">
      {scrollHint && (
        <div
          className="mb-2 text-center text-[12px] font-medium text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-1.5"
          role="status"
          aria-live="polite"
        >
          יש לגלול עד סוף העמוד כדי להמשיך
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPrev}
          disabled={!canPrev}
          aria-label="הקודם"
          className="px-4 py-2.5 text-sm font-medium border border-gray-300 text-gray-700 bg-white rounded-md hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
        >
          <ChevronRight />
          <span>הקודם</span>
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onNext}
          disabled={!canNext}
          className="px-5 py-3 text-base font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5 min-w-[120px] justify-center"
        >
          <span>{nextLabel}</span>
          <ChevronLeft />
        </button>
      </div>
    </div>
  );
}

function WaitingScreen({ reviewStatus, onOpenReviewModal, rejectedCount }) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center p-4 pt-6">
      {reviewStatus && (
        <div className="w-full max-w-md mb-4">
          <ReviewStatusBar
            data={reviewStatus}
            onOpen={onOpenReviewModal}
          />
        </div>
      )}
      {/* Rejection banner — only when the modal+bar aren't enough on
          their own. Clicking opens the modal where the user picks a
          rejected item to correct. The modal click → confirmation
          sheet → correction detour pipeline handles everything from
          here. */}
      {rejectedCount > 0 && (
        <button
          type="button"
          onClick={onOpenReviewModal}
          className="w-full max-w-md mb-6 text-right rounded-lg border border-red-300 bg-red-50 hover:bg-red-100 active:bg-red-100 transition px-4 py-3 flex items-start gap-3"
        >
          <span className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full bg-red-100 text-red-700 text-base">
            ⚠
          </span>
          <span className="flex-1">
            <span className="block font-semibold text-red-900">
              יש{' '}
              {rejectedCount === 1
                ? 'תיקון אחד'
                : `${rejectedCount} תיקונים`}{' '}
              לבצע
            </span>
            <span className="block text-[12px] text-red-800 mt-0.5">
              לחץ כדי לראות את התשובות שדורשות תיקון.
            </span>
          </span>
        </button>
      )}
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-5xl mb-4">⏳</div>
          <h2 className="text-2xl font-semibold mb-2">התשובות נשלחו לאישור</h2>
          <p className="text-gray-600">
            {rejectedCount > 0
              ? 'לאחר שתשלח את התיקונים, המסך יתעדכן אוטומטית כשהמאשר יסיים את הבדיקה.'
              : 'המסך יתעדכן אוטומטית כאשר המאשר יסיים את הבדיקה.'}
          </p>
        </div>
      </div>
    </div>
  );
}

function CompletedScreen({ preview }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      {preview && <PreviewBanner />}
      <div className="text-center">
        <div className="text-6xl mb-4">✓</div>
        <h2 className="text-2xl font-semibold">
          {preview ? 'התצוגה המקדימה הסתיימה' : 'הזרימה הושלמה'}
        </h2>
        <p className="text-gray-600 mt-2">
          {preview ? 'סוף התצוגה המקדימה.' : 'תודה.'}
        </p>
      </div>
    </div>
  );
}

function ApprovedBrowser({
  flow,
  attempt,
  isMobile,
  reviewStatus,
  onOpenReviewModal,
}) {
  // Use the same hydrated steps the runtime saw so folderRef-expanded
  // items appear in the read-only browse view too.
  const steps = attempt.steps || [];
  const latest = latestAnswerByStep(attempt.answers || []);

  return (
    <div className="min-h-screen bg-gray-50 py-6 px-4">
      <div className={`mx-auto ${isMobile ? 'w-full' : 'max-w-2xl'}`}>
        {reviewStatus && (
          <div className="mb-4">
            <ReviewStatusBar
              data={reviewStatus}
              onOpen={onOpenReviewModal}
            />
          </div>
        )}
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-2 font-semibold text-green-900 mb-1">
            <span>✓</span> הזרימה אושרה
          </div>
          <div className="text-sm text-green-900">
            ניתן לעיין בכל התכנים והתשובות בכל עת.
          </div>
        </div>

        <div className="space-y-4">
          {steps.map((s) => (
            <div
              key={s.stepId}
              className="bg-white rounded-lg border border-gray-200 p-5"
            >
              {s.kind === 'content' ? (
                <>
                  <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-1">
                    תוכן
                  </div>
                  <h3 className="font-semibold text-lg mb-2">
                    {titleToPlain(s.contentItem?.title || '') || '(ללא כותרת)'}
                  </h3>
                  <div
                    className="gos-prose text-sm text-gray-700"
                    dangerouslySetInnerHTML={{
                      __html: normalizeRichHtml(s.contentItem?.body || ''),
                    }}
                  />
                </>
              ) : (
                <>
                  <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-1">
                    שאלה
                  </div>
                  <h3 className="font-semibold text-lg mb-1">
                    {titleToPlain(s.questionItem?.title || '') || '(ללא כותרת)'}
                  </h3>
                  <div
                    className="gos-prose text-sm text-gray-700 mb-3"
                    dangerouslySetInnerHTML={{
                      __html: normalizeRichHtml(
                        s.questionItem?.questionText || '',
                      ),
                    }}
                  />
                  <div className="bg-gray-50 border border-gray-200 rounded p-3 text-sm">
                    <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-1">
                      התשובה שלך
                    </div>
                    <div className="text-gray-800 whitespace-pre-wrap">
                      {(() => {
                        const la = latest.get(s.stepId);
                        if (!la) return '(ללא תשובה)';
                        return (
                          la.answerLabel ||
                          la.answerChoice ||
                          la.openText ||
                          '(ריק)'
                        );
                      })()}
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
