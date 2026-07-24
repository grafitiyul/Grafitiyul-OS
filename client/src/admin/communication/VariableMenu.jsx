import { useEffect, useRef, useState } from 'react';
import AnchoredMenu from '../common/AnchoredMenu.jsx';

// "הוסף משתנה" — category-grouped insert menu over the server-driven variable
// registry (GET /api/communication/meta). Inserts a DynamicFieldNode chip at
// the cursor of the given TipTap editor (or calls onInsert for plain inputs
// like the email subject).
export default function VariableMenu({ variables, categories, editorRef, onInsert, label = 'הוסף משתנה' }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const btnRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
    else setFilter('');
  }, [open]);

  const needle = filter.trim();
  const list = (variables || []).filter(
    (v) => !needle || v.labelHe.includes(needle) || v.key.includes(needle.toLowerCase()),
  );
  const grouped = [];
  for (const [catKey, catLabel] of Object.entries(categories || {})) {
    const items = list.filter((v) => v.category === catKey);
    if (items.length) grouped.push({ catKey, catLabel, items });
  }

  function insert(v) {
    if (onInsert) onInsert(v);
    else {
      const editor = editorRef?.current;
      if (editor) editor.chain().focus().insertDynamicField(v.key).run();
    }
    setOpen(false);
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[12.5px] font-medium text-blue-700 hover:bg-blue-100"
      >
        <span aria-hidden>✦</span>
        {label}
      </button>
      <AnchoredMenu anchorRef={btnRef} open={open} onClose={() => setOpen(false)} width={280}>
        <div dir="rtl" className="flex max-h-80 flex-col">
          <div className="border-b border-gray-100 p-2">
            <input
              ref={inputRef}
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="חיפוש משתנה…"
              className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-[12.5px] focus:border-blue-400 focus:bg-white focus:outline-none"
            />
          </div>
          <div className="overflow-y-auto py-1">
            {!grouped.length && <div className="px-3 py-3 text-center text-[12px] text-gray-400">אין משתנים תואמים</div>}
            {grouped.map(({ catKey, catLabel, items }) => (
              <div key={catKey}>
                <div className="px-3 pb-0.5 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">{catLabel}</div>
                {items.map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => insert(v)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-right text-[13px] text-gray-800 hover:bg-blue-50"
                  >
                    <span>{v.labelHe}</span>
                    <span className="font-mono text-[10px] text-gray-300" dir="ltr">{`{{${v.key}}}`}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      </AnchoredMenu>
    </>
  );
}
