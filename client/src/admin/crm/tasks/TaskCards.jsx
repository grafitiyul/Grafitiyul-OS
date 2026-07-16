// TaskIcon = the ONE task-icon renderer (canonical WhatsApp mark included).
import TaskIcon from '../../deals/tasks/TaskIcon.jsx';
import { fmtDate, priorityLabel, PRIORITY_TONE, rowTone, dueDateOf } from './columns.jsx';

// Mobile card renderer for the Tasks workspace — PRESENTATION ONLY.
//
// It receives the exact rows the grid renders and the same handlers the grid
// calls: same canonical filters, same query, same saved views, same bulk
// selection, same drawer, same write path. If a business rule needs to know
// whether the viewport is a phone, something has gone wrong (decision: no
// separate mobile logic).
//
// Layout: one card per task, dense. Tap = open the Deal drawer (the grid's row
// click). The leading checkbox joins the same bulk selection; ✓ is the same
// quick-complete. Conditional tones reuse rowTone, so "overdue is red, today is
// green, terminal recedes" reads identically on both form factors.

export default function TaskCards({
  rows,
  today,
  cursor,
  selected,
  freshIds,
  savingId,
  onOpen, // (idx)
  onToggleSelect, // (id, idx)
  onComplete, // (row)
}) {
  if (!rows.length) return null;
  return (
    <ul className="divide-y divide-gray-100">
      {rows.map((row, idx) => (
        <li
          key={row.id}
          onClick={() => onOpen(idx)}
          className={`flex items-start gap-2.5 px-3 py-2.5 transition-colors duration-700 ${
            freshIds.has(row.id) ? 'bg-indigo-100/70' : rowTone(row, today)
          } ${idx === cursor ? 'ring-1 ring-inset ring-blue-400' : ''} ${
            selected.has(row.id) ? 'bg-blue-50/60' : 'active:bg-gray-50'
          }`}
        >
          <input
            type="checkbox"
            aria-label="בחירת משימה"
            checked={selected.has(row.id)}
            onClick={(e) => e.stopPropagation()}
            onChange={() => onToggleSelect(row.id, idx)}
            className="mt-1 accent-blue-600"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="shrink-0"><TaskIcon name={row.icon} channel={row.channel} size={14} /></span>
              <span className="truncate text-[13px] font-medium text-gray-900">{row.title}</span>
              {row.priority && (
                <span className={`ms-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${PRIORITY_TONE[row.priority]}`}>
                  {priorityLabel(row.priority)}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-500">
              <span dir="ltr" className="tabular-nums">
                {fmtDate(dueDateOf(row))}
                {row.dueTime ? ` · ${row.dueTime}` : ''}
              </span>
              {row.deal && (
                <span className="truncate">
                  #{row.deal.orderNo} · {row.deal.title}
                </span>
              )}
              {row.customer?.name && <span className="truncate">{row.customer.name}</span>}
              {row.owner?.name && <span className="text-gray-400">{row.owner.name}</span>}
            </div>
          </div>
          {row.status === 'open' && (
            <button
              type="button"
              title="סמן כהושלמה"
              disabled={savingId === row.id}
              onClick={(e) => {
                e.stopPropagation();
                onComplete(row);
              }}
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-emerald-200 text-emerald-600 active:bg-emerald-50 disabled:opacity-40"
            >
              ✓
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
