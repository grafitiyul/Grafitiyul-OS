// CRM Tasks workspace — column definitions.
//
// THE SORTABLE CONTRACT (architecture §4, BINDING): `sortable: false` here must
// mirror the server's whitelist (server/src/tasks/taskQuery.js SORTABLE) exactly.
// A column the server cannot order is display-only, and its header must not
// pretend otherwise — clicking it would 400. Columns backed by to-many
// relations (customer, phone, email, operational tour) can never be sorted.
//
// `def: true` = visible on a first visit. Everything else is available through
// the עמודות picker and persists per user (localStorage, via useTableColumns).

// TaskIcon is THE task-icon renderer (one WhatsApp mark across GOS): it routes
// whatsapp — by icon key OR channel — to the shared SVG brand component, and
// everything else to its emoji. Never use the raw taskIcon() string helper for
// display; its whatsapp fallback is a plain green emoji and only exists for
// text-only contexts (<option> labels).
import TaskIcon from '../../deals/tasks/TaskIcon.jsx';

export const COLUMNS_KEY = 'crm.tasks.columns.v1';

// Keys the server will accept in `sort`. Used to scrub stale URLs/saved views
// so a renamed column can never reach the API as a 400.
export const SORTABLE_KEYS = [
  'taskType', 'title', 'dueDate', 'dueTime', 'priority', 'status', 'completedAt',
  'createdAt', 'owner', 'dealOrderNo', 'dealTitle', 'dealStage', 'dealStatus',
  'organization', 'product', 'variant', 'city', 'participants', 'plannedTourDate',
  'communicationLanguage',
];

const HE_STATUS = {
  open: 'פתוחה',
  completed: 'הושלמה',
  cancelled: 'בוטלה',
  sent: 'נשלחה',
  not_sent: 'לא נשלחה',
};

const HE_PRIORITY = { high: 'גבוהה', medium: 'בינונית', low: 'נמוכה' };

const HE_DEAL_STATUS = { open: 'פתוח', won: 'נסגר', lost: 'אבוד' };

const HE_LANG = { he: 'עברית', en: 'אנגלית', es: 'ספרדית', fr: 'צרפתית', ru: 'רוסית' };

export const PRIORITY_TONE = {
  high: 'bg-red-50 text-red-700 ring-red-600/20',
  medium: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  low: 'bg-slate-100 text-slate-600 ring-slate-500/20',
};

/** "YYYY-MM-DD" out of the ISO instant the API returns for a calendar date. */
export function dueDateOf(row) {
  return typeof row.dueDate === 'string' ? row.dueDate.slice(0, 10) : '';
}

/** Israeli display form: DD/MM/YYYY. */
export function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return y ? `${d}/${m}/${y}` : '';
}

export function priorityLabel(p) {
  return HE_PRIORITY[p] || '—';
}
export function statusLabel(s) {
  return HE_STATUS[s] || s;
}

/**
 * The column catalog. Render functions live here; WHICH columns show, in what
 * order, at what width is owned by useTableColumns (the shared infra).
 */
export const TASK_COLUMNS = [
  // ICON ONLY (owner decision): the type name lives in the tooltip and the
  // aria-label, never in the cell — the column stays narrow. Rendering is the
  // canonical TaskIcon (one WhatsApp mark across GOS); the raw string helper is
  // for text-only contexts and must not appear here.
  { key: 'taskType', label: 'סוג', def: true, align: 'center', minWidth: 44, maxWidth: 72, render: (r) => {
    const name = r.taskType?.nameHe || 'סוג משימה';
    return (
      <span
        className="inline-flex items-center justify-center gap-0.5"
        title={r.channel === 'whatsapp' ? `${name} — נעול (קשור להודעה מתוזמנת)` : name}
        aria-label={name}
        role="img"
      >
        <TaskIcon name={r.icon} channel={r.channel} size={16} />
        {/* The WhatsApp type lock stays VISIBLE — never a silent no-op. */}
        {r.channel === 'whatsapp' && <span aria-hidden className="text-[9px] opacity-60">🔒</span>}
      </span>
    );
  } },
  { key: 'title', label: 'משימה', def: true, minWidth: 180, render: (r) => (
    <span className="block truncate font-medium text-gray-900" title={r.title}>{r.title}</span>
  ) },
  { key: 'dueDate', label: 'תאריך יעד', def: true, dir: 'ltr', minWidth: 100, render: (r) => fmtDate(r.dueDate) },
  // dueTime matters operationally: TaskType.requiresTime makes timed tasks a
  // real category, and "today" without a time is not actionable.
  { key: 'dueTime', label: 'שעה', def: true, dir: 'ltr', minWidth: 70, render: (r) => r.dueTime || '' },
  { key: 'priority', label: 'עדיפות', def: true, minWidth: 90, render: (r) => (
    r.priority
      ? <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${PRIORITY_TONE[r.priority]}`}>{priorityLabel(r.priority)}</span>
      : <span className="text-gray-300">—</span>
  ) },
  { key: 'owner', label: 'אחראי', def: true, minWidth: 110, render: (r) => r.owner?.name || '—' },
  { key: 'dealOrderNo', label: 'מס׳ דיל', def: true, dir: 'ltr', minWidth: 80, render: (r) => r.deal?.orderNo ?? '' },
  { key: 'dealTitle', label: 'דיל', def: true, minWidth: 160, render: (r) => (
    <span className="block truncate" title={r.deal?.title}>{r.deal?.title || '—'}</span>
  ) },
  // DISPLAY-ONLY: Deal -> DealContact[] -> Contact is to-many.
  { key: 'customer', label: 'לקוח', def: true, sortable: false, minWidth: 130, render: (r) => (
    <span className="block truncate">{r.customer?.name || '—'}</span>
  ) },
  { key: 'dealStage', label: 'שלב', def: true, minWidth: 100, render: (r) => (
    r.deal?.stage ? <span className="inline-flex rounded-md bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700">{r.deal.stage.label}</span> : '—'
  ) },
  { key: 'status', label: 'סטטוס', minWidth: 90, render: (r) => statusLabel(r.status) },
  // DISPLAY-ONLY: through Contact.phones[] / Contact.emails[].
  { key: 'phone', label: 'טלפון', sortable: false, dir: 'ltr', minWidth: 110, render: (r) => r.customer?.phone || '—' },
  { key: 'email', label: 'אימייל', sortable: false, dir: 'ltr', minWidth: 150, render: (r) => (
    <span className="block truncate">{r.customer?.email || '—'}</span>
  ) },
  { key: 'organization', label: 'ארגון', minWidth: 130, render: (r) => (
    <span className="block truncate">{r.deal?.organization?.name || '—'}</span>
  ) },
  { key: 'dealStatus', label: 'סטטוס דיל', minWidth: 90, render: (r) => HE_DEAL_STATUS[r.deal?.status] || '—' },
  { key: 'product', label: 'מוצר', minWidth: 120, render: (r) => (
    <span className="block truncate">{r.deal?.product?.name || '—'}</span>
  ) },
  { key: 'variant', label: 'וריאנט', minWidth: 110, render: (r) => r.deal?.variant?.name || '—' },
  { key: 'city', label: 'עיר', minWidth: 90, render: (r) => r.deal?.city?.name || '—' },
  { key: 'participants', label: 'משתתפים', dir: 'ltr', align: 'center', minWidth: 80, render: (r) => r.deal?.participants ?? '—' },
  // The Deal's PLANNED tour date — a pre-WON sales field. Sortable.
  { key: 'plannedTourDate', label: 'תאריך סיור (מתוכנן)', dir: 'ltr', minWidth: 120, render: (r) => fmtDate(r.deal?.plannedTourDate) || '—' },
  // The OPERATIONAL tour via Booking -> TourEvent. A DIFFERENT fact from the
  // planned date above, and to-many, so display-only. Never merge the two.
  { key: 'upcomingTour', label: 'סיור קרוב', sortable: false, dir: 'ltr', minWidth: 120, render: (r) => (
    r.upcomingTour ? `${fmtDate(r.upcomingTour.date)}${r.upcomingTour.startTime ? ` ${r.upcomingTour.startTime}` : ''}` : '—'
  ) },
  { key: 'communicationLanguage', label: 'שפה', minWidth: 80, render: (r) => HE_LANG[r.deal?.communicationLanguage] || '—' },
  { key: 'createdAt', label: 'נוצרה', dir: 'ltr', minWidth: 100, render: (r) => fmtDate(r.createdAt) },
  { key: 'completedAt', label: 'הושלמה ב־', dir: 'ltr', minWidth: 100, render: (r) => fmtDate(r.completedAt) || '—' },
];

/**
 * Conditional row formatting. Overdue is the one an operator must see without
 * reading a date; terminal rows recede.
 *
 * COMPLETED rows additionally get ONE row-level strikethrough (owner decision):
 * `line-through` on the row propagates to every cell's text, and interactive
 * controls (buttons / selects / inputs — the checkbox, ✓, inline editors) opt
 * back out via descendant resets so they stay readable and clickable. 60%
 * opacity keeps the data legible; completed tasks remain editable for record
 * corrections. Other terminal statuses (cancelled/sent/not_sent) keep the
 * existing recede-only treatment — they were never "done", so they don't earn
 * the done-mark.
 */
export function rowTone(row, today) {
  if (row.status === 'completed') {
    return 'opacity-60 line-through decoration-gray-400/80 [&_button]:no-underline [&_select]:no-underline [&_input]:no-underline';
  }
  if (row.status !== 'open') return 'opacity-55';
  const due = dueDateOf(row);
  if (due && today && due < today) return 'bg-red-50/40';
  if (due && today && due === today) return 'bg-emerald-50/40';
  return '';
}
