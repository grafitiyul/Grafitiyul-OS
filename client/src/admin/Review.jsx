import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api.js';

export default function Review() {
  const { id } = useParams();
  const [attempts, setAttempts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [note, setNote] = useState('');

  async function loadList() {
    setAttempts(await api.attempts.listForFlow(id));
  }
  useEffect(() => {
    loadList();
  }, [id]);

  async function open(attemptId) {
    setSelectedId(attemptId);
    setDetail(await api.attempts.get(attemptId));
    setNote('');
  }

  async function approve() {
    await api.reviews.approve(selectedId);
    await loadList();
    setDetail(await api.attempts.get(selectedId));
  }

  async function returnForFix() {
    await api.reviews.returnForFix(selectedId, note);
    await loadList();
    setDetail(await api.attempts.get(selectedId));
    setNote('');
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold">Review</h2>
        <Link
          to={`/admin/flows/${id}/edit`}
          className="text-sm text-blue-600 hover:underline"
        >
          ← Back to builder
        </Link>
      </div>
      <div className="grid grid-cols-[280px_1fr] gap-4">
        <aside className="space-y-2">
          {attempts.map((a) => (
            <button
              key={a.id}
              onClick={() => open(a.id)}
              className={`block w-full text-left bg-white border rounded p-3 hover:border-blue-400 ${
                selectedId === a.id ? 'border-blue-500' : ''
              }`}
            >
              <div className="font-medium truncate">{a.learnerName}</div>
              <div
                className={`text-xs ${
                  a.status === 'awaiting_review'
                    ? 'text-amber-700 font-medium'
                    : 'text-gray-500'
                }`}
              >
                {a.status}
              </div>
            </button>
          ))}
          {!attempts.length && (
            <div className="text-gray-500 italic">No attempts yet.</div>
          )}
        </aside>
        <section className="bg-white border rounded p-6">
          {!detail ? (
            <div className="text-gray-500">Select an attempt on the left.</div>
          ) : (
            <ReviewDetail
              detail={detail}
              note={note}
              setNote={setNote}
              onApprove={approve}
              onReturn={returnForFix}
            />
          )}
        </section>
      </div>
    </div>
  );
}

function flatten(nodes, parentId = null) {
  const sorted = nodes
    .filter((n) => (n.parentId ?? null) === parentId)
    .sort((a, b) => a.order - b.order);
  const out = [];
  for (const n of sorted) {
    if (n.kind === 'group') out.push(...flatten(nodes, n.id));
    else out.push(n);
  }
  return out;
}

function ReviewDetail({ detail, note, setNote, onApprove, onReturn }) {
  const answerMap = new Map(detail.answers.map((a) => [a.flowNodeId, a]));
  const linear = flatten(detail.flow.nodes);

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 pb-4 border-b">
        <div>
          <div className="font-semibold text-lg">{detail.learnerName}</div>
          <div className="text-sm text-gray-500">
            Status:{' '}
            <span
              className={
                detail.status === 'awaiting_review'
                  ? 'text-amber-700 font-medium'
                  : ''
              }
            >
              {detail.status}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {linear.map((n) => {
          const a = answerMap.get(n.id);
          if (n.kind === 'content') {
            return (
              <div key={n.id} className="border rounded p-3 bg-gray-50">
                <div className="text-xs text-gray-500">
                  Content · {n.contentItem?.title || '(deleted)'}
                </div>
                {n.checkpointAfter && (
                  <div className="text-xs text-purple-600 mt-1">
                    ⚑ checkpoint after
                  </div>
                )}
              </div>
            );
          }
          return (
            <div key={n.id} className="border rounded p-3">
              <div className="text-xs text-gray-500 mb-1">
                Question · {n.questionItem?.title || '(deleted)'}
              </div>
              <div className="font-medium mb-2">{n.questionItem?.questionText}</div>
              {a ? (
                <div className="bg-gray-50 rounded p-2 text-sm whitespace-pre-wrap">
                  {n.questionItem?.answerType === 'single_choice'
                    ? a.selectedOption
                    : a.openText}
                </div>
              ) : (
                <div className="text-xs text-gray-400 italic">
                  Not answered yet
                </div>
              )}
              {a && (
                <div className="text-xs mt-1">
                  <span
                    className={
                      a.reviewStatus === 'approved'
                        ? 'text-green-700'
                        : a.reviewStatus === 'returned'
                        ? 'text-amber-700'
                        : 'text-gray-500'
                    }
                  >
                    {a.reviewStatus}
                  </span>
                </div>
              )}
              {n.checkpointAfter && (
                <div className="text-xs text-purple-600 mt-1">
                  ⚑ checkpoint after
                </div>
              )}
            </div>
          );
        })}
      </div>

      {detail.status === 'awaiting_review' && (
        <div className="mt-6 pt-4 border-t space-y-3">
          <textarea
            className="w-full border rounded px-3 py-2 h-20"
            placeholder="Optional note (shown to learner if you return this segment)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              className="bg-green-600 text-white px-4 py-2 rounded"
              onClick={onApprove}
            >
              Approve & continue
            </button>
            <button
              className="bg-amber-500 text-white px-4 py-2 rounded"
              onClick={onReturn}
            >
              Return for correction
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
