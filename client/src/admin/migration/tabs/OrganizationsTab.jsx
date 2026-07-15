import { useEffect, useState, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { migrationApi } from '../api.js';
import { num, dateTime } from '../components/format.js';
import SourceRecord from '../components/SourceRecord.jsx';

const FILTERS = [
  { key: null, label: 'הכול' },
  { key: 'unresolved', label: 'לא הוכרעו' },
  { key: 'approved', label: 'אושרו' },
  { key: 'rejected', label: 'נדחו' },
  { key: 'deferred', label: 'נדחו למועד אחר' },
  { key: 'safe', label: 'ודאות גבוהה' },
  { key: 'active', label: 'פעילים תפעולית' },
  { key: 'gos', label: 'קיים ב-GOS' },
  { key: 'top25', label: 'טופ 25' },
];
const CONF = {
  safe: { label: 'ודאי', cls: 'bg-green-50 text-green-700' },
  high: { label: 'סביר מאוד', cls: 'bg-blue-50 text-blue-700' },
  review: { label: 'דורש הכרעה', cls: 'bg-amber-50 text-amber-800' },
};
const STATUS = {
  pending: { label: 'ממתין', cls: 'bg-gray-100 text-gray-600' },
  approved: { label: 'אושר', cls: 'bg-green-50 text-green-700' },
  edited: { label: 'אושר בעריכה', cls: 'bg-green-50 text-green-700' },
  rejected: { label: 'נדחה', cls: 'bg-red-50 text-red-700' },
  deferred: { label: 'נדחה למועד אחר', cls: 'bg-amber-50 text-amber-800' },
};
const ROLE = { canonical: 'הארגון הראשי', unit: 'יחידה / סניף', same: 'אותו ארגון', separate: 'ארגון נפרד' };

export default function OrganizationsTab() {
  const { reload } = useOutletContext() || {};
  const [filter, setFilter] = useState('unresolved');
  const [data, setData] = useState(null);
  const [types, setTypes] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [source, setSource] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await migrationApi.queue('organizations', filter));
      setError(null);
    } catch (e) { setError('טעינת התור נכשלה'); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch('/api/organization-types', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((r) => setTypes(Array.isArray(r) ? r : r?.types || []))
      .catch(() => setTypes([]));
  }, []);

  const selected = data?.decisions?.find((d) => d.id === openId) || null;

  // Start editing from the proposal (or the previously recorded decision).
  function beginEdit(d) {
    const base = d.decision?.canonicalName ? d.decision : d.proposal;
    setDraft({
      canonicalName: base.canonicalName ?? d.proposal.proposedCanonical.name,
      organizationTypeId: base.organizationTypeId ?? d.proposal.proposedCanonical.organizationTypeId ?? '',
      roles: Object.fromEntries(d.proposal.members.map((m) => [m.legacyId, (base.roles || {})[m.legacyId] ?? m.role])),
      units: (base.units ?? d.proposal.proposedUnits.map((u) => ({ name: u.name, fromLegacyId: u.fromLegacyId }))).map((u) => ({ ...u })),
      mergeIntoGosId: base.mergeIntoGosId ?? null,
    });
  }

  async function act(action, d, note = null) {
    setBusy(true);
    try {
      const decision =
        action === 'edit'
          ? { ...draft, organizationTypeId: draft.organizationTypeId || null }
          : action === 'approve'
            ? {
                canonicalName: d.proposal.proposedCanonical.name,
                organizationTypeId: d.proposal.proposedCanonical.organizationTypeId ?? null,
                roles: Object.fromEntries(d.proposal.members.map((m) => [m.legacyId, m.role])),
                units: d.proposal.proposedUnits,
                mergeIntoGosId: null,
              }
            : null;
      await migrationApi.decide(d.id, { action, decision, note });
      setDraft(null);
      await load();
      reload?.();
    } catch (e) { setError('שמירת ההחלטה נכשלה'); }
    setBusy(false);
  }

  if (error) return <div className="p-4"><div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div></div>;
  if (!data) return <div className="p-6 text-sm text-gray-500">טוען…</div>;

  if (!data.counts.all) {
    return (
      <div className="p-6">
        <div className="max-w-lg mx-auto bg-white border border-gray-200 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">🏢</div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">אין הצעות עדיין</h2>
          <p className="text-sm text-gray-500">ההצעות נבנות מהצילום בתהליך נפרד. לאחר שירוץ, הן יופיעו כאן.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex flex-wrap gap-1 mb-3">
        {FILTERS.map((f) => (
          <button
            key={String(f.key)}
            type="button"
            onClick={() => { setFilter(f.key); setOpenId(null); setDraft(null); }}
            className={`text-[12px] px-2.5 py-1 rounded-full border transition ${
              filter === f.key ? 'bg-blue-50 border-blue-200 text-blue-700 font-semibold' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >{f.label}</button>
        ))}
        <span className="text-[12px] text-gray-400 self-center px-2">{num(data.counts.shown)} מתוך {num(data.counts.all)}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[22rem_1fr] gap-3">
        {/* Queue list */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <ul className="divide-y divide-gray-100 max-h-[70vh] overflow-y-auto">
            {data.decisions.map((d) => {
              const p = d.proposal;
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => { setOpenId(d.id); setDraft(null); setSource(null); }}
                    className={`w-full text-right px-3 py-2.5 hover:bg-gray-50 ${openId === d.id ? 'bg-blue-50' : ''}`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[11px] text-gray-400 tabular-nums">#{p.rank}</span>
                      <span className="text-[13px] font-medium text-gray-900 truncate">{p.proposedCanonical.name}</span>
                      {p.auditedTop25 && <span className="text-[10px] px-1.5 rounded bg-purple-50 text-purple-700">טופ 25</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${CONF[p.confidence].cls}`}>{CONF[p.confidence].label}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS[d.status]?.cls}`}>{STATUS[d.status]?.label}</span>
                      <span className="text-[10px] text-gray-400">{p.members.length} רשומות · {num(p.totals.deals)} עסקאות{p.totals.activeDeals ? ` · ${num(p.totals.activeDeals)} פעילות` : ''}</span>
                    </div>
                  </button>
                </li>
              );
            })}
            {!data.decisions.length && <li className="px-3 py-8 text-center text-[13px] text-gray-400">אין פריטים בסינון הזה</li>}
          </ul>
        </div>

        {/* Detail */}
        <div className="min-w-0">
          {!selected ? (
            <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-[13px] text-gray-400">בחר קבוצה מהרשימה</div>
          ) : (
            <div className="space-y-3">
              {/* Evidence */}
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <h3 className="text-sm font-semibold text-gray-900">הראיות</h3>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${CONF[selected.proposal.confidence].cls}`}>{CONF[selected.proposal.confidence].label}</span>
                </div>
                <p className="text-[13px] text-gray-600 leading-relaxed mb-3">{selected.proposal.reason}</p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                  <EvidenceList title="ראיה מוכחת" items={selected.proposal.evidence.exact} tone="text-green-700" empty="אין" />
                  <EvidenceList title="ראיה משוערת" items={selected.proposal.evidence.inferred} tone="text-blue-700" empty="אין" />
                  <EvidenceList title="מידע חסר" items={selected.proposal.evidence.missing} tone="text-gray-400" empty="הכול קיים" />
                </div>

                {selected.proposal.gosMatch && (
                  <div className="text-[12px] bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
                    קיים כבר ב-GOS: <b>{selected.proposal.gosMatch.name}</b> (התאמה לפי {selected.proposal.gosMatch.matchedOn === 'taxId' ? 'ח.פ' : 'שם'})
                    {selected.proposal.gosMatch.organizationTypeLabel ? ` · סוג: ${selected.proposal.gosMatch.organizationTypeLabel}` : ''}
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead className="bg-gray-50 text-gray-500">
                      <tr>
                        <th className="text-right font-medium px-2 py-1.5">שם במערכת הקודמת</th>
                        <th className="text-right font-medium px-2 py-1.5">ח.פ</th>
                        <th className="text-right font-medium px-2 py-1.5">טלפון</th>
                        <th className="text-right font-medium px-2 py-1.5">כתובת</th>
                        <th className="text-right font-medium px-2 py-1.5">דומיין</th>
                        <th className="text-right font-medium px-2 py-1.5">אנשי קשר</th>
                        <th className="text-right font-medium px-2 py-1.5">עסקאות</th>
                        <th className="text-right font-medium px-2 py-1.5">מקור</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.proposal.members.map((m) => (
                        <tr key={m.legacyId} className="border-t border-gray-100">
                          <td className="px-2 py-1.5 text-gray-900">{m.name}</td>
                          <td className="px-2 py-1.5 text-gray-600">{m.taxId || '—'}</td>
                          <td className="px-2 py-1.5 text-gray-600">{m.phone || '—'}</td>
                          <td className="px-2 py-1.5 text-gray-600">{m.address || '—'}</td>
                          <td className="px-2 py-1.5 text-gray-600">{m.emailDomains.join(', ') || '—'}</td>
                          <td className="px-2 py-1.5 tabular-nums">{num(m.contactCount)}</td>
                          <td className="px-2 py-1.5 tabular-nums">
                            {num(m.dealCount)}
                            {m.activeDealCount ? <span className="text-green-700"> ({num(m.activeDealCount)} פעילות)</span> : null}
                            {m.futureTourDeals ? <span className="text-blue-700"> · {num(m.futureTourDeals)} סיור עתידי</span> : null}
                          </td>
                          <td className="px-2 py-1.5">
                            <button type="button" className="text-blue-700 hover:underline" onClick={() => setSource({ entity: 'pipedrive/organizations', id: m.legacyId })}>
                              הצג מקור
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {source && (
                <div className="bg-white border border-gray-200 rounded-xl p-3">
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="text-sm font-semibold text-gray-900">רשומת מקור</h3>
                    <button type="button" onClick={() => setSource(null)} className="text-[12px] text-gray-500 hover:underline">סגור</button>
                  </div>
                  <SourceRecord entity={source.entity} id={source.id} onOpenRef={(ref) => setSource(ref)} />
                </div>
              )}

              {/* Proposed structure */}
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <h3 className="text-sm font-semibold text-gray-900">המבנה המוצע</h3>
                  {!draft && !selected.resolved && (
                    <button type="button" onClick={() => beginEdit(selected)} className="text-[12px] px-2 py-1 rounded border border-gray-200 hover:bg-gray-50">עריכה</button>
                  )}
                </div>

                {!draft ? (
                  <ReadOnlyStructure d={selected} types={types} />
                ) : (
                  <EditStructure draft={draft} setDraft={setDraft} members={selected.proposal.members} types={types} gosMatch={selected.proposal.gosMatch} />
                )}

                {selected.resolved || selected.status === 'deferred' ? (
                  <p className="text-[11px] text-gray-400 mt-3 pt-3 border-t border-gray-100">
                    {STATUS[selected.status]?.label} · {selected.decidedByName || '—'} · {dateTime(selected.decidedAt)}
                    {selected.note ? ` · "${selected.note}"` : ''}
                  </p>
                ) : null}

                <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-100">
                  {draft ? (
                    <>
                      <button type="button" disabled={busy} onClick={() => act('edit', selected)} className="text-[13px] px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">שמור אישור בעריכה</button>
                      <button type="button" disabled={busy} onClick={() => setDraft(null)} className="text-[13px] px-3 py-1.5 rounded-md border border-gray-200 hover:bg-gray-50">ביטול</button>
                    </>
                  ) : (
                    <>
                      <button type="button" disabled={busy} onClick={() => act('approve', selected)} className="text-[13px] px-3 py-1.5 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">אישור ההצעה</button>
                      <button type="button" disabled={busy} onClick={() => act('reject', selected)} className="text-[13px] px-3 py-1.5 rounded-md border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50">דחייה</button>
                      <button type="button" disabled={busy} onClick={() => act('defer', selected)} className="text-[13px] px-3 py-1.5 rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50">דחה למועד אחר</button>
                    </>
                  )}
                </div>
                <p className="text-[11px] text-gray-400 mt-2">ההחלטה נשמרת ביומן ההחלטות בלבד. שום ארגון לא נוצר ולא משתנה בשלב הזה.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EvidenceList({ title, items, tone, empty }) {
  return (
    <div>
      <div className="text-[11px] text-gray-500 mb-1">{title}</div>
      {items.length ? (
        <ul className={`text-[12px] ${tone} space-y-0.5`}>{items.map((x) => <li key={x}>• {x}</li>)}</ul>
      ) : (
        <div className="text-[12px] text-gray-300">{empty}</div>
      )}
    </div>
  );
}

function ReadOnlyStructure({ d, types }) {
  const p = d.proposal;
  const decided = d.decision?.canonicalName ? d.decision : null;
  const canonicalName = decided?.canonicalName ?? p.proposedCanonical.name;
  const typeId = decided?.organizationTypeId ?? p.proposedCanonical.organizationTypeId;
  const typeLabel = types.find((t) => t.id === typeId)?.label ?? p.proposedCanonical.organizationTypeLabel;
  const units = decided?.units ?? p.proposedUnits;
  const roles = decided?.roles ?? Object.fromEntries(p.members.map((m) => [m.legacyId, m.role]));
  return (
    <div className="space-y-2 text-[13px]">
      <div><span className="text-gray-500 text-[12px]">ארגון ראשי: </span><b className="text-gray-900">{canonicalName}</b></div>
      <div>
        <span className="text-gray-500 text-[12px]">סוג ארגון: </span>
        {typeLabel ? <span className="text-gray-900">{typeLabel}</span> : <span className="text-gray-400">לא נקבע — {p.proposedCanonical.typeReason}</span>}
      </div>
      <div>
        <span className="text-gray-500 text-[12px]">יחידות / סניפים: </span>
        {units.length ? <span className="text-gray-900">{units.map((u) => u.name).join(' · ')}</span> : <span className="text-gray-400">אין</span>}
      </div>
      <ul className="text-[12px] text-gray-600 space-y-0.5 pt-1">
        {p.members.map((m) => <li key={m.legacyId}>• {m.name} → {ROLE[roles[m.legacyId]] || roles[m.legacyId]}</li>)}
      </ul>
    </div>
  );
}

function EditStructure({ draft, setDraft, members, types, gosMatch }) {
  const set = (patch) => setDraft({ ...draft, ...patch });
  return (
    <div className="space-y-3 text-[13px]">
      <label className="block">
        <span className="text-[12px] text-gray-500">שם הארגון הראשי</span>
        <input value={draft.canonicalName} onChange={(e) => set({ canonicalName: e.target.value })} className="mt-1 w-full border border-gray-200 rounded-md px-2 py-1.5" />
      </label>

      <label className="block">
        <span className="text-[12px] text-gray-500">סוג ארגון (מהרשימה המוגדרת)</span>
        <select value={draft.organizationTypeId || ''} onChange={(e) => set({ organizationTypeId: e.target.value })} className="mt-1 w-full border border-gray-200 rounded-md px-2 py-1.5 bg-white">
          <option value="">— ללא סוג —</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </label>

      {gosMatch && (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.mergeIntoGosId === gosMatch.id}
            onChange={(e) => set({ mergeIntoGosId: e.target.checked ? gosMatch.id : null })}
          />
          <span className="text-[12px] text-gray-700">מזג לארגון הקיים ב-GOS: <b>{gosMatch.name}</b></span>
        </label>
      )}

      <div>
        <div className="text-[12px] text-gray-500 mb-1">תפקיד כל רשומה</div>
        <ul className="space-y-1">
          {members.map((m) => (
            <li key={m.legacyId} className="flex flex-wrap items-center gap-2">
              <span className="text-gray-900 flex-1 min-w-0 truncate">{m.name}</span>
              <select
                value={draft.roles[m.legacyId]}
                onChange={(e) => set({ roles: { ...draft.roles, [m.legacyId]: e.target.value } })}
                className="text-[12px] border border-gray-200 rounded-md px-2 py-1 bg-white"
              >
                <option value="canonical">הארגון הראשי</option>
                <option value="same">אותו ארגון</option>
                <option value="unit">יחידה / סניף</option>
                <option value="separate">ארגון נפרד</option>
              </select>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[12px] text-gray-500">יחידות / סניפים</span>
          <button type="button" onClick={() => set({ units: [...draft.units, { name: '', fromLegacyId: null }] })} className="text-[12px] text-blue-700 hover:underline">+ הוסף יחידה</button>
        </div>
        <ul className="space-y-1">
          {draft.units.map((u, i) => (
            <li key={i} className="flex gap-1">
              <input
                value={u.name}
                onChange={(e) => set({ units: draft.units.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })}
                className="flex-1 border border-gray-200 rounded-md px-2 py-1 text-[12px]"
                placeholder="שם היחידה"
              />
              <button type="button" onClick={() => set({ units: draft.units.filter((_, j) => j !== i) })} className="text-[12px] px-2 text-red-600 hover:underline">הסר</button>
            </li>
          ))}
          {!draft.units.length && <li className="text-[12px] text-gray-400">אין יחידות</li>}
        </ul>
      </div>
    </div>
  );
}
