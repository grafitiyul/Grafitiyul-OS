import { useEffect, useState, useMemo, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';

export default function LearnerRuntime() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const isPreview = params.get('preview') === '1';

  const [flow, setFlow] = useState(null);
  const [attempt, setAttempt] = useState(null);
  const [learnerName, setLearnerName] = useState(
    () => localStorage.getItem(`gos.name.${id}`) || ''
  );
  const [isMobile, setIsMobile] = useState(() =>
    window.matchMedia('(max-width: 640px)').matches
  );

  // Preview-only local state
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
      const f = await api.flows.get(id);
      setFlow(f);
    })();
  }, [id]);

  const linear = useMemo(
    () => (flow ? flattenNodes(flow.nodes) : []),
    [flow]
  );

  // Poll attempt when awaiting review
  const pollRef = useRef(null);
  useEffect(() => {
    if (!attempt || attempt.status !== 'awaiting_review') return;
    pollRef.current = setInterval(async () => {
      const a = await api.attempts.get(attempt.id);
      setAttempt(a);
    }, 5000);
    return () => clearInterval(pollRef.current);
  }, [attempt?.id, attempt?.status]);

  async function startAttempt() {
    if (!learnerName.trim()) return;
    localStorage.setItem(`gos.name.${id}`, learnerName.trim());
    const a = await api.attempts.create(id, learnerName.trim());
    setAttempt(a);
  }

  async function handleNext(answerPayload) {
    if (isPreview) {
      if (answerPayload) {
        setPreviewAnswers({
          ...previewAnswers,
          [currentNode.id]: answerPayload,
        });
      }
      setPreviewIdx(previewIdx + 1);
      return;
    }
    if (answerPayload) {
      await api.attempts.answer(attempt.id, {
        nodeId: currentNode.id,
        ...answerPayload,
      });
    }
    const next = await api.attempts.advance(attempt.id);
    setAttempt(next);
  }

  async function resumeAfterReturn() {
    const next = await api.attempts.resume(attempt.id);
    setAttempt(next);
  }

  if (!flow) {
    return (
      <Screen>
        <div className="text-gray-500">Loading…</div>
      </Screen>
    );
  }

  if (!isPreview && !attempt) {
    return (
      <NameGate
        isMobile={isMobile}
        flow={flow}
        name={learnerName}
        setName={setLearnerName}
        onStart={startAttempt}
      />
    );
  }

  // Determine current node
  let currentNode = null;
  if (isPreview) {
    currentNode = linear[previewIdx] || null;
  } else if (attempt) {
    currentNode = linear.find((n) => n.id === attempt.currentNodeId) || null;
  }

  // Live status branches
  if (!isPreview && attempt) {
    if (attempt.status === 'awaiting_review') {
      return <WaitingScreen preview={false} />;
    }
    if (attempt.status === 'returned') {
      return (
        <ReturnedScreen attempt={attempt} onResume={resumeAfterReturn} />
      );
    }
    if (attempt.status === 'completed') {
      return <CompletedScreen />;
    }
  } else if (isPreview && previewIdx >= linear.length) {
    return <CompletedScreen preview />;
  }

  if (!currentNode) {
    return (
      <Screen>
        <div className="text-gray-500">This flow has no runnable items yet.</div>
      </Screen>
    );
  }

  return (
    <ItemScreen
      node={currentNode}
      isMobile={isMobile}
      isPreview={isPreview}
      existingAnswer={
        isPreview
          ? previewAnswers[currentNode.id]
          : attempt?.answers?.find((a) => a.flowNodeId === currentNode.id)
      }
      onNext={handleNext}
    />
  );
}

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
      Preview mode — no data is saved
    </div>
  );
}

function NameGate({ isMobile, flow, name, setName, onStart }) {
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
        <label className="block text-sm font-medium mb-2">Your name</label>
        <input
          autoFocus
          className="w-full border rounded px-3 py-3 mb-4 text-lg"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onStart()}
        />
        <button
          onClick={onStart}
          disabled={!name.trim()}
          className="w-full bg-blue-600 text-white rounded px-4 py-3 text-lg disabled:opacity-40"
        >
          Start
        </button>
      </div>
    </div>
  );
}

function ItemScreen({ node, isMobile, isPreview, existingAnswer, onNext }) {
  const [openText, setOpenText] = useState(existingAnswer?.openText || '');
  const [selected, setSelected] = useState(existingAnswer?.selectedOption || '');

  useEffect(() => {
    setOpenText(existingAnswer?.openText || '');
    setSelected(existingAnswer?.selectedOption || '');
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
    else onNext(isChoice ? { selectedOption: selected } : { openText });
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
            {ci?.title || '(deleted content)'}
          </h2>
          <div
            className={`whitespace-pre-wrap text-gray-800 ${
              isMobile ? 'text-base' : 'text-lg leading-relaxed mb-8'
            }`}
          >
            {ci?.body || ''}
          </div>
        </>
      ) : (
        <>
          <h2
            className={`font-semibold ${
              isMobile ? 'text-xl mb-2' : 'text-3xl mb-3'
            }`}
          >
            {qi?.title || '(deleted question)'}
          </h2>
          <div
            className={`text-gray-700 whitespace-pre-wrap ${
              isMobile ? 'text-base mb-4' : 'text-lg mb-6'
            }`}
          >
            {qi?.questionText || ''}
          </div>
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
              placeholder="Your answer…"
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
            {isContent ? 'Next' : 'Submit'}
          </button>
        </>
      ) : (
        <button
          className="bg-blue-600 text-white rounded px-6 py-3 text-base font-medium disabled:opacity-40"
          disabled={!canSubmit}
          onClick={submit}
        >
          {isContent ? 'Next →' : 'Submit →'}
        </button>
      )}
    </Shell>
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
        <h2 className="text-2xl font-semibold mb-2">Waiting for review</h2>
        <p className="text-gray-600">
          Your progress has been submitted. An admin will review it shortly —
          this screen updates automatically.
        </p>
      </div>
    </div>
  );
}

function ReturnedScreen({ attempt, onResume }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow p-8 max-w-md w-full">
        <h2 className="text-2xl font-semibold mb-3">Sent back for correction</h2>
        {attempt.reviewNote && (
          <div className="bg-amber-50 border border-amber-200 rounded p-3 mb-4 text-sm whitespace-pre-wrap">
            <div className="font-medium mb-1">Reviewer note</div>
            {attempt.reviewNote}
          </div>
        )}
        <p className="text-gray-600 mb-6">
          Please redo this section of the flow.
        </p>
        <button
          className="w-full bg-blue-600 text-white rounded px-4 py-3 text-lg"
          onClick={onResume}
        >
          Continue
        </button>
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
          {preview ? 'Preview complete' : 'Flow complete'}
        </h2>
        <p className="text-gray-600 mt-2">
          {preview ? 'End of preview.' : 'Thank you.'}
        </p>
      </div>
    </div>
  );
}
