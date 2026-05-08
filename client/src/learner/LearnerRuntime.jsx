import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { validateAnswer } from '../lib/questionRequirement.js';
import { titleToPlain } from '../editor/TitleEditor.jsx';

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
  // Token threaded through from /p/:token → /attempt/:id?p=<token>.
  // Used to render a stable home button in the header.
  const portalToken = searchParams.get('p') || null;

  const [attempt, setAttempt] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [navError, setNavError] = useState(null);
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

  // Poll while submitted so admin reviews land without manual refresh.
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
    return (
      <Screen>
        <div className="text-center max-w-md">
          <div className="text-5xl mb-3">⚠️</div>
          <div className="text-red-600 font-medium mb-2">לא ניתן לטעון את הניסיון</div>
          <div className="text-xs text-gray-500 font-mono mb-4" dir="ltr">
            {loadErr}
          </div>
          <button
            onClick={() => navigate('/')}
            className="text-sm border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-50"
          >
            חזרה לדף הבית
          </button>
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

  // --- status: approved ---
  if (attempt.status === 'approved') {
    return <ApprovedBrowser flow={flow} attempt={attempt} isMobile={isMobile} />;
  }

  // --- status: submitted ---
  if (attempt.status === 'submitted') {
    const questionSteps = steps.filter((s) => s.kind === 'question');
    const latest = latestAnswerByStep(attempt.answers || []);
    const outstanding = questionSteps.filter(
      (q) => latest.get(q.stepId)?.status === 'rejected',
    );
    if (outstanding.length === 0) return <WaitingScreen />;
    return (
      <ResubmitScreen
        attempt={attempt}
        isMobile={isMobile}
        onSubmitted={loadAttempt}
      />
    );
  }

  // --- status: in_progress ---
  const currentStepIndex = steps.findIndex((s) => s.stepId === currentStepId);
  const currentStep = currentStepIndex >= 0 ? steps[currentStepIndex] : null;

  if (!currentStep) {
    // End of linear sequence → submit screen. Allow stepping back.
    return (
      <SubmitScreen
        attempt={attempt}
        isMobile={isMobile}
        steps={steps}
        onSubmitted={loadAttempt}
        onPrev={steps.length > 0 ? handlePrev : null}
        homeHref={portalToken ? `/p/${encodeURIComponent(portalToken)}` : null}
      />
    );
  }

  return (
    <ItemScreen
      node={currentStep}
      isMobile={isMobile}
      existingAnswer={latestAnswerByStep(attempt.answers || []).get(currentStep.stepId)}
      onNext={handleNext}
      onPrev={currentStepIndex > 0 ? handlePrev : null}
      homeHref={portalToken ? `/p/${encodeURIComponent(portalToken)}` : null}
      navError={navError}
      position={{
        index: currentStepIndex,
        total: steps.length,
        isFirst: currentStepIndex === 0,
        isLast: currentStepIndex === steps.length - 1,
      }}
    />
  );
}

// ---------- shared helpers ----------

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
}) {
  const [openText, setOpenText] = useState(existingAnswer?.openText || '');
  const [selected, setSelected] = useState(
    existingAnswer?.answerChoice || '',
  );

  useEffect(() => {
    setOpenText(existingAnswer?.openText || '');
    setSelected(existingAnswer?.answerChoice || '');
    // Re-seed when the step changes so going back to a previously-
    // answered question shows the saved answer pre-filled.
  }, [node.stepId || node.id, existingAnswer]);

  const isContent = node.kind === 'content';
  const qi = node.questionItem;
  const ci = node.contentItem;

  // Unified question shape. A question can show predefined choices, a
  // free-text field, or both (see lib/questionRequirement.js for the
  // five possible `requirement` values). The submit button is gated
  // by validateAnswer — the same function the server uses — so the
  // UI and the server agree on what "valid" means.
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
  const canSubmit = validation.ok;

  function submit() {
    if (!canSubmit) return;
    if (isContent) {
      onNext();
      return;
    }
    // Send whichever fields the learner actually filled. The server
    // accepts both on the same FlowAnswer row, so a question with
    // choices + text preserves both.
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

  return (
    <RuntimeShell
      isMobile={isMobile}
      preview={isPreview}
      stepKey={node.stepId || node.id}
      header={
        <RuntimeHeader
          position={position}
          kind={node.kind}
          homeHref={homeHref}
          isMobile={isMobile}
        />
      }
      footer={
        <NavFooter
          onPrev={onPrev}
          onNext={submit}
          canPrev={!!onPrev}
          canNext={canSubmit}
          nextLabel="הבא"
        />
      }
      banner={navError ? <NavErrorBanner message={navError} /> : null}
    >
      <article>
        <h1
          className={`font-bold text-gray-900 mb-3 leading-tight ${
            isMobile ? 'text-2xl' : 'text-3xl'
          }`}
        >
          {/* Titles are stored as TipTap HTML so they can hold dynamic-
              field chips. In the runtime header we want clean reading
              text — strip tags. The body below renders rich HTML via
              dangerouslySetInnerHTML in .gos-prose. */}
          {isContent
            ? titleToPlain(ci?.title || '') || '(תוכן נמחק)'
            : titleToPlain(qi?.title || '') || '(שאלה נמחקה)'}
        </h1>

        {isContent ? (
          <div
            className="gos-prose is-runtime text-gray-800"
            dangerouslySetInnerHTML={{ __html: ci?.body || '' }}
          />
        ) : (
          <>
            <div
              className="gos-prose is-runtime text-gray-700 mb-5"
              dangerouslySetInnerHTML={{ __html: qi?.questionText || '' }}
            />
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
                    <span className={isMobile ? 'text-base' : 'text-lg'}>
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
                  isMobile ? 'h-32 text-base' : 'h-44 text-lg px-4 py-4'
                }`}
                value={openText}
                onChange={(e) => setOpenText(e.target.value)}
                placeholder={
                  hasChoices ? 'הערה נוספת (אופציונלי)' : 'התשובה שלך…'
                }
              />
            )}
          </>
        )}
      </article>
    </RuntimeShell>
  );
}

function SubmitScreen({
  attempt,
  isMobile,
  steps,
  onSubmitted,
  onPrev,
  homeHref,
}) {
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const questions = steps.filter((s) => s.kind === 'question');
  const latest = latestAnswerByStep(attempt.answers || []);
  const unanswered = questions.filter((q) => !latest.get(q.stepId));

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
      header={
        <RuntimeHeader
          position={{ index: steps.length, total: steps.length, isLast: true }}
          kind={null}
          finishedHint
          homeHref={homeHref}
          isMobile={isMobile}
        />
      }
      footer={
        <NavFooter
          onPrev={onPrev}
          canPrev={!!onPrev}
          onNext={submit}
          canNext={!busy && unanswered.length === 0}
          nextLabel={busy ? 'שולח…' : 'שלח לאישור'}
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

function ResubmitScreen({ attempt, isMobile, onSubmitted }) {
  const [payload, setPayload] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    (async () => {
      const p = await api.attempts.outstanding(attempt.id);
      setPayload(p);
    })();
  }, [attempt.id]);

  if (!payload) {
    return (
      <Screen>
        <div className="text-gray-500">טוען…</div>
      </Screen>
    );
  }

  const outstanding = payload.outstanding || [];
  // Each entry has `step` (preferred) plus `node` for back-compat —
  // they're the same shape today.
  const keyOf = (o) => o.step?.stepId || o.node?.stepId || o.node?.id;
  const allFilled = outstanding.every((o) => {
    const d = drafts[keyOf(o)];
    const qi = (o.step || o.node)?.questionItem;
    const v = validateAnswer(
      {
        options: qi?.options || [],
        allowTextAnswer: !!qi?.allowTextAnswer,
        requirement: qi?.requirement || 'optional',
      },
      {
        choice: d?.answerChoice || null,
        text: d?.openText || null,
      },
    );
    return v.ok;
  });

  async function submitAll() {
    setErr(null);
    setBusy(true);
    try {
      for (const o of outstanding) {
        const stepId = keyOf(o);
        const d = drafts[stepId];
        await api.attempts.answer(attempt.id, { stepId, ...d });
      }
      await api.attempts.submit(attempt.id);
      await onSubmitted();
    } catch (e) {
      setErr(e.payload?.error || e.message || 'שגיאה');
    } finally {
      setBusy(false);
    }
  }

  function updateDraft(stepId, patch) {
    setDrafts((prev) => ({ ...prev, [stepId]: { ...prev[stepId], ...patch } }));
  }

  return (
    <div className="min-h-screen bg-gray-50 py-6 px-4">
      <div className={`mx-auto ${isMobile ? 'w-full' : 'max-w-2xl'}`}>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
          <div className="font-semibold text-amber-900 mb-1">
            יש לתקן {outstanding.length} שאלות
          </div>
          <div className="text-sm text-amber-900">
            המאשר סימן שאלות שצריך לענות עליהן שוב. עדכן את התשובות ושלח.
          </div>
        </div>

        <div className="space-y-5">
          {outstanding.map((o) => {
            const stepId = keyOf(o);
            return (
              <OutstandingBlock
                key={stepId}
                block={o}
                draft={drafts[stepId] || {}}
                onChange={(p) => updateDraft(stepId, p)}
              />
            );
          })}
        </div>

        {!allFilled && (
          <div className="mt-5 text-xs text-gray-600 bg-gray-100 border border-gray-200 rounded p-3">
            יש להזין תשובה חדשה לכל שאלה מסומנת לפני השליחה.
          </div>
        )}
        {err && (
          <div className="mt-3 bg-red-50 border border-red-200 text-red-800 rounded p-3 text-sm">
            לא ניתן לשלוח:{' '}
            {err === 'outstanding_questions' ? 'יש שאלות ללא תשובה' : err}
          </div>
        )}

        <button
          className="mt-4 w-full bg-blue-600 text-white rounded px-4 py-3 text-lg font-medium disabled:opacity-40"
          disabled={!allFilled || busy}
          onClick={submitAll}
          title={
            !allFilled
              ? 'יש להגיש תשובה חדשה לכל השאלות שנדחו לפני שליחה'
              : undefined
          }
        >
          {busy ? 'שולח…' : 'שלח שוב לאישור'}
        </button>
      </div>
    </div>
  );
}

function OutstandingBlock({ block, draft, onChange }) {
  const step = block.step || block.node;
  const { precedingContent, lastAnswer } = block;
  const qi = step.questionItem;
  const hasChoices = Array.isArray(qi?.options) && qi.options.length > 0;
  const showText = !!qi?.allowTextAnswer;

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
      {precedingContent.length > 0 && (
        <div className="mb-4 pb-4 border-b border-gray-100">
          <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-2">
            תוכן קשור
          </div>
          {precedingContent.map((c) => (
            <div key={c.stepId || c.id} className="mb-3 last:mb-0">
              <div className="text-sm font-medium text-gray-800 mb-1">
                {titleToPlain(c.contentItem?.title || '') || '(ללא כותרת)'}
              </div>
              <div
                className="gos-prose text-sm text-gray-700"
                dangerouslySetInnerHTML={{ __html: c.contentItem?.body || '' }}
              />
            </div>
          ))}
        </div>
      )}

      <div className="mb-3">
        <h3 className="font-semibold text-lg text-gray-900 mb-1">
          {titleToPlain(qi?.title || '') || '(שאלה נמחקה)'}
        </h3>
        <div
          className="gos-prose text-gray-700 text-sm"
          dangerouslySetInnerHTML={{ __html: qi?.questionText || '' }}
        />
      </div>

      {lastAnswer && (
        <div className="mb-3 bg-gray-50 border border-gray-200 rounded p-3 text-sm">
          <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-1">
            התשובה הקודמת שלך
          </div>
          <div className="text-gray-800 whitespace-pre-wrap">
            {lastAnswer.answerLabel ||
              lastAnswer.answerChoice ||
              lastAnswer.openText ||
              '(ריק)'}
          </div>
        </div>
      )}

      {lastAnswer?.adminComment && (
        <div className="mb-3 bg-red-50 border border-red-200 rounded p-3 text-sm">
          <div className="text-[11px] text-red-700 uppercase tracking-wide mb-1 font-semibold">
            הערת מאשר
          </div>
          <div className="text-red-900 whitespace-pre-wrap">
            {lastAnswer.adminComment}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div className="text-sm font-medium">התשובה החדשה שלך</div>
        {hasChoices && (
          <div className="space-y-2">
            {qi.options.map((opt, i) => (
              <label
                key={i}
                className={`block border rounded-lg cursor-pointer px-4 py-3 ${
                  draft.answerChoice === opt
                    ? 'border-blue-600 bg-blue-50'
                    : 'hover:bg-gray-50 border-gray-200'
                }`}
              >
                <input
                  type="radio"
                  name={`opt-${step.stepId}`}
                  value={opt}
                  checked={draft.answerChoice === opt}
                  onChange={(e) =>
                    onChange({
                      answerChoice: e.target.value,
                      answerLabel: e.target.value,
                    })
                  }
                  className="mr-2"
                />
                {opt}
              </label>
            ))}
          </div>
        )}
        {showText && (
          <textarea
            className="w-full border rounded px-3 py-3 h-32"
            value={draft.openText || ''}
            onChange={(e) => onChange({ openText: e.target.value })}
            placeholder={hasChoices ? 'הערה נוספת (אופציונלי)' : 'התשובה שלך…'}
          />
        )}
      </div>
    </div>
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
  // animation re-fires. Also resets scroll position to the top of the
  // new step.
  stepKey,
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
      <main className="flex-1 min-h-0 overflow-y-auto">
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
function RuntimeHeader({ position, kind, finishedHint, homeHref, isMobile }) {
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
        {kind === 'content' && (
          <span className="text-[10px] font-semibold uppercase tracking-wide bg-blue-100 text-blue-800 rounded px-1.5 py-0.5">
            תוכן
          </span>
        )}
        {kind === 'question' && (
          <span className="text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-800 rounded px-1.5 py-0.5">
            שאלה
          </span>
        )}
        {finishedHint && (
          <span className="text-[10px] font-semibold uppercase tracking-wide bg-green-100 text-green-800 rounded px-1.5 py-0.5">
            סיום
          </span>
        )}
        <span className="flex-1" />
        <span className="font-mono text-[12px] tabular-nums">{display}</span>
        {homeHref && <HomeButton homeHref={homeHref} isMobile={isMobile} />}
      </div>
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
function NavFooter({ onPrev, canPrev, onNext, canNext, nextLabel = 'הבא' }) {
  return (
    <div className="px-4 sm:px-6 py-3 flex items-center gap-2">
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
  );
}

function WaitingScreen() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="text-center max-w-md">
        <div className="text-5xl mb-4">⏳</div>
        <h2 className="text-2xl font-semibold mb-2">התשובות נשלחו לאישור</h2>
        <p className="text-gray-600">
          המסך יתעדכן אוטומטית כאשר המאשר יסיים את הבדיקה.
        </p>
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

function ApprovedBrowser({ flow, attempt, isMobile }) {
  // Use the same hydrated steps the runtime saw so folderRef-expanded
  // items appear in the read-only browse view too.
  const steps = attempt.steps || [];
  const latest = latestAnswerByStep(attempt.answers || []);

  return (
    <div className="min-h-screen bg-gray-50 py-6 px-4">
      <div className={`mx-auto ${isMobile ? 'w-full' : 'max-w-2xl'}`}>
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
                      __html: s.contentItem?.body || '',
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
                      __html: s.questionItem?.questionText || '',
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
