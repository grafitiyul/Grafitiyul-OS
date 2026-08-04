import { useMemo, useRef, useState } from 'react';
import AnchoredMenu from '../AnchoredMenu.jsx';
import { DateField, TimeField } from '../pickers/DateTimeFields.jsx';
import {
  OPERATOR_LABELS,
  operatorsFor,
  emptyGroup,
  emptyCondition,
  countActiveConditions,
  updateNodeAt,
  removeNodeAt,
  addChildAt,
} from './advancedFilterCore.js';

// "סינון" — THE shared advanced-filter control (Pipedrive/Airtable style).
// One trigger button; an anchored panel edits a nested AND/OR condition tree.
// Generic by contract: the host screen passes its field registry + rows (for
// derived options) and owns persistence of the tree. Value editors are chosen
// by field type; dates/times use the platform DateField/TimeField (the ONE
// canonical pickers — project rule).

export default function AdvancedFilterButton({ fields, fieldsByKey, tree, onChange, rows }) {
  const btnRef = useRef(null);
  const [open, setOpen] = useState(false);
  const count = countActiveConditions(tree, fieldsByKey);
  // Derived options (staff names, products, cities) are computed once per
  // open/rows change — not per condition row.
  const optionsByField = useMemo(() => {
    const out = {};
    for (const f of fields) {
      if (typeof f.options === 'function') out[f.key] = f.options(rows);
    }
    return out;
  }, [fields, rows]);

  const width = Math.min(660, (typeof window !== 'undefined' ? window.innerWidth : 660) - 16);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm transition ${
          count > 0
            ? 'border-blue-300 bg-blue-50 text-blue-800'
            : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
        }`}
      >
        <FilterIcon active={count > 0} />
        סינון
        {count > 0 && (
          <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[11px] font-bold leading-none text-white">
            {count}
          </span>
        )}
      </button>
      <AnchoredMenu anchorRef={btnRef} open={open} onClose={() => setOpen(false)} width={width}>
        <div className="px-3 pb-3 pt-2">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[13px] font-bold text-gray-800">סינון מתקדם</div>
            {count > 0 && (
              <button
                type="button"
                onClick={() => onChange(emptyGroup())}
                className="text-[12px] text-gray-500 hover:text-red-600 hover:underline"
              >
                נקה הכול
              </button>
            )}
          </div>
          <GroupEditor
            group={tree}
            path={[]}
            depth={0}
            fields={fields}
            fieldsByKey={fieldsByKey}
            optionsByField={optionsByField}
            onChange={onChange}
            tree={tree}
          />
          {tree.children.length === 0 && (
            <div className="mb-2 rounded-lg bg-gray-50 px-3 py-2.5 text-[12.5px] text-gray-500">
              אין תנאים עדיין — הוסיפו תנאי ראשון, או קבוצה לשילוב וגם/או מקונן.
            </div>
          )}
        </div>
      </AnchoredMenu>
    </>
  );
}

// ---------- recursive group editor ----------

function GroupEditor({ group, path, depth, fields, fieldsByKey, optionsByField, onChange, tree }) {
  const isRoot = depth === 0;
  return (
    <div
      className={
        isRoot
          ? ''
          : 'mb-2 rounded-lg border border-gray-200 bg-gray-50/60 p-2'
      }
    >
      <div className={`flex items-center justify-between gap-2 ${group.children.length ? 'mb-2' : ''}`}>
        <OpToggle
          op={group.op}
          onChange={(op) => onChange(updateNodeAt(tree, path, { op }))}
        />
        {!isRoot && (
          <button
            type="button"
            title="הסרת הקבוצה"
            onClick={() => onChange(removeNodeAt(tree, path))}
            className="h-6 w-6 rounded text-gray-400 hover:bg-red-50 hover:text-red-600"
          >
            ✕
          </button>
        )}
      </div>
      <div className="space-y-2">
        {group.children.map((child, i) =>
          child.kind === 'group' ? (
            <GroupEditor
              key={i}
              group={child}
              path={[...path, i]}
              depth={depth + 1}
              fields={fields}
              fieldsByKey={fieldsByKey}
              optionsByField={optionsByField}
              onChange={onChange}
              tree={tree}
            />
          ) : (
            <ConditionRow
              key={i}
              cond={child}
              path={[...path, i]}
              fields={fields}
              fieldsByKey={fieldsByKey}
              optionsByField={optionsByField}
              onChange={onChange}
              tree={tree}
            />
          ),
        )}
      </div>
      <div className={`flex items-center gap-3 ${group.children.length ? 'mt-2' : ''}`}>
        <button
          type="button"
          onClick={() => onChange(addChildAt(tree, path, emptyCondition()))}
          className="text-[12.5px] font-medium text-blue-700 hover:underline"
        >
          + תנאי
        </button>
        <button
          type="button"
          onClick={() =>
            onChange(
              addChildAt(tree, path, { ...emptyGroup(group.op === 'and' ? 'or' : 'and'), children: [emptyCondition()] }),
            )
          }
          className="text-[12.5px] font-medium text-gray-500 hover:text-blue-700 hover:underline"
        >
          + קבוצה
        </button>
      </div>
    </div>
  );
}

// "כל התנאים (וגם)" / "אחד מהתנאים (או)" — segmented toggle, one per group.
function OpToggle({ op, onChange }) {
  const seg = (value, label) => (
    <button
      type="button"
      onClick={() => onChange(value)}
      className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition ${
        op === value ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg bg-gray-100 p-0.5">
      {seg('and', 'כל התנאים (וגם)')}
      {seg('or', 'אחד מהתנאים (או)')}
    </div>
  );
}

// ---------- one condition row: [field] [operator] [value] [✕] ----------

function ConditionRow({ cond, path, fields, fieldsByKey, optionsByField, onChange, tree }) {
  const def = fieldsByKey[cond.field] || null;
  const ops = def ? operatorsFor(def) : [];

  function setField(field) {
    const nextDef = fieldsByKey[field];
    const nextOps = nextDef ? operatorsFor(nextDef) : [];
    // Field change resets operator/value to that field's defaults — a stale
    // value from another type must never survive.
    onChange(updateNodeAt(tree, path, { field, operator: nextOps[0] || '', value: null }));
  }
  function setOperator(operator) {
    const wasBetween = cond.operator === 'between';
    const isBetween = operator === 'between';
    onChange(
      updateNodeAt(tree, path, {
        operator,
        value: wasBetween !== isBetween ? null : cond.value,
      }),
    );
  }
  const setValue = (value) => onChange(updateNodeAt(tree, path, { value }));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        value={cond.field}
        onChange={(e) => setField(e.target.value)}
        className="h-9 min-w-[9rem] rounded-lg border border-gray-300 bg-white px-2 text-[13px] text-gray-800 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
      >
        <option value="">בחירת שדה…</option>
        {fields.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label}
          </option>
        ))}
      </select>
      {def && (
        <select
          value={cond.operator}
          onChange={(e) => setOperator(e.target.value)}
          className="h-9 rounded-lg border border-gray-300 bg-white px-2 text-[13px] text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
        >
          {ops.map((op) => (
            <option key={op} value={op}>
              {OPERATOR_LABELS[op] || op}
            </option>
          ))}
        </select>
      )}
      {def && (
        <ValueEditor
          def={def}
          cond={cond}
          options={optionsByField[def.key] || []}
          onValue={setValue}
        />
      )}
      <button
        type="button"
        title="הסרת התנאי"
        onClick={() => onChange(removeNodeAt(tree, path))}
        className="h-7 w-7 rounded text-gray-400 hover:bg-red-50 hover:text-red-600"
      >
        ✕
      </button>
    </div>
  );
}

function ValueEditor({ def, cond, options, onValue }) {
  const between = cond.operator === 'between';
  const range = cond.value && typeof cond.value === 'object' ? cond.value : { from: '', to: '' };

  if (def.type === 'date') {
    return between ? (
      <span className="flex items-center gap-1.5">
        <DateField value={range.from || ''} onChange={(v) => onValue({ ...range, from: v })} placeholder="מתאריך" />
        <span className="text-[12px] text-gray-400">עד</span>
        <DateField value={range.to || ''} onChange={(v) => onValue({ ...range, to: v })} placeholder="עד תאריך" />
      </span>
    ) : (
      <DateField value={cond.value || ''} onChange={onValue} placeholder="תאריך" />
    );
  }
  if (def.type === 'time') {
    return between ? (
      <span className="flex items-center gap-1.5">
        <TimeField value={range.from || ''} onChange={(v) => onValue({ ...range, from: v })} placeholder="משעה" />
        <span className="text-[12px] text-gray-400">עד</span>
        <TimeField value={range.to || ''} onChange={(v) => onValue({ ...range, to: v })} placeholder="עד שעה" />
      </span>
    ) : (
      <TimeField value={cond.value || ''} onChange={onValue} placeholder="שעה" />
    );
  }
  if (def.type === 'text') {
    return (
      <input
        value={cond.value || ''}
        onChange={(e) => onValue(e.target.value)}
        placeholder="טקסט…"
        className="h-9 min-w-[10rem] flex-1 rounded-lg border border-gray-300 bg-white px-2 text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
      />
    );
  }
  if (def.type === 'staff') {
    return <ComboSelect value={cond.value || ''} options={options} onChange={onValue} placeholder="בחירת איש צוות…" />;
  }
  // 'select'
  return (
    <select
      value={cond.value || ''}
      onChange={(e) => onValue(e.target.value)}
      className="h-9 min-w-[9rem] rounded-lg border border-gray-300 bg-white px-2 text-[13px] text-gray-800 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
    >
      <option value="">בחירת ערך…</option>
      {options.map((o) => (
        <option key={String(o.value)} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// Searchable single-select for potentially long lists (staff) — search while
// typing, keyboard navigation, empty state. Inline dropdown (the panel has no
// overflow clipping) so it nests safely inside the anchored panel.
function ComboSelect({ value, options, onChange, placeholder }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hover, setHover] = useState(0);
  const wrapRef = useRef(null);

  const visible = useMemo(() => {
    const q = query.trim();
    return q ? options.filter((o) => String(o.label).includes(q)) : options;
  }, [options, query]);

  function pick(v) {
    onChange(v);
    setOpen(false);
    setQuery('');
  }
  function onKeyDown(e) {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHover((h) => Math.min(h + 1, visible.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHover((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (visible[hover]) pick(visible[hover].value);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative" onBlur={(e) => {
      if (!wrapRef.current?.contains(e.relatedTarget)) setOpen(false);
    }}>
      <input
        value={open ? query : value || ''}
        onFocus={() => {
          setOpen(true);
          setHover(0);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHover(0);
        }}
        onKeyDown={onKeyDown}
        placeholder={value || placeholder}
        className="h-9 w-44 rounded-lg border border-gray-300 bg-white px-2 text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
      />
      {/* This combobox lives INSIDE the filter's own AnchoredMenu popover,
          which caps its height and scrolls — an in-flow `absolute` list was
          clipped by it. Portaled, and one level up in the floating stack.
          `overlay={false}`: the input's onBlur owns dismissal, and the option
          rows preventDefault on mousedown to hold focus, which still works
          through a portal. */}
      <AnchoredMenu
        anchorRef={wrapRef}
        open={open}
        onClose={() => setOpen(false)}
        matchAnchorWidth
        minWidth={208}
        align="start"
        overlay={false}
      >
        <div className="max-h-52 overflow-y-auto">
          {visible.length === 0 ? (
            <div className="px-3 py-2 text-[12px] text-gray-400">אין תוצאות</div>
          ) : (
            visible.map((o, i) => (
              <button
                key={String(o.value)}
                type="button"
                onMouseDown={(e) => e.preventDefault() /* keep focus — onBlur must not race the pick */}
                onClick={() => pick(o.value)}
                onMouseEnter={() => setHover(i)}
                className={`block w-full truncate px-3 py-1.5 text-right text-[13px] ${
                  i === hover ? 'bg-blue-50 text-blue-800' : 'text-gray-800'
                } ${o.value === value ? 'font-semibold' : ''}`}
              >
                {o.label}
              </button>
            ))
          )}
        </div>
      </AnchoredMenu>
    </div>
  );
}

function FilterIcon({ active }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={active ? 'text-blue-600' : 'text-gray-400'}
    >
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}
