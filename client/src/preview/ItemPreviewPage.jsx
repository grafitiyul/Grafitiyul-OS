import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import '../editor/editor.css';

// Full-page learner-style preview for a bank item. Opened in a new tab from
// the eye icon so it matches the real learner experience — not a cramped
// modal.
export default function ItemPreviewPage({ kind }) {
  const { id } = useParams();
  const [item, setItem] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setItem(null);
    setError(null);
    (async () => {
      try {
        const data =
          kind === 'content'
            ? await api.contentItems.get(id)
            : await api.questionItems.get(id);
        if (!cancelled) setItem(data);
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, kind]);

  const title = item?.title || '(ללא כותרת)';
  useEffect(() => {
    // Set the tab title to the plain-text version of the item title for
    // easy identification across multiple preview tabs.
    const div = document.createElement('div');
    div.innerHTML = title;
    document.title = `תצוגה מקדימה · ${div.textContent || '(ללא כותרת)'}`;
    return () => {
      document.title = 'Grafitiyul OS';
    };
  }, [title]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4 sm:p-8" dir="rtl">
      <PreviewBanner />
      <article className="bg-white rounded-xl shadow-sm max-w-3xl w-full p-6 sm:p-10">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded p-3 text-sm">
            {error}
          </div>
        )}
        {!item && !error && <div className="text-gray-500">טוען…</div>}
        {item && (
          <>
            <h1
              className="gos-prose text-3xl font-semibold text-gray-900 mb-4"
              dangerouslySetInnerHTML={{ __html: item.title || '(ללא כותרת)' }}
            />
            {kind === 'content' && (
              <div
                className="gos-prose text-gray-800 text-lg leading-relaxed"
                dangerouslySetInnerHTML={{ __html: item.body || '' }}
              />
            )}
            {kind === 'question' && (
              <QuestionBody item={item} />
            )}
          </>
        )}
      </article>
    </div>
  );
}

function QuestionBody({ item }) {
  return (
    <>
      <div
        className="gos-prose text-gray-800 text-lg leading-relaxed mb-6"
        dangerouslySetInnerHTML={{ __html: item.questionText || '' }}
      />
      {item.answerType === 'single_choice' && Array.isArray(item.options) && (
        <div className="space-y-3">
          {item.options.map((opt, i) => (
            <div
              key={i}
              className="border border-gray-200 rounded-lg px-5 py-4 text-lg text-gray-700"
            >
              {opt}
            </div>
          ))}
        </div>
      )}
      {item.answerType === 'open_text' && (
        <div className="border border-gray-200 rounded-lg px-5 py-8 text-base text-gray-400 italic">
          תשובה פתוחה — העובד יענה כאן…
        </div>
      )}
    </>
  );
}

function PreviewBanner() {
  return (
    <div className="fixed top-0 inset-x-0 bg-amber-100 text-amber-900 text-xs text-center py-1 z-40">
      תצוגה מקדימה — אין שמירת תשובות
    </div>
  );
}
