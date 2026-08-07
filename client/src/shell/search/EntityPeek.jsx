import { useCallback, useState } from 'react';
import HoverCard from '../../admin/common/HoverCard.jsx';
import { peekEntity } from './entityPeek.js';
import { formatPhoneDisplay } from '../../lib/phone.js';

// ONE primitive for every Contact / Organization reference named inside a
// search result row.
//
// A result row is about ONE thing, but it usually NAMES others: a deal row
// names its contact and its organization. Those names are the fastest route to
// the thing the operator actually wants — so they became real targets:
//
//   hover → a compact card with the canonical details, after a short
//           INTENTIONAL delay, fetched only once the card actually opens
//   click → opens THAT entity, not the row's entity
//
// Everything else about the row is unchanged: clicking anywhere else still
// opens the row. The nested click stops propagation, and — because the search
// panel commits on mousedown — it stops mousedown too, which is the event that
// would otherwise have opened the deal before a click ever landed.
//
// Deliberately ONE component with a `type` rather than a ContactPeek and an
// OrganizationPeek: hover timing, positioning, fetch/cache, the click contract
// and the visual affordance are identical, and only the card body differs. Two
// components would have been two places to fix the next timing bug.

const NBSP = ' ';

function Line({ label, children }) {
  return (
    <div className="flex gap-2 text-[12px] leading-relaxed">
      <span className="w-[52px] shrink-0 text-gray-400">{label}</span>
      <span className="min-w-0 flex-1 text-gray-800">{children}</span>
    </div>
  );
}

function ContactCard({ data }) {
  return (
    <div dir="rtl" className="space-y-1.5">
      <div className="flex items-baseline gap-2">
        <span className="gos-title truncate">{data.nameHe || data.nameEn}</span>
        {data.nameHe && data.nameEn && data.nameHe !== data.nameEn ? (
          <span className="gos-detail truncate" dir="auto">{data.nameEn}</span>
        ) : null}
      </div>

      {data.phones.length ? (
        <Line label="טלפון">
          {data.phones.map((p, i) => (
            <span key={p.value} className="block" dir="ltr">
              {formatPhoneDisplay(p.value)}
              {p.label ? <span className="text-gray-400">{NBSP}· {p.label}</span> : null}
              {i === 0 && data.phones.length > 1 ? null : null}
            </span>
          ))}
        </Line>
      ) : null}

      {data.emails.length ? (
        <Line label="אימייל">
          {data.emails.map((e) => (
            <span key={e.value} className="block truncate" dir="ltr">{e.value}</span>
          ))}
        </Line>
      ) : null}

      {data.organizations.length ? (
        <Line label="ארגון">
          {data.organizations.map((o) => (
            <span key={o.id} className="block truncate">
              {o.name}
              {o.unitName ? <span className="text-gray-500">{NBSP}· {o.unitName}</span> : null}
              {o.isPrimary && data.organizations.length > 1 ? (
                <span className="text-gray-400">{NBSP}★</span>
              ) : null}
            </span>
          ))}
          {data.moreOrganizations > 0 ? (
            <span className="block text-gray-400">ועוד {data.moreOrganizations}</span>
          ) : null}
        </Line>
      ) : null}

      {!data.phones.length && !data.emails.length && !data.organizations.length ? (
        <p className="text-[12px] text-gray-400">אין פרטי קשר שמורים.</p>
      ) : null}

      {data.dealCount > 0 ? (
        <p className="border-t border-gray-100 pt-1.5 text-[11.5px] text-gray-500">
          {data.dealCount} עסקאות
        </p>
      ) : null}
    </div>
  );
}

// `context` is what the ROW knows and the organization record does not: the
// unit this deal is on, and the deal's organization SUBTYPE (which lives on the
// Deal by schema, never on the Organization).
function OrganizationCard({ data, context }) {
  const unitName = context?.unitName || null;
  return (
    <div dir="rtl" className="space-y-1.5">
      <div className="gos-title truncate">{data.name}</div>

      {data.typeLabel ? <Line label="סוג">{data.typeLabel}</Line> : null}
      {context?.subtypeLabel ? (
        <Line label="תת-סוג">
          {context.subtypeLabel}
          <span className="text-gray-400">{NBSP}(לפי העסקה)</span>
        </Line>
      ) : null}
      {unitName ? <Line label="יחידה">{unitName}</Line> : null}

      {!unitName && data.units.length ? (
        <Line label="יחידות">
          {data.units.map((u) => u.name).join(' · ')}
          {data.moreUnits > 0 ? <span className="text-gray-400">{NBSP}+{data.moreUnits}</span> : null}
        </Line>
      ) : null}

      {data.dealCount > 0 || data.contactCount > 0 ? (
        <p className="border-t border-gray-100 pt-1.5 text-[11.5px] text-gray-500">
          {[
            data.dealCount > 0 ? `${data.dealCount} עסקאות` : null,
            data.contactCount > 0 ? `${data.contactCount} אנשי קשר` : null,
          ].filter(Boolean).join(' · ')}
        </p>
      ) : null}
    </div>
  );
}

// Long enough that crossing the list on the way elsewhere never opens a card,
// short enough that stopping ON a name feels immediate.
const HOVER_DELAY_MS = 350;

/**
 * @param entity  a ref from the server: { type, id, name, path, unitName? }
 * @param context row-owned qualifiers the entity record cannot know
 * @param onOpen  navigate to `path` — supplied by the search panel so it can
 *                also close itself and commit the recent search
 */
export default function EntityPeek({ entity, context = null, onOpen, className = '' }) {
  const [data, setData] = useState(null);
  const [state, setState] = useState('idle'); // idle | loading | ready | missing

  const load = useCallback(() => {
    if (state !== 'idle') return;
    setState('loading');
    peekEntity(entity.type, entity.id).then((d) => {
      setData(d);
      setState(d ? 'ready' : 'missing');
    });
  }, [entity.type, entity.id, state]);

  const activate = (e) => {
    // The row commits on MOUSEDOWN, so stopping click alone is not enough —
    // the deal would already be opening. Both are stopped, and preventDefault
    // keeps the search input from blurring underneath us.
    e.preventDefault();
    e.stopPropagation();
    onOpen?.(entity.path);
  };

  return (
    <HoverCard
      width={272}
      align="start"
      openDelay={HOVER_DELAY_MS}
      onOpen={load}
      className={`inline-flex min-w-0 ${className}`}
      trigger={
        <span
          role="link"
          tabIndex={0}
          // Interactive, not noisy: no colour of its own until pointed at, so a
          // row with two of these does not read as a pile of links.
          className="min-w-0 cursor-pointer truncate underline decoration-gray-300 decoration-dotted underline-offset-[3px] hover:text-blue-700 hover:decoration-blue-400 focus:outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-blue-300"
          title={entity.type === 'contact' ? `פתיחת איש הקשר ${entity.name}` : `פתיחת הארגון ${entity.name}`}
          onMouseDown={activate}
          onClick={activate}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') activate(e);
          }}
        >
          {entity.name}
        </span>
      }
    >
      {state === 'loading' || state === 'idle' ? (
        <p dir="rtl" className="text-[12px] text-gray-400">טוען…</p>
      ) : state === 'missing' ? (
        <p dir="rtl" className="text-[12px] text-gray-400">הפרטים לא נטענו.</p>
      ) : data.type === 'contact' ? (
        <ContactCard data={data} />
      ) : (
        <OrganizationCard data={data} context={context} />
      )}
    </HoverCard>
  );
}
