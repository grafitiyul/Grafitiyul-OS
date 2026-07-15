// Result rows for global search. One component per entity type, one shared
// shell so keyboard highlighting and click behaviour are identical everywhere.

const STATUS_LABEL = { open: 'פתוח', won: 'נסגר', lost: 'אבוד' };

const STATUS_CLASS = {
  open: 'bg-blue-50 text-blue-700',
  won: 'bg-green-50 text-green-700',
  lost: 'bg-gray-100 text-gray-500',
};

function Chip({ children, className = '' }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] leading-none ${className}`}>{children}</span>
  );
}

// The "why did this match" line. Strong (identifier) reasons are visually
// distinct — that is the user's signal that the system understood exactly what
// they typed.
function Reasons({ reasons }) {
  if (!reasons?.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-1">
      {reasons.map((r, i) => (
        <span
          key={i}
          className={`text-[11px] leading-none rounded px-1.5 py-0.5 ${
            r.strong ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-500'
          }`}
          title={r.text || r.label}
        >
          {r.label}
          {r.text ? <span className="text-gray-400"> · {r.text}</span> : null}
        </span>
      ))}
    </div>
  );
}

function Dot() {
  return <span className="text-gray-300">·</span>;
}

function DealRow({ r }) {
  const meta = [r.contactName, r.organizationName, r.unitName].filter(Boolean);
  return (
    <>
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[12px] font-mono text-gray-400 shrink-0">#{r.orderNo}</span>
        <span className="truncate text-[13px] text-gray-900">{r.title}</span>
        <Chip className={STATUS_CLASS[r.status] || 'bg-gray-100 text-gray-600'}>
          {r.stageLabel || STATUS_LABEL[r.status] || r.status}
        </Chip>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-gray-500 mt-0.5">
        {meta.map((m, i) => (
          <span key={i} className="flex items-center gap-1.5 min-w-0">
            {i > 0 && <Dot />}
            <span className="truncate">{m}</span>
          </span>
        ))}
        {r.variant && (
          <>
            {meta.length > 0 && <Dot />}
            <span className="truncate">{r.variant}</span>
          </>
        )}
        {r.tourDate && (
          <>
            <Dot />
            <span className={r.tourIsFuture ? 'text-green-700' : 'text-gray-400'}>
              {r.tourIsFuture ? 'סיור עתידי' : 'סיור אחרון'} {r.tourDate}
            </span>
          </>
        )}
      </div>
      <Reasons reasons={r.reasons} />
    </>
  );
}

function ContactRow({ r }) {
  const name = r.fullNameHe || r.fullNameEn;
  const meta = [r.phone, r.email, r.organizationName, r.unitName].filter(Boolean);
  return (
    <>
      <div className="flex items-center gap-2 min-w-0">
        <span className="truncate text-[13px] text-gray-900">{name}</span>
        {r.fullNameHe && r.fullNameEn && r.fullNameHe !== r.fullNameEn && (
          <span className="truncate text-[12px] text-gray-400">{r.fullNameEn}</span>
        )}
        {r.dealCount > 0 && <Chip className="bg-gray-100 text-gray-600">{r.dealCount} עסקאות</Chip>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-gray-500 mt-0.5">
        {meta.map((m, i) => (
          <span key={i} className="flex items-center gap-1.5 min-w-0">
            {i > 0 && <Dot />}
            <span className="truncate" dir="auto">
              {m}
            </span>
          </span>
        ))}
      </div>
      {r.recentDeals?.length > 0 && (
        <div className="text-[11px] text-gray-400 mt-0.5 truncate">
          {r.recentDeals.map((d) => `#${d.orderNo} ${d.title}`).join(' · ')}
        </div>
      )}
      <Reasons reasons={r.reasons} />
    </>
  );
}

function OrganizationRow({ r }) {
  return (
    <>
      <div className="flex items-center gap-2 min-w-0">
        <span className="truncate text-[13px] text-gray-900">{r.name}</span>
        {r.typeLabel && <Chip className="bg-gray-100 text-gray-600">{r.typeLabel}</Chip>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-gray-500 mt-0.5">
        {r.units?.length > 0 && (
          <span className="truncate">
            {r.units.join(' · ')}
            {r.unitCount > r.units.length ? ` +${r.unitCount - r.units.length}` : ''}
          </span>
        )}
        {r.dealCount > 0 && (
          <>
            {r.units?.length > 0 && <Dot />}
            <span>{r.dealCount} עסקאות</span>
          </>
        )}
        {r.contactCount > 0 && (
          <>
            <Dot />
            <span>{r.contactCount} אנשי קשר</span>
          </>
        )}
      </div>
      <Reasons reasons={r.reasons} />
    </>
  );
}

function TaskRow({ r }) {
  return (
    <>
      <div className="flex items-center gap-2 min-w-0">
        <span className="truncate text-[13px] text-gray-900">{r.title}</span>
        {r.taskTypeLabel && <Chip className="bg-gray-100 text-gray-600">{r.taskTypeLabel}</Chip>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-gray-500 mt-0.5">
        {r.parent && (
          <span className="truncate">
            בעסקה #{r.parent.orderNo} {r.parent.title}
          </span>
        )}
        {r.dueDate && (
          <>
            <Dot />
            <span>
              ליום {r.dueDate}
              {r.dueTime ? ` ${r.dueTime}` : ''}
            </span>
          </>
        )}
        {r.ownerName && (
          <>
            <Dot />
            <span>{r.ownerName}</span>
          </>
        )}
      </div>
      <Reasons reasons={r.reasons} />
    </>
  );
}

const PARENT_LABEL = { deal: 'עסקה', contact: 'איש קשר', organization: 'ארגון' };

function TimelineRow({ r }) {
  return (
    <>
      <div className="flex items-center gap-2 min-w-0">
        <span className="truncate text-[13px] text-gray-700">{r.excerpt}</span>
        {r.isSystem && <Chip className="bg-gray-100 text-gray-500">מערכת</Chip>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-gray-500 mt-0.5">
        <span className="truncate">
          {PARENT_LABEL[r.parent?.type] || ''}
          {r.parent?.orderNo ? ` #${r.parent.orderNo}` : ''} {r.parent?.label}
        </span>
        {r.authorName && (
          <>
            <Dot />
            <span>{r.authorName}</span>
          </>
        )}
      </div>
      <Reasons reasons={r.reasons} />
    </>
  );
}

const ROWS = {
  deal: DealRow,
  contact: ContactRow,
  organization: OrganizationRow,
  task: TaskRow,
  timeline: TimelineRow,
};

export default function SearchResultRow({ result, active, onSelect, onHover, id }) {
  const Row = ROWS[result.type];
  if (!Row) return null;
  return (
    <li
      id={id}
      role="option"
      aria-selected={active}
      onMouseDown={(e) => {
        // mousedown, not click: the input's blur would otherwise close the
        // panel before the click lands.
        e.preventDefault();
        onSelect(result);
      }}
      onMouseEnter={onHover}
      className={`px-3 py-2 cursor-pointer border-s-2 ${
        active ? 'bg-blue-50 border-s-blue-500' : 'border-s-transparent hover:bg-gray-50'
      }`}
    >
      <Row r={result} />
    </li>
  );
}
