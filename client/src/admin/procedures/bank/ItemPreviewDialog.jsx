import { useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';
import { ITEM_KINDS } from './config.js';
import Dialog from '../../common/Dialog.jsx';
import '../../../editor/editor.css';

// Read-only quick preview of a bank item. Shows the item the same way the
// learner / flow runtime renders it (so the title HTML with chips, the body,
// and question options all round-trip visually).
export default function ItemPreviewDialog({ kind, itemId, onClose }) {
  const [item, setItem] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setItem(null);
    setError(null);
    (async () => {
      try {
        const data =
          kind === ITEM_KINDS.CONTENT
            ? await api.contentItems.get(itemId)
            : await api.questionItems.get(itemId);
        if (!cancelled) setItem(data);
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, itemId]);

  return (
    <Dialog open onClose={onClose} title="תצוגה מקדימה" size="lg">
      {!item && !error && <div className="text-gray-500 text-sm">טוען…</div>}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded p-3 text-sm">
          {error}
        </div>
      )}
      {item && (
        <article>
          <h2
            className="gos-prose text-xl font-semibold text-gray-900 mb-3"
            dangerouslySetInnerHTML={{ __html: item.title || '' }}
          />
          {kind === ITEM_KINDS.CONTENT && (
            <div
              className="gos-prose text-gray-800 leading-relaxed"
              dangerouslySetInnerHTML={{ __html: item.body || '' }}
            />
          )}
          {kind === ITEM_KINDS.QUESTION && (
            <>
              <div
                className="gos-prose text-gray-800 mb-3"
                dangerouslySetInnerHTML={{ __html: item.questionText || '' }}
              />
              {item.answerType === 'single_choice' &&
                Array.isArray(item.options) &&
                item.options.length > 0 && (
                  <div className="space-y-2">
                    {item.options.map((opt, i) => (
                      <div
                        key={i}
                        className="border border-gray-200 rounded px-3 py-2 text-sm text-gray-700"
                      >
                        {opt}
                      </div>
                    ))}
                  </div>
                )}
              {item.answerType === 'open_text' && (
                <div className="border border-gray-200 rounded px-3 py-6 text-sm text-gray-400 italic">
                  תשובה פתוחה — העובד יענה כאן…
                </div>
              )}
            </>
          )}
        </article>
      )}
    </Dialog>
  );
}
