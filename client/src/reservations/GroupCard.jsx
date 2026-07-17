import { DateField, TimeField } from '../admin/common/pickers/DateTimeFields.jsx';

// One reservation group — an elegant collapsible card (approved mockup).
// City-first flow: the agent picks a COMMERCIAL city, then only the
// activities listed for that city (owner-configured channel catalogue —
// commercial names only, never internal product/variant names). Visual
// hierarchy: city/activity → date/time → participants → on-site contact →
// notes. Collapsed cards summarize activity · date · participants.

const NOTES_MAX = 500;

export const emptyGroup = () => ({
  key: crypto.randomUUID(),
  groupName: '',
  cityKey: '',
  productVariantId: '',
  tourDate: '',
  tourTime: '',
  participants: '',
  onSiteContactName: '',
  onSiteContactPhone: '',
  notes: '',
});

// Client-side mirror of the server rules — the collapse summary + submit gate.
// The server remains the authority (422 problems re-render inline).
export function groupComplete(g) {
  const participants = Number(g.participants);
  const pairOk = !!g.onSiteContactName.trim() === !!g.onSiteContactPhone.trim();
  return !!(
    g.groupName.trim() &&
    g.productVariantId &&
    g.tourDate &&
    g.tourTime &&
    Number.isInteger(participants) &&
    participants >= 1 &&
    pairOk
  );
}

const inputCls = (err) =>
  `h-10 w-full rounded-lg border bg-white px-3 text-[14px] outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100 ${
    err ? 'border-red-300 bg-red-50/40' : 'border-gray-200'
  }`;

function Label({ children, required }) {
  return (
    <span className="mb-1 block text-[12px] font-medium text-gray-600">
      {required && <span className="text-red-500">* </span>}
      {children}
    </span>
  );
}

function Err({ msg }) {
  return msg ? <div className="mt-0.5 text-[11px] text-red-600">{msg}</div> : null;
}

const fmtDate = (ymd) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};

export default function GroupCard({
  index,
  group,
  catalog,
  lang,
  t,
  problems,
  collapsed,
  onToggleCollapse,
  onChange,
  onRemove,
  canRemove,
}) {
  const g = group;
  const set = (field, v) => onChange({ ...g, [field]: v });
  const label = (item) => (lang === 'en' ? item.nameEn : item.nameHe);
  const p = problems || {};

  const activities = catalog.variants.filter((v) => v.cityKey === g.cityKey);
  const chosen = catalog.variants.find((v) => v.id === g.productVariantId) || null;
  const complete = groupComplete(g);

  function chooseCity(cityKey) {
    // Changing city invalidates the activity choice (dependent select).
    onChange({ ...g, cityKey, productVariantId: '' });
  }

  const collapsedSummary = chosen
    ? t.group.collapsedLine(
        [
          label(chosen),
          fmtDate(g.tourDate),
          g.participants ? `${g.participants} ${lang === 'en' ? 'participants' : 'משתתפים'}` : null,
        ].filter(Boolean),
      )
    : t.group.collapsedNoActivity;

  return (
    <section className="rounded-2xl border border-gray-200/80 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      {/* Header — group number leading; activity badge; collapse + delete. */}
      <div className="flex items-center gap-2.5 px-5 pt-4 pb-1">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600/10 text-blue-700">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M16 11a3 3 0 100-6 3 3 0 000 6zM8 11a3 3 0 100-6 3 3 0 000 6zM2 19a6 6 0 0112 0M14 19a6 6 0 018-5.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </span>
        <h3 className="text-[16px] font-bold text-gray-900">{t.group.title(index + 1)}</h3>
        {!collapsed && chosen && (
          <span className="hidden sm:inline rounded-full bg-blue-50 px-2.5 py-0.5 text-[12px] font-medium text-blue-700">
            {t.group.activityBadge}
          </span>
        )}
        {collapsed && (
          <span className="min-w-0 flex-1 truncate text-[13px] text-gray-500">{collapsedSummary}</span>
        )}
        {!collapsed && <div className="flex-1" />}
        {!complete && collapsed && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
            {t.group.incomplete}
          </span>
        )}
        <button
          type="button"
          onClick={onToggleCollapse}
          title={collapsed ? t.group.expand : t.group.collapse}
          className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className={collapsed ? '' : 'rotate-180'} aria-hidden>
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {canRemove && (
          <button
            type="button"
            onClick={() => confirm(t.group.confirmRemove) && onRemove()}
            title={t.group.remove}
            className="rounded-md p-1.5 text-red-400 transition hover:bg-red-50 hover:text-red-600"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m2 0l-.8 12.1A2 2 0 0114.2 21H9.8a2 2 0 01-2-1.9L7 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="space-y-4 px-5 pb-5 pt-3">
          {/* City → Activity (the flow's spine — city first). */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label required>{t.group.city}</Label>
              <select
                value={g.cityKey}
                onChange={(e) => chooseCity(e.target.value)}
                className={inputCls(p.productVariantId && !g.cityKey)}
              >
                <option value="">{t.group.cityPh}</option>
                {catalog.cities.map((c) => (
                  <option key={c.key} value={c.key}>
                    {label(c)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label required>{t.group.activity}</Label>
              <select
                value={g.productVariantId}
                onChange={(e) => set('productVariantId', e.target.value)}
                disabled={!g.cityKey}
                className={inputCls(p.productVariantId) + ' disabled:bg-gray-50 disabled:text-gray-400'}
              >
                <option value="">{t.group.activityPh}</option>
                {activities.map((v) => (
                  <option key={v.id} value={v.id}>
                    {label(v)}
                  </option>
                ))}
              </select>
              <Err msg={p.productVariantId} />
            </div>
          </div>

          {/* Date · Time. */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label required>{t.group.date}</Label>
              <DateField value={g.tourDate} onChange={(v) => set('tourDate', v)} clearable={false} lang={lang} />
              <Err msg={p.tourDate} />
            </div>
            <div>
              <Label required>{t.group.time}</Label>
              <TimeField value={g.tourTime} onChange={(v) => set('tourTime', v)} clearable={false} lang={lang} />
              <Err msg={p.tourTime} />
            </div>
          </div>

          {/* Participants + group name. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label required>{t.group.participants}</Label>
              <input
                type="number"
                min="1"
                max="1000"
                inputMode="numeric"
                value={g.participants}
                onChange={(e) => set('participants', e.target.value)}
                className={inputCls(p.participants)}
              />
              {chosen?.description && (
                <div className="mt-1 text-[11px] text-gray-400">{chosen.description}</div>
              )}
              <Err msg={p.participants} />
            </div>
            <div>
              <Label required>{lang === 'en' ? 'Group name' : 'שם הקבוצה'}</Label>
              <input
                value={g.groupName}
                onChange={(e) => set('groupName', e.target.value)}
                className={inputCls(p.groupName)}
              />
              <Err msg={p.groupName} />
            </div>
          </div>

          {/* On-site contact — quiet sub-box. */}
          <div className="rounded-xl bg-blue-50/50 p-3.5">
            <div className="mb-2 text-[13px] font-semibold text-blue-900">{t.group.onSiteTitle}</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label>{t.group.onSiteName}</Label>
                <input
                  value={g.onSiteContactName}
                  onChange={(e) => set('onSiteContactName', e.target.value)}
                  className={inputCls(p.onSiteContactName)}
                />
                <Err msg={p.onSiteContactName} />
              </div>
              <div>
                <Label>{t.group.onSitePhone}</Label>
                <input
                  value={g.onSiteContactPhone}
                  onChange={(e) => set('onSiteContactPhone', e.target.value)}
                  dir="ltr"
                  className={inputCls(p.onSiteContactPhone)}
                />
                <Err msg={p.onSiteContactPhone} />
              </div>
            </div>
          </div>

          {/* Notes. */}
          <div>
            <Label>{t.group.notes}</Label>
            <textarea
              value={g.notes}
              onChange={(e) => set('notes', e.target.value.slice(0, NOTES_MAX))}
              rows={2}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-[14px] outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
            <div className="mt-0.5 text-[11px] text-gray-300" dir="ltr">
              {g.notes.length}/{NOTES_MAX}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
