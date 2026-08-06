// Result rows for global search. One component per entity type, one shared
import { DEAL_STATUS_LABELS } from '../../../../shared/dealStatus.mjs';
// shell so keyboard highlighting and click behaviour are identical everywhere.
//
// READING HIERARCHY (index.css §GOS READING HIERARCHY) — the operator must
// recognise the right result in under a second, without reading it:
//
//   L1  .gos-title    the thing's name (deal title / person / organisation)
//   L2  .gos-subject  organisation + contact — the people axis
//   L3  .gos-detail   product / activity + date
//   L4  .gos-meta     technical metadata (#deal number, match reasons)
//
// Nothing was dropped in the process: every field the row used to carry is
// still on the row, just assigned to the level that matches its role. The
// deal number in particular moved OUT of the title line (where it was the
// first thing the eye hit) down to the metadata line, where a technical
// identifier belongs — it is still fully visible and still searchable.

// Canonical Deal lifecycle wording (shared/dealStatus.mjs).
const STATUS_LABEL = DEAL_STATUS_LABELS;

const STATUS_CLASS = {
  open: 'bg-blue-50 text-blue-700 ring-blue-200',
  won: 'bg-green-50 text-green-700 ring-green-200',
  lost: 'bg-gray-100 text-gray-500 ring-gray-200',
};

// Status stays deliberately loud — it is the one signal that must survive
// peripheral vision (product rule: badges remain visually obvious).
function Chip({ children, className = '' }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold leading-none ring-1 ring-inset ${className}`}
    >
      {children}
    </span>
  );
}

// A quieter chip for counts / type labels, which are context and not status.
function CountChip({ children }) {
  return (
    <span className="gos-meta shrink-0 rounded-full bg-gray-100 px-2 py-0.5 leading-none">{children}</span>
  );
}

// The "why did this match" line. Strong (identifier) reasons are visually
// distinct — that is the user's signal that the system understood exactly what
// they typed. Metadata level: it explains the row, it is not the row.
function Reasons({ reasons }) {
  if (!reasons?.length) return null;
  return (
    <>
      {reasons.map((r, i) => (
        <span
          key={i}
          className={`gos-meta shrink-0 rounded px-1.5 py-0.5 leading-none ${
            r.strong ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-500'
          }`}
          title={r.text || r.label}
        >
          {r.label}
          {r.text ? <span className="opacity-70"> · {r.text}</span> : null}
        </span>
      ))}
    </>
  );
}

function Dot() {
  return <span className="gos-sep" aria-hidden>·</span>;
}

// L4 — one metadata line per row: technical identifier first, then the match
// reasons. Always the LAST line, always the smallest thing on the row, so the
// eye learns to skip it until it needs it.
function MetaLine({ children }) {
  return <div className="gos-meta-cluster">{children}</div>;
}

function DealRow({ r }) {
  // L2 — who. Organisation leads (it is the coarser bucket), then unit, then
  // the person; that ordering makes stacked results align on the same axis.
  const who = [r.organizationName, r.unitName, r.contactName].filter(Boolean);
  return (
    <div className="gos-stack min-w-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className="gos-title truncate">{r.title}</span>
        <Chip className={STATUS_CLASS[r.status] || 'bg-gray-100 text-gray-600 ring-gray-200'}>
          {r.stageLabel || STATUS_LABEL[r.status] || r.status}
        </Chip>
      </div>
      {who.length > 0 && (
        <div className="gos-meta-cluster min-w-0">
          {who.map((m, i) => (
            <span key={i} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && <Dot />}
              <span className="gos-subject truncate">{m}</span>
            </span>
          ))}
        </div>
      )}
      {(r.variant || r.tourDate) && (
        <div className="gos-meta-cluster min-w-0">
          {r.variant && <span className="gos-detail truncate">{r.variant}</span>}
          {r.variant && r.tourDate && <Dot />}
          {r.tourDate && (
            <span className={`gos-detail whitespace-nowrap ${r.tourIsFuture ? 'text-green-700' : ''}`}>
              {r.tourIsFuture ? 'סיור עתידי' : 'סיור אחרון'} {r.tourDate}
            </span>
          )}
        </div>
      )}
      <MetaLine>
        <span className="font-mono">#{r.orderNo}</span>
        <Reasons reasons={r.reasons} />
      </MetaLine>
    </div>
  );
}

function ContactRow({ r }) {
  const name = r.fullNameHe || r.fullNameEn;
  // L2 — where this person belongs; L3 — how to reach them.
  const where = [r.organizationName, r.unitName].filter(Boolean);
  const reach = [r.phone, r.email].filter(Boolean);
  return (
    <div className="gos-stack min-w-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className="gos-title truncate">{name}</span>
        {r.fullNameHe && r.fullNameEn && r.fullNameHe !== r.fullNameEn && (
          <span className="gos-detail truncate" dir="auto">{r.fullNameEn}</span>
        )}
        {r.dealCount > 0 && <CountChip>{r.dealCount} עסקאות</CountChip>}
      </div>
      {where.length > 0 && (
        <div className="gos-meta-cluster min-w-0">
          {where.map((m, i) => (
            <span key={i} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && <Dot />}
              <span className="gos-subject truncate">{m}</span>
            </span>
          ))}
        </div>
      )}
      {reach.length > 0 && (
        <div className="gos-meta-cluster min-w-0">
          {reach.map((m, i) => (
            <span key={i} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && <Dot />}
              <span className="gos-detail truncate" dir="auto">{m}</span>
            </span>
          ))}
        </div>
      )}
      <MetaLine>
        {r.recentDeals?.length > 0 && (
          <span className="truncate">
            {r.recentDeals.map((d) => `#${d.orderNo} ${d.title}`).join(' · ')}
          </span>
        )}
        <Reasons reasons={r.reasons} />
      </MetaLine>
    </div>
  );
}

function OrganizationRow({ r }) {
  return (
    <div className="gos-stack min-w-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className="gos-title truncate">{r.name}</span>
        {r.typeLabel && <CountChip>{r.typeLabel}</CountChip>}
      </div>
      {r.units?.length > 0 && (
        <div className="gos-subject truncate">
          {r.units.join(' · ')}
          {r.unitCount > r.units.length ? ` +${r.unitCount - r.units.length}` : ''}
        </div>
      )}
      {(r.dealCount > 0 || r.contactCount > 0) && (
        <div className="gos-meta-cluster">
          {r.dealCount > 0 && <span className="gos-detail">{r.dealCount} עסקאות</span>}
          {r.dealCount > 0 && r.contactCount > 0 && <Dot />}
          {r.contactCount > 0 && <span className="gos-detail">{r.contactCount} אנשי קשר</span>}
        </div>
      )}
      <MetaLine>
        <Reasons reasons={r.reasons} />
      </MetaLine>
    </div>
  );
}

function TaskRow({ r }) {
  return (
    <div className="gos-stack min-w-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className="gos-title truncate">{r.title}</span>
        {r.taskTypeLabel && <CountChip>{r.taskTypeLabel}</CountChip>}
      </div>
      {r.parent && (
        <div className="gos-subject truncate">
          בעסקה {r.parent.title}
        </div>
      )}
      {(r.dueDate || r.ownerName) && (
        <div className="gos-meta-cluster min-w-0">
          {r.dueDate && (
            <span className="gos-detail whitespace-nowrap">
              ליום {r.dueDate}
              {r.dueTime ? ` ${r.dueTime}` : ''}
            </span>
          )}
          {r.dueDate && r.ownerName && <Dot />}
          {r.ownerName && <span className="gos-detail truncate">{r.ownerName}</span>}
        </div>
      )}
      <MetaLine>
        {r.parent?.orderNo != null && <span className="font-mono">#{r.parent.orderNo}</span>}
        <Reasons reasons={r.reasons} />
      </MetaLine>
    </div>
  );
}

const PARENT_LABEL = { deal: 'עסקה', contact: 'איש קשר', organization: 'ארגון' };

function TimelineRow({ r }) {
  return (
    <div className="gos-stack min-w-0">
      <div className="flex items-center gap-2 min-w-0">
        {/* A timeline hit's identity IS its text — but it is authored prose, so
            it reads at the body level rather than as a hard title. */}
        <span className="gos-body min-w-0 flex-1 truncate">{r.excerpt}</span>
        {r.isSystem && <CountChip>מערכת</CountChip>}
      </div>
      {r.parent?.label && (
        <div className="gos-subject truncate">
          {PARENT_LABEL[r.parent?.type] || ''} {r.parent.label}
        </div>
      )}
      {r.authorName && <div className="gos-detail truncate">{r.authorName}</div>}
      <MetaLine>
        {r.parent?.orderNo != null && <span className="font-mono">#{r.parent.orderNo}</span>}
        <Reasons reasons={r.reasons} />
      </MetaLine>
    </div>
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
      // A hairline between results: without it four stacked multi-line rows
      // read as one paragraph no matter how good the typography inside is.
      className={`border-s-2 border-t border-t-gray-100 px-3 py-2.5 cursor-pointer first:border-t-0 ${
        active ? 'bg-blue-50 border-s-blue-500' : 'border-s-transparent hover:bg-gray-50'
      }`}
    >
      <Row r={result} />
    </li>
  );
}
