import { useState, useMemo } from 'react';
import { num } from './format.js';
import { orgKeyForStandalone } from './orgPreview.js';

const ACTIONS = [
  { key: 'organization', label: 'הארגון הראשי' },
  { key: 'unit', label: 'יחידה / סניף' },
  { key: 'other_organization', label: 'ארגון אחר' },
  { key: 'standalone', label: 'ארגון עצמאי' },
  { key: 'excluded', label: 'לא ליצור ארגון' },
];

// One source record: its context, its binding destination, and (when excluded or
// re-targeted) the extra answers the destination requires.
export default function OrgDispositionEditor({ m, draft, setDraft, registry, selfKey, onShowSource }) {
  const d = draft.dispositions[m.legacyId] || {};
  const isStandalone = d.disposition === 'other_organization' && String(d.targetOrganizationKey || '').startsWith('new:');
  const active = d.disposition === 'other_organization' && !isStandalone ? 'other_organization' : isStandalone ? 'standalone' : d.disposition;

  const set = (patch) => setDraft({ ...draft, dispositions: { ...draft.dispositions, [m.legacyId]: { ...d, ...patch } } });
  const choose = (key) => {
    if (key === 'organization') return set({ disposition: 'organization', targetOrganizationKey: undefined, targetUnitKey: undefined, linkedEntityTreatment: undefined });
    if (key === 'unit') return set({ disposition: 'unit', targetUnitKey: draft.units[0]?.key, targetOrganizationKey: undefined, linkedEntityTreatment: undefined });
    if (key === 'standalone') return set({ disposition: 'other_organization', targetOrganizationKey: orgKeyForStandalone(m.legacyId), targetUnitKey: null, linkedEntityTreatment: undefined });
    if (key === 'other_organization') return set({ disposition: 'other_organization', targetOrganizationKey: null, targetUnitKey: null, linkedEntityTreatment: undefined });
    return set({ disposition: 'excluded', targetOrganizationKey: undefined, targetUnitKey: undefined, linkedEntityTreatment: d.linkedEntityTreatment || {} });
  };

  const hasLinked = (m.dealCount || 0) > 0 || (m.contactCount || 0) > 0;

  return (
    <div className={`border rounded-lg p-3 ${active === 'excluded' ? 'border-red-200 bg-red-50/30' : active === 'organization' ? 'border-green-200 bg-green-50/30' : 'border-gray-200'}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-gray-900 break-words">{m.name}</div>
          <div className="text-[11px] text-gray-400">
            מזהה מקור: {m.legacyId}
            {m.taxId ? ` · ח.פ ${m.taxId}` : ''}
            {m.city ? ` · ${m.city}` : ''}
          </div>
        </div>
        <button type="button" onClick={() => onShowSource(m.source)} className="text-[11px] text-blue-700 hover:underline">מקור →</button>
      </div>

      <div className="text-[11px] text-gray-500 mb-2">
        {num(m.dealCount)} עסקאות
        {m.activeDealCount ? <b className="text-green-700"> · {num(m.activeDealCount)} פעילות</b> : null}
        {m.futureTourDeals ? <b className="text-blue-700"> · {num(m.futureTourDeals)} סיור עתידי</b> : null}
        {' · '}{num(m.contactCount)} אנשי קשר
        {m.primaryContact ? ` · ${m.primaryContact.name}` : ''}
        {m.gosMatch ? <span className="text-amber-700"> · קיים ב-GOS: {m.gosMatch.name}</span> : null}
      </div>

      <div className="flex flex-wrap gap-1 mb-2">
        {ACTIONS.map((a) => (
          <button
            key={a.key} type="button" onClick={() => choose(a.key)}
            className={`text-[11px] px-2 py-1 rounded-md border transition ${
              active === a.key ? 'bg-blue-600 border-blue-600 text-white font-semibold' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >{a.label}</button>
        ))}
      </div>

      {active === 'unit' && (
        <select
          value={d.targetUnitKey || ''}
          onChange={(e) => set({ targetUnitKey: e.target.value })}
          className="w-full text-[12px] border border-gray-200 rounded-md px-2 py-1 bg-white"
        >
          <option value="">— בחר יחידה —</option>
          {draft.units.map((u) => <option key={u.key} value={u.key}>{u.name || '(ללא שם)'}</option>)}
        </select>
      )}

      {active === 'other_organization' && (
        <TargetPicker
          registry={registry} selfKey={selfKey}
          orgKey={d.targetOrganizationKey} unitKey={d.targetUnitKey}
          onPick={(orgKey, unitKey) => set({ targetOrganizationKey: orgKey, targetUnitKey: unitKey ?? null })}
        />
      )}

      {active === 'standalone' && (
        <p className="text-[11px] text-gray-500 bg-white border border-gray-200 rounded px-2 py-1">
          ייווצר ארגון עצמאי חדש בשם <b>{m.name}</b>.
        </p>
      )}

      {active === 'excluded' && (
        <div className="space-y-2">
          <p className="text-[11px] text-gray-600 bg-white border border-gray-200 rounded px-2 py-1">
            לא ייווצר ארגון מהרשומה הזו. רשומת המקור נשמרת במלואה בארכיון ואינה נמחקת.
          </p>
          {m.operationallyActive && (
            <p className="text-[11px] text-red-800 bg-red-50 border border-red-300 rounded px-2 py-1 font-medium">
              ⚠ שים לב: לרשומה הזו יש {num(m.activeDealCount)} עסקאות פעילות ו-{num(m.futureTourDeals)} סיורים עתידיים.
            </p>
          )}
          {hasLinked ? (
            <div className="bg-white border border-gray-200 rounded p-2 space-y-2">
              <div className="text-[11px] font-medium text-gray-700">חובה לקבוע יעד לרשומות המקושרות:</div>
              {(m.dealCount || 0) > 0 && (
                <LinkedTreatment
                  label={`${num(m.dealCount)} עסקאות`}
                  value={d.linkedEntityTreatment?.deals}
                  targetKey={d.linkedEntityTreatment?.dealsTargetOrganizationKey}
                  options={[['reassign', 'העבר לארגון אחר'], ['exceptional', 'העבר לרשומות חריגות']]}
                  registry={registry} selfKey={selfKey}
                  onChange={(v, t) => set({ linkedEntityTreatment: { ...d.linkedEntityTreatment, deals: v, dealsTargetOrganizationKey: t } })}
                />
              )}
              {(m.contactCount || 0) > 0 && (
                <LinkedTreatment
                  label={`${num(m.contactCount)} אנשי קשר`}
                  value={d.linkedEntityTreatment?.contacts}
                  targetKey={d.linkedEntityTreatment?.contactsTargetOrganizationKey}
                  options={[['reassign', 'העבר לארגון אחר'], ['no_organization', 'השאר ללא ארגון'], ['exceptional', 'העבר לרשומות חריגות']]}
                  registry={registry} selfKey={selfKey}
                  onChange={(v, t) => set({ linkedEntityTreatment: { ...d.linkedEntityTreatment, contacts: v, contactsTargetOrganizationKey: t } })}
                />
              )}
            </div>
          ) : (
            <p className="text-[11px] text-gray-400">אין עסקאות או אנשי קשר מקושרים.</p>
          )}
        </div>
      )}
    </div>
  );
}

function LinkedTreatment({ label, value, targetKey, options, registry, selfKey, onChange }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-gray-600 min-w-[5.5rem]">{label}</span>
        <select
          value={value || ''}
          onChange={(e) => onChange(e.target.value || undefined, e.target.value === 'reassign' ? targetKey : undefined)}
          className="text-[11px] border border-gray-200 rounded px-2 py-1 bg-white"
        >
          <option value="">— בחר יעד —</option>
          {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      {value === 'reassign' && (
        <div className="mt-1">
          <TargetPicker registry={registry} selfKey={selfKey} orgKey={targetKey} unitKey={null} onPick={(k) => onChange('reassign', k)} compact />
        </div>
      )}
    </div>
  );
}

// Searchable picker over migration proposals + live GOS organizations.
function TargetPicker({ registry, selfKey, orgKey, unitKey, onPick, compact = false }) {
  const [q, setQ] = useState('');
  const all = useMemo(() => [
    ...(registry?.proposals || []).filter((p) => p.key !== selfKey).map((p) => ({ ...p, group: 'ארגוני המיגרציה' })),
    ...(registry?.gos || []).map((g) => ({ ...g, group: 'ארגונים קיימים ב-GOS' })),
  ], [registry, selfKey]);
  const picked = all.find((t) => t.key === orgKey) || null;
  const matches = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return all.slice(0, 12);
    return all.filter((t) => t.name.toLowerCase().includes(n)).slice(0, 12);
  }, [q, all]);

  if (picked) {
    return (
      <div className="bg-white border border-blue-200 rounded px-2 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] text-gray-900">
            <span className="text-[10px] text-gray-400">{picked.group}: </span><b>{picked.name}</b>
          </span>
          <button type="button" onClick={() => onPick(null, null)} className="text-[11px] text-gray-500 hover:underline">שנה</button>
        </div>
        {!compact && picked.units.length > 0 && (
          <select
            value={unitKey || ''}
            onChange={(e) => onPick(picked.key, e.target.value || null)}
            className="mt-1 w-full text-[11px] border border-gray-200 rounded px-2 py-1 bg-white"
          >
            <option value="">— ללא יחידה (הארגון עצמו) —</option>
            {picked.units.map((u) => <option key={u.key} value={u.key}>{u.name}</option>)}
          </select>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded p-1.5">
      <input
        value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="חפש ארגון יעד…"
        className="w-full text-[12px] border border-gray-200 rounded px-2 py-1 mb-1"
      />
      <ul className="max-h-40 overflow-y-auto">
        {matches.map((t) => (
          <li key={t.key}>
            <button type="button" onClick={() => onPick(t.key, null)} className="w-full text-right px-2 py-1 text-[12px] hover:bg-gray-50 rounded">
              {t.name}
              <span className="text-[10px] text-gray-400"> · {t.group}{t.units.length ? ` · ${t.units.length} יחידות` : ''}</span>
            </button>
          </li>
        ))}
        {!matches.length && <li className="px-2 py-2 text-[11px] text-gray-400">לא נמצאו ארגונים</li>}
      </ul>
    </div>
  );
}
