import Dialog from '../../common/Dialog.jsx';
import { ITEM_KINDS } from '../bank/config.js';
import '../../../editor/editor.css';

// Flow-tree preview. If the node is an item, render it as the learner sees
// it. If the node is a group, render each descendant item in reading order
// (same flatten rule the learner runtime uses: groups are structural,
// descendants appear inline).
export default function FlowNodePreviewDialog({ node, allNodes, onClose }) {
  const isGroup = node.kind === 'group';

  const title = isGroup
    ? node.groupTitle || '(ללא שם)'
    : node.kind === ITEM_KINDS.CONTENT
    ? node.contentItem?.title
    : node.questionItem?.title;

  const items = isGroup ? flattenItems(allNodes, node.id) : [node];

  return (
    <Dialog open onClose={onClose} title="תצוגה מקדימה" size="lg">
      {isGroup && (
        <div className="mb-4 pb-3 border-b border-gray-100">
          <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-1">
            קבוצה
          </div>
          <div className="font-semibold text-lg text-gray-900">{title}</div>
          <div className="text-[11px] text-gray-500 mt-1">
            {items.length} פריטים בסדר קריאה
          </div>
        </div>
      )}
      {items.length === 0 && (
        <div className="text-sm text-gray-500 italic">אין פריטים להצגה.</div>
      )}
      <div className="space-y-5">
        {items.map((n) => (
          <ItemBlock key={n.id} node={n} />
        ))}
      </div>
    </Dialog>
  );
}

function ItemBlock({ node }) {
  if (node.kind === ITEM_KINDS.CONTENT) {
    const ci = node.contentItem;
    return (
      <section>
        <h3
          className="gos-prose font-semibold text-lg text-gray-900 mb-2"
          dangerouslySetInnerHTML={{ __html: ci?.title || '(תוכן נמחק)' }}
        />
        <div
          className="gos-prose text-gray-800 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: ci?.body || '' }}
        />
      </section>
    );
  }
  if (node.kind === ITEM_KINDS.QUESTION) {
    const qi = node.questionItem;
    return (
      <section>
        <h3
          className="gos-prose font-semibold text-lg text-gray-900 mb-2"
          dangerouslySetInnerHTML={{ __html: qi?.title || '(שאלה נמחקה)' }}
        />
        <div
          className="gos-prose text-gray-700 mb-3"
          dangerouslySetInnerHTML={{ __html: qi?.questionText || '' }}
        />
        {qi?.answerType === 'single_choice' && Array.isArray(qi.options) && (
          <div className="space-y-2">
            {qi.options.map((opt, i) => (
              <div
                key={i}
                className="border border-gray-200 rounded px-3 py-2 text-sm text-gray-700"
              >
                {opt}
              </div>
            ))}
          </div>
        )}
        {qi?.answerType === 'open_text' && (
          <div className="border border-gray-200 rounded px-3 py-6 text-sm text-gray-400 italic">
            תשובה פתוחה — העובד יענה כאן…
          </div>
        )}
      </section>
    );
  }
  return null;
}

// Reading order flatten — mirror the learner runtime: groups are structural,
// descendants appear inline in parent → child → next order.
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
