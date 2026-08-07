// Result rows for global search. One component per entity type, one shared
import { DEAL_STATUS_LABELS } from '../../../../shared/dealStatus.mjs';
import EntityPeek from './EntityPeek.jsx';
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

// A name on a row that IS another entity: hover peeks at it, click opens it
// instead of the row. Falls back to plain text whenever the server sent no ref
// (an entity that no longer resolves, or a row type that never had one), so a
// missing ref degrades to exactly the previous rendering rather than to a
// broken link.
//
// One component, used by EVERY row type — a contact named under a deal, a
// contact named under a note and an organization named under a contact all
// behave the same way.
function EntityName({ entity, fallback, context, onOpenEntity, className = 'gos-subject truncate' }) {
  if (!entity || !onOpenEntity) {
    return fallback ? <span className={className}>{fallback}</span> : null;
  }
  return (
    <EntityPeek entity={entity} context={context} onOpen={onOpenEntity} className={className} />
  );
}

// L4 — one metadata line per row: technical identifier first, then the match
// reasons. Always the LAST line, always the smallest thing on the row, so the
// eye learns to skip it until it needs it.
function MetaLine({ children }) {
  return <div className="gos-meta-cluster">{children}</div>;
}

function DealRow({ r, onOpenEntity }) {
  // L2 — who. Organisation leads (it is the coarser bucket), then unit, then
  // the person; that ordering makes stacked results align on the same axis.
  //
  // The organisation and the person are now TARGETS (EntityName); the unit is
  // not — a unit has no page of its own, it qualifies the organisation, and it
  // is shown as such on the organisation's hover card.
  const who = [
    r.organizationName
      ? { key: 'org', node: (
        <EntityName
          entity={r.organizationRef}
          fallback={r.organizationName}
          context={{ unitName: r.unitName, subtypeLabel: r.organizationSubtypeLabel }}
          onOpenEntity={onOpenEntity}
        />
      ) }
      : null,
    r.unitName ? { key: 'unit', node: <span className="gos-subject truncate">{r.unitName}</span> } : null,
    r.contactName
      ? { key: 'contact', node: (
        <EntityName entity={r.contactRef} fallback={r.contactName} onOpenEntity={onOpenEntity} />
      ) }
      : null,
  ].filter(Boolean);
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
            <span key={m.key} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && <Dot />}
              {m.node}
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

function ContactRow({ r, onOpenEntity }) {
  const name = r.fullNameHe || r.fullNameEn;
  // L2 — where this person belongs; L3 — how to reach them.
  // The organisation is a target here for the same reason it is on a deal row:
  // the same entity must behave the same way wherever it is named. The person
  // is NOT — the row already is that person, and clicking the row opens them.
  const where = [
    r.organizationName
      ? { key: 'org', node: (
        <EntityName
          entity={r.organizationRef}
          fallback={r.organizationName}
          context={{ unitName: r.unitName }}
          onOpenEntity={onOpenEntity}
        />
      ) }
      : null,
    r.unitName ? { key: 'unit', node: <span className="gos-subject truncate">{r.unitName}</span> } : null,
  ].filter(Boolean);
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
            <span key={m.key} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && <Dot />}
              {m.node}
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

function TimelineRow({ r, onOpenEntity }) {
  // A note written ON a contact or ON an organization names that entity — the
  // same reference, so the same behaviour. A note on a DEAL names the deal,
  // which is already what the row opens, so it stays plain text.
  const peekableParent =
    r.parent && (r.parent.type === 'contact' || r.parent.type === 'organization')
      ? { type: r.parent.type, id: r.parent.id, name: r.parent.label, path: r.parent.path }
      : null;
  return (
    <div className="gos-stack min-w-0">
      <div className="flex items-center gap-2 min-w-0">
        {/* A timeline hit's identity IS its text — but it is authored prose, so
            it reads at the body level rather than as a hard title. */}
        <span className="gos-body min-w-0 flex-1 truncate">{r.excerpt}</span>
        {r.isSystem && <CountChip>מערכת</CountChip>}
      </div>
      {r.parent?.label && (
        <div className="gos-meta-cluster min-w-0">
          <span className="gos-subject shrink-0">{PARENT_LABEL[r.parent?.type] || ''}</span>
          <EntityName
            entity={peekableParent}
            fallback={r.parent.label}
            onOpenEntity={onOpenEntity}
          />
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

export default function SearchResultRow({ result, active, onSelect, onHover, onOpenEntity, id }) {
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
      <Row r={result} onOpenEntity={onOpenEntity} />
    </li>
  );
}
