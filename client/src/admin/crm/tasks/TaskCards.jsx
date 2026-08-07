// TaskIcon = the ONE task-icon renderer (canonical WhatsApp mark included).
import TaskIcon from '../../deals/tasks/TaskIcon.jsx';
import { fmtDate, priorityLabel, PRIORITY_TONE, rowTone, dueDateOf } from './columns.jsx';
import TaskCheckbox from '../../deals/tasks/TaskCheckbox.jsx';

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
  onReopen, // (row) — terminal (non-sent) rows return to open; same canonical path
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
          {/* Reading hierarchy (index.css §GOS READING HIERARCHY):
              L1 task title → L2 who it is for → L3 when it is due →
              L4 deal number + owner. Same levels the Deal timeline and the
              global search rows use, so a task looks like a task everywhere. */}
          <div className="gos-stack min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="shrink-0"><TaskIcon name={row.icon} channel={row.channel} size={15} /></span>
              <span className="gos-title truncate">{row.title}</span>
              {row.priority && (
                <span className={`ms-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ring-1 ring-inset ${PRIORITY_TONE[row.priority]}`}>
                  {priorityLabel(row.priority)}
                </span>
              )}
            </div>
            {(row.customer?.name || row.deal) && (
              <div className="gos-subject truncate">
                {row.customer?.name || row.deal?.title}
              </div>
            )}
            <div className="gos-detail" dir="ltr">
              <span className="tabular-nums">
                {fmtDate(dueDateOf(row))}
                {row.dueTime ? ` · ${row.dueTime}` : ''}
              </span>
            </div>
            <div className="gos-meta-cluster">
              {row.deal && <span className="gos-meta font-mono">#{row.deal.orderNo}</span>}
              {row.deal && row.customer?.name && <span className="gos-meta truncate">{row.deal.title}</span>}
              {row.owner?.name && <span className="gos-meta truncate">{row.owner.name}</span>}
            </div>
          </div>
          {/* Same control as the table and the Deal strip. Touch gets a bigger
              hit area around the identical 20×20 box — the behaviour is one
              component, the target size is a layout concern. */}
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center">
            <TaskCheckbox
              status={row.status}
              busy={savingId === row.id}
              onComplete={() => onComplete(row)}
              onReopen={onReopen ? () => onReopen(row) : null}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}
