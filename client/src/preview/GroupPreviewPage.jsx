import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import '../editor/editor.css';

// Full-page preview of a group node — walks descendants in reading order,
// exactly as the learner would step through them. One card per item.
export default function GroupPreviewPage() {
  const { flowId, groupId } = useParams();
  const [flow, setFlow] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setFlow(null);
    setError(null);
    (async () => {
      try {
        const data = await api.flows.get(flowId);
        if (!cancelled) setFlow(data);
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [flowId]);

  const group = flow?.nodes?.find((n) => n.id === groupId) || null;
  const items = useMemo(
    () => (flow && group ? flattenItems(flow.nodes, groupId) : []),
    [flow, group, groupId],
  );

  const groupTitle = group?.groupTitle || '(ללא שם)';
  useEffect(() => {
    document.title = `תצוגה מקדימה · קבוצה · ${groupTitle}`;
    return () => {
      document.title = 'Grafitiyul OS';
    };
  }, [groupTitle]);

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8" dir="rtl">
      <div className="fixed top-0 inset-x-0 bg-amber-100 text-amber-900 text-xs text-center py-1 z-40">
        תצוגה מקדימה של קבוצה — {items.length} פריטים בסדר קריאה
      </div>
      <div className="max-w-3xl mx-auto mt-8">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded p-3 text-sm">
            {error}
          </div>
        )}
        {!flow && !error && <div className="text-gray-500">טוען…</div>}
        {flow && !group && (
          <div className="bg-white border border-gray-200 rounded-xl p-6 text-center text-gray-500">
            הקבוצה לא נמצאה.
          </div>
        )}
        {flow && group && (
          <>
            <header className="mb-6">
              <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-1">
                קבוצה
              </div>
              <h1 className="text-2xl font-semibold text-gray-900">{groupTitle}</h1>
            </header>
            {items.length === 0 ? (
              <div className="bg-white border border-gray-200 rounded-xl p-6 text-center text-gray-500">
                אין פריטים בקבוצה.
              </div>
            ) : (
              <div className="space-y-6">
                {items.map((n) => (
                  <ItemCard key={n.id} node={n} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ItemCard({ node }) {
  if (node.kind === 'content') {
    const ci = node.contentItem;
    return (
      <section className="bg-white rounded-xl shadow-sm p-5 sm:p-8">
        <h2
          className="gos-prose text-2xl font-semibold text-gray-900 mb-3"
          dangerouslySetInnerHTML={{ __html: ci?.title || '(תוכן נמחק)' }}
        />
        <div
          className="gos-prose text-gray-800 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: ci?.body || '' }}
        />
      </section>
    );
  }
  if (node.kind === 'question') {
    const qi = node.questionItem;
    return (
      <section className="bg-white rounded-xl shadow-sm p-5 sm:p-8">
        <h2
          className="gos-prose text-2xl font-semibold text-gray-900 mb-3"
          dangerouslySetInnerHTML={{ __html: qi?.title || '(שאלה נמחקה)' }}
        />
        <div
          className="gos-prose text-gray-700 mb-4"
          dangerouslySetInnerHTML={{ __html: qi?.questionText || '' }}
        />
        {qi?.answerType === 'single_choice' && Array.isArray(qi.options) && (
          <div className="space-y-2">
            {qi.options.map((opt, i) => (
              <div
                key={i}
                className="border border-gray-200 rounded px-4 py-3 text-gray-700"
              >
                {opt}
              </div>
            ))}
          </div>
        )}
        {qi?.answerType === 'open_text' && (
          <div className="border border-gray-200 rounded px-4 py-6 text-gray-400 italic">
            תשובה פתוחה — העובד יענה כאן…
          </div>
        )}
      </section>
    );
  }
  return null;
}

function flattenItems(nodes, rootId) {
  const byParent = new Map();
  for (const n of nodes) {
    const key = n.parentId ?? '';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(n);
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.order - b.order);
  function walk(parentId) {
    const arr = byParent.get(parentId) || [];
    const out = [];
    for (const n of arr) {
      if (n.kind === 'group') out.push(...walk(n.id));
      else out.push(n);
    }
    return out;
  }
  return walk(rootId);
}
