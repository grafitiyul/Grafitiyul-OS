import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';

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

  // Preview-only local state.
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

  const linear = useMemo(() => (flow ? flattenNodes(flow.nodes) : []), [flow]);

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
    if (previewIdx >= linear.length) return <CompletedScreen preview />;
    const currentNode = linear[previewIdx];
    return (
      <ItemScreen
        node={currentNode}
        isMobile={isMobile}
        isPreview
        existingAnswer={previewAnswers[currentNode.id]}
        onNext={(answerPayload) => {
          if (answerPayload) {
            setPreviewAnswers({
              ...previewAnswers,
              [currentNode.id]: answerPayload,
            });
          }
          setPreviewIdx(previewIdx + 1);
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

  const [attempt, setAttempt] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
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
  const linear = useMemo(() => (flow ? flattenNodes(flow.nodes) : []), [flow]);

  async function handleNext(answerPayload) {
    const currentNode = linear.find((n) => n.id === attempt.currentNodeId);
    if (!currentNode) return;
    if (answerPayload) {
      await api.attempts.answer(attempt.id, {
        nodeId: currentNode.id,
        ...answerPayload,
      });
    }
    await api.attempts.advance(attempt.id);
    await loadAttempt();
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
    const questionNodes = linear.filter((n) => n.kind === 'question');
    const latest = latestAnswerByNode(attempt.answers || []);
    const outstanding = questionNodes.filter(
      (q) => latest.get(q.id)?.status === 'rejected',
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
  const currentNode =
    linear.find((n) => n.id === attempt.currentNodeId) || null;

  if (!currentNode) {
    // End of linear sequence → submit screen.
    return (
      <SubmitScreen
        attempt={attempt}
        isMobile={isMobile}
        linear={linear}
        onSubmitted={loadAttempt}
      />
    );
  }

  return (
    <ItemScreen
      node={currentNode}
      isMobile={isMobile}
      existingAnswer={latestAnswerByNode(attempt.answers || []).get(currentNode.id)}
      onNext={handleNext}
    />
  );
}

// ---------- shared helpers ----------

function flattenNodes(nodes) {
  const byParent = new Map();
  for (const n of nodes) {
    const key = n.parentId ?? '';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(n);
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.order - b.order);
  function walk(parentId) {
    const arr = byParent.get(parentId ?? '') || [];
    const out = [];
    for (const n of arr) {
      if (n.kind === 'group') out.push(...walk(n.id));
      else out.push(n);
    }
    return out;
  }
  return walk(null);
}

function latestAnswerByNode(answers) {
  const out = new Map();
  for (const a of answers) {
    const cur = out.get(a.flowNodeId);
    if (!cur || a.version > cur.version) out.set(a.flowNodeId, a);
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
    <div className="fixed top-0 inset-x-0 bg-amber-100 text-amber-900 text-xs text-center py-1 z-50">
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

function ItemScreen({ node, isMobile, isPreview, existingAnswer, onNext }) {
  const [openText, setOpenText] = useState(existingAnswer?.openText || '');
  const [selected, setSelected] = useState(
    existingAnswer?.answerChoice || '',
  );

  useEffect(() => {
    setOpenText(existingAnswer?.openText || '');
    setSelected(existingAnswer?.answerChoice || '');
  }, [node.id]);

  const isContent = node.kind === 'content';
  const qi = node.questionItem;
  const ci = node.contentItem;
  const isChoice = qi?.answerType === 'single_choice';
  const canSubmit = isContent
    ? true
    : isChoice
    ? !!selected
    : openText.trim().length > 0;

  function submit() {
    if (!canSubmit) return;
    if (isContent) onNext();
    else if (isChoice) {
      onNext({ answerChoice: selected, answerLabel: selected });
    } else {
      onNext({ openText });
    }
  }

  const Shell = isMobile ? MobileShell : DesktopShell;

  return (
    <Shell preview={isPreview}>
      {isContent ? (
        <>
          <h2
            className={`font-semibold ${
              isMobile ? 'text-xl mb-3' : 'text-3xl mb-4'
            }`}
          >
            {ci?.title || '(תוכן נמחק)'}
          </h2>
          <div
            className={`gos-prose text-gray-800 ${
              isMobile ? 'text-base' : 'text-lg leading-relaxed mb-8'
            }`}
            dangerouslySetInnerHTML={{ __html: ci?.body || '' }}
          />
        </>
      ) : (
        <>
          <h2
            className={`font-semibold ${
              isMobile ? 'text-xl mb-2' : 'text-3xl mb-3'
            }`}
          >
            {qi?.title || '(שאלה נמחקה)'}
          </h2>
          <div
            className={`gos-prose text-gray-700 ${
              isMobile ? 'text-base mb-4' : 'text-lg mb-6'
            }`}
            dangerouslySetInnerHTML={{ __html: qi?.questionText || '' }}
          />
          {isChoice ? (
            <div className={isMobile ? 'space-y-2' : 'space-y-3 mb-8'}>
              {(qi?.options || []).map((opt, i) => (
                <label
                  key={i}
                  className={`block border rounded-lg cursor-pointer ${
                    selected === opt
                      ? 'border-blue-600 bg-blue-50'
                      : 'hover:bg-gray-50'
                  } ${isMobile ? 'px-4 py-3' : 'px-5 py-4 text-lg'}`}
                >
                  <input
                    type="radio"
                    name="opt"
                    value={opt}
                    checked={selected === opt}
                    onChange={(e) => setSelected(e.target.value)}
                    className={isMobile ? 'mr-2' : 'mr-3'}
                  />
                  {opt}
                </label>
              ))}
            </div>
          ) : (
            <textarea
              className={`w-full border rounded px-3 py-3 ${
                isMobile ? 'h-40 text-base' : 'h-56 text-lg mb-6 px-4 py-4'
              }`}
              value={openText}
              onChange={(e) => setOpenText(e.target.value)}
              placeholder="התשובה שלך…"
            />
          )}
        </>
      )}

      {isMobile ? (
        <>
          <div className="flex-1" />
          <button
            className="w-full bg-blue-600 text-white rounded px-4 py-4 text-lg font-medium disabled:opacity-40"
            disabled={!canSubmit}
            onClick={submit}
          >
            {isContent ? 'הבא' : 'שלח'}
          </button>
        </>
      ) : (
        <button
          className="bg-blue-600 text-white rounded px-6 py-3 text-base font-medium disabled:opacity-40"
          disabled={!canSubmit}
          onClick={submit}
        >
          {isContent ? 'הבא ←' : 'שלח ←'}
        </button>
      )}
    </Shell>
  );
}

function SubmitScreen({ attempt, isMobile, linear, onSubmitted }) {
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const questions = linear.filter((n) => n.kind === 'question');
  const latest = latestAnswerByNode(attempt.answers || []);
  const unanswered = questions.filter((q) => !latest.get(q.id));

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

  const Shell = isMobile ? MobileShell : DesktopShell;
  return (
    <Shell>
      <h2 className={`font-semibold ${isMobile ? 'text-2xl mb-3' : 'text-3xl mb-4'}`}>
        סיימת את כל הפריטים
      </h2>
      <p className="text-gray-700 mb-6">ניתן לשלוח את התשובות לאישור.</p>
      {unanswered.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded p-3 mb-4 text-sm">
          <div className="font-medium mb-1">שים לב</div>
          יש {unanswered.length} שאלות ללא תשובה. חזור ומלא אותן לפני שליחה.
        </div>
      )}
      {err && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded p-3 mb-4 text-sm">
          לא ניתן לשלוח:{' '}
          {err === 'outstanding_questions' ? 'יש שאלות ללא תשובה' : err}
        </div>
      )}
      <button
        className="w-full bg-blue-600 text-white rounded px-4 py-3 text-lg font-medium disabled:opacity-40"
        disabled={busy || unanswered.length > 0}
        onClick={submit}
      >
        {busy ? 'שולח…' : 'שלח לאישור'}
      </button>
    </Shell>
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
  const allFilled = outstanding.every((o) => {
    const d = drafts[o.node.id];
    if (!d) return false;
    const qi = o.node.questionItem;
    if (qi?.answerType === 'single_choice') return !!d.answerChoice;
    return (d.openText || '').trim().length > 0;
  });

  async function submitAll() {
    setErr(null);
    setBusy(true);
    try {
      for (const o of outstanding) {
        const d = drafts[o.node.id];
        await api.attempts.answer(attempt.id, { nodeId: o.node.id, ...d });
      }
      await api.attempts.submit(attempt.id);
      await onSubmitted();
    } catch (e) {
      setErr(e.payload?.error || e.message || 'שגיאה');
    } finally {
      setBusy(false);
    }
  }

  function updateDraft(nodeId, patch) {
    setDrafts((prev) => ({ ...prev, [nodeId]: { ...prev[nodeId], ...patch } }));
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
          {outstanding.map((o) => (
            <OutstandingBlock
              key={o.node.id}
              block={o}
              draft={drafts[o.node.id] || {}}
              onChange={(p) => updateDraft(o.node.id, p)}
            />
          ))}
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
  const { node, precedingContent, lastAnswer } = block;
  const qi = node.questionItem;
  const isChoice = qi?.answerType === 'single_choice';

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
      {precedingContent.length > 0 && (
        <div className="mb-4 pb-4 border-b border-gray-100">
          <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-2">
            תוכן קשור
          </div>
          {precedingContent.map((c) => (
            <div key={c.id} className="mb-3 last:mb-0">
              <div className="text-sm font-medium text-gray-800 mb-1">
                {c.contentItem?.title}
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
          {qi?.title || '(שאלה נמחקה)'}
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

      <div>
        <div className="text-sm font-medium mb-2">התשובה החדשה שלך</div>
        {isChoice ? (
          <div className="space-y-2">
            {(qi?.options || []).map((opt, i) => (
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
                  name={`opt-${node.id}`}
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
        ) : (
          <textarea
            className="w-full border rounded px-3 py-3 h-32"
            value={draft.openText || ''}
            onChange={(e) => onChange({ openText: e.target.value })}
            placeholder="התשובה שלך…"
          />
        )}
      </div>
    </div>
  );
}

function DesktopShell({ children, preview }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
      {preview && <PreviewBanner />}
      <div className="bg-white rounded-xl shadow-sm max-w-2xl w-full p-12">
        {children}
      </div>
    </div>
  );
}

function MobileShell({ children, preview }) {
  return (
    <div
      className={`min-h-screen bg-white flex flex-col px-5 pb-6 ${
        preview ? 'pt-10' : 'pt-8'
      }`}
    >
      {preview && <PreviewBanner />}
      {children}
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
  const linear = flattenNodes(flow.nodes);
  const latest = latestAnswerByNode(attempt.answers || []);

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
          {linear.map((n) => (
            <div
              key={n.id}
              className="bg-white rounded-lg border border-gray-200 p-5"
            >
              {n.kind === 'content' ? (
                <>
                  <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-1">
                    תוכן
                  </div>
                  <h3 className="font-semibold text-lg mb-2">
                    {n.contentItem?.title}
                  </h3>
                  <div
                    className="gos-prose text-sm text-gray-700"
                    dangerouslySetInnerHTML={{
                      __html: n.contentItem?.body || '',
                    }}
                  />
                </>
              ) : (
                <>
                  <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-1">
                    שאלה
                  </div>
                  <h3 className="font-semibold text-lg mb-1">
                    {n.questionItem?.title}
                  </h3>
                  <div
                    className="gos-prose text-sm text-gray-700 mb-3"
                    dangerouslySetInnerHTML={{
                      __html: n.questionItem?.questionText || '',
                    }}
                  />
                  <div className="bg-gray-50 border border-gray-200 rounded p-3 text-sm">
                    <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-1">
                      התשובה שלך
                    </div>
                    <div className="text-gray-800 whitespace-pre-wrap">
                      {(() => {
                        const la = latest.get(n.id);
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
