import { DateField, TimeField } from '../admin/common/pickers/DateTimeFields.jsx';
import { TOUR_LANGUAGES } from './strings.js';

// One reservation group as an independent card — validates on its own and
// shows a live complete/incomplete badge (BINDING UX: the agent immediately
// sees which groups are ready). Field-level server problems (422 codes,
// path-mapped by the page) render inline under the exact field.

export const emptyGroup = () => ({
  key: crypto.randomUUID(),
  groupName: '',
  locationId: '',
  productVariantId: '',
  tourDate: '',
  tourTime: '',
  participants: '',
  tourLanguage: '',
  onSiteContactName: '',
  onSiteContactPhone: '',
  notes: '',
});

// Client-side mirror of the server rules — the badge + submit gate. The
// server remains the authority (422 problems re-render inline).
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
  `w-full rounded-lg border px-3 py-2 text-[14px] outline-none focus:border-gray-400 ${
    err ? 'border-red-300 bg-red-50/40' : 'border-gray-200'
  }`;

function Err({ msg }) {
  return msg ? <div className="mt-0.5 text-[11px] text-red-600">{msg}</div> : null;
}

export default function GroupCard({
  index,
  group,
  catalog,
  lang,
  t,
  problems, // { fieldName: localized message } for THIS group
  onChange,
  onDuplicate,
  onRemove,
  canRemove,
}) {
  const g = group;
  const set = (field, v) => onChange({ ...g, [field]: v });
  const label = (item) => (lang === 'en' ? item.nameEn : item.nameHe);

  const tours = catalog.variants.filter((v) => v.locationId === g.locationId);
  const complete = groupComplete(g);
  const p = problems || {};

  function chooseLocation(locationId) {
    // Changing city invalidates the tour choice (dependent select).
    onChange({ ...g, locationId, productVariantId: '' });
  }

  return (
    <section
      className={`rounded-2xl border bg-white p-4 shadow-sm ${
        complete ? 'border-emerald-200' : 'border-gray-200'
      }`}
    >
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-[15px] font-bold text-gray-900">{t.group.title(index + 1)}</h3>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] ${
            complete ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
          }`}
        >
          {complete ? t.group.complete : t.group.incomplete}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onDuplicate}
          className="rounded-md px-2 py-1 text-[12px] text-gray-500 hover:bg-gray-100"
        >
          {t.group.duplicate}
        </button>
        {canRemove && (
          <button
            type="button"
            onClick={() => confirm(t.group.confirmRemove) && onRemove()}
            className="rounded-md px-2 py-1 text-[12px] text-red-600 hover:bg-red-50"
          >
            {t.group.remove}
          </button>
        )}
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-[12px] text-gray-600">{t.group.groupName}</label>
          <input
            value={g.groupName}
            onChange={(e) => set('groupName', e.target.value)}
            placeholder={t.group.groupNamePh}
            className={inputCls(p.groupName)}
          />
          <Err msg={p.groupName} />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="text-[12px] text-gray-600">{t.group.city}</label>
            <select
              value={g.locationId}
              onChange={(e) => chooseLocation(e.target.value)}
              className={inputCls(p.productVariantId) + ' bg-white'}
            >
              <option value="">{t.group.cityPh}</option>
              {catalog.locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {label(loc)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[12px] text-gray-600">{t.group.tour}</label>
            <select
              value={g.productVariantId}
              onChange={(e) => set('productVariantId', e.target.value)}
              disabled={!g.locationId}
              className={inputCls(p.productVariantId) + ' bg-white disabled:bg-gray-50'}
            >
              <option value="">{t.group.tourPh}</option>
              {tours.map((v) => (
                <option key={v.id} value={v.id}>
                  {label(v)}
                </option>
              ))}
            </select>
            <Err msg={p.productVariantId} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <DateField label={t.group.date} value={g.tourDate} onChange={(v) => set('tourDate', v)} clearable={false} />
            <Err msg={p.tourDate} />
          </div>
          <div>
            <TimeField label={t.group.time} value={g.tourTime} onChange={(v) => set('tourTime', v)} clearable={false} />
            <Err msg={p.tourTime} />
          </div>
          <div>
            <label className="text-[12px] text-gray-600">{t.group.participants}</label>
            <input
              type="number"
              min="1"
              max="1000"
              inputMode="numeric"
              value={g.participants}
              onChange={(e) => set('participants', e.target.value)}
              className={inputCls(p.participants)}
            />
            <Err msg={p.participants} />
          </div>
        </div>

        <div>
          <label className="text-[12px] text-gray-600">{t.group.tourLanguage}</label>
          <select
            value={g.tourLanguage}
            onChange={(e) => set('tourLanguage', e.target.value)}
            className={inputCls(false) + ' bg-white'}
          >
            <option value="">{t.group.tourLanguagePh}</option>
            {TOUR_LANGUAGES.map((tl) => (
              <option key={tl.value} value={tl.value}>
                {lang === 'en' ? tl.en : tl.he}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-xl bg-gray-50/70 p-3">
          <div className="text-[12px] font-medium text-gray-700">{t.group.onSiteTitle}</div>
          <div className="mb-2 text-[11px] text-gray-500">{t.group.onSiteHint}</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <input
                value={g.onSiteContactName}
                onChange={(e) => set('onSiteContactName', e.target.value)}
                placeholder={t.group.onSiteName}
                className={inputCls(p.onSiteContactName)}
              />
              <Err msg={p.onSiteContactName} />
            </div>
            <div>
              <input
                value={g.onSiteContactPhone}
                onChange={(e) => set('onSiteContactPhone', e.target.value)}
                placeholder={t.group.onSitePhone}
                dir="ltr"
                className={inputCls(p.onSiteContactPhone)}
              />
              <Err msg={p.onSiteContactPhone} />
            </div>
          </div>
        </div>

        <div>
          <label className="text-[12px] text-gray-600">{t.group.notes}</label>
          <textarea
            value={g.notes}
            onChange={(e) => set('notes', e.target.value)}
            rows={2}
            className={inputCls(false)}
          />
        </div>
      </div>
    </section>
  );
}
