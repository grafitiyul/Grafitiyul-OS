import { useEffect, useState, useCallback, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { migrationApi } from '../api.js';
import { num, dateTime } from '../components/format.js';
import SourceRecord from '../components/SourceRecord.jsx';
import OrgResultPreview from '../components/OrgResultPreview.jsx';
import OrgDispositionEditor from '../components/OrgDispositionEditor.jsx';
import { draftFromProposal, resolveOrgResult, targetsIndex } from '../components/orgPreview.js';

const FILTERS = [
  { key: 'unresolved', label: 'לא הוכרעו' },
  { key: null, label: 'הכול' },
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

let unitSeq = 0;
const newUnitKey = () => `n${Date.now().toString(36)}${unitSeq++}`;

export default function OrganizationsTab() {
  const { reload } = useOutletContext() || {};
  const [filter, setFilter] = useState('unresolved');
  const [data, setData] = useState(null);
  const [registry, setRegistry] = useState(null);
  const [types, setTypes] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [source, setSource] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try { setData(await migrationApi.queue('organizations', filter)); setError(null); }
    catch { setError('טעינת התור נכשלה'); }
  }, [filter]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { migrationApi.orgTargets().then(setRegistry).catch(() => setRegistry({ proposals: [], gos: [] })); }, []);
  useEffect(() => {
    fetch('/api/organization-types', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((r) => setTypes(Array.isArray(r) ? r : r?.types || []))
      .catch(() => setTypes([]));
  }, []);

  const selected = data?.decisions?.find((d) => d.id === openId) || null;
  const selfKey = selected ? `prop:${selected.subjectKey}` : null;
  const targets = useMemo(() => (registry ? targetsIndex(registry, selfKey) : null), [registry, selfKey]);
  const result = useMemo(
    () => (selected && draft ? resolveOrgResult(selected.proposal, draft, targets) : null),
    [selected, draft, targets],
  );
  const typeLabel = types.find((t) => t.id === draft?.organizationTypeId)?.label || null;
  const set = (patch) => setDraft({ ...draft, ...patch });

  function select(d) { setOpenId(d.id); setSource(null); setDraft(draftFromProposal(d.proposal, d.decision)); }

  async function act(action) {
    setBusy(true);
    try {
      await migrationApi.decide(selected.id, { action, decision: action === 'edit' ? draft : null });
      await load(); reload?.();
      migrationApi.orgTargets().then(setRegistry).catch(() => {});
      setDraft(null); setOpenId(null);
    } catch (e) {
      setError(e?.status === 400 ? 'ההחלטה אינה תקינה — בדוק את התצוגה המקדימה' : 'שמירת ההחלטה נכשלה');
    }
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
          <p className="text-sm text-gray-500">ההצעות נבנות מהצילום בתהליך נפרד.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex flex-wrap gap-1 mb-3">
        {FILTERS.map((f) => (
          <button
            key={String(f.key)} type="button"
            onClick={() => { setFilter(f.key); setOpenId(null); setDraft(null); }}
            className={`text-[12px] px-2.5 py-1 rounded-full border transition ${
              filter === f.key ? 'bg-blue-50 border-blue-200 text-blue-700 font-semibold' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >{f.label}</button>
        ))}
        <span className="text-[12px] text-gray-400 self-center px-2">{num(data.counts.shown)} מתוך {num(data.counts.all)}</span>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[20rem_1fr] gap-3">
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <ul className="divide-y divide-gray-100 max-h-[70vh] overflow-y-auto">
            {data.decisions.map((d) => {
              const p = d.proposal;
              return (
                <li key={d.id}>
                  <button type="button" onClick={() => select(d)} className={`w-full text-right px-3 py-2.5 hover:bg-gray-50 ${openId === d.id ? 'bg-blue-50' : ''}`}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[11px] text-gray-400 tabular-nums">#{p.rank}</span>
                      <span className="text-[13px] font-medium text-gray-900 truncate">{d.decision?.canonicalName || p.proposedCanonical.name}</span>
                      {p.auditedTop25 && <span className="text-[10px] px-1.5 rounded bg-purple-50 text-purple-700">טופ 25</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${CONF[p.confidence].cls}`}>{CONF[p.confidence].label}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS[d.status]?.cls}`}>{STATUS[d.status]?.label}</span>
                      {d.decision?.needsRereview && <span className="text-[10px] px-1.5 rounded bg-orange-100 text-orange-800">לבדיקה מחדש</span>}
                      <span className="text-[10px] text-gray-400">{p.members.length} רשומות · {num(p.totals.deals)} עסקאות</span>
                    </div>
                  </button>
                </li>
              );
            })}
            {!data.decisions.length && <li className="px-3 py-8 text-center text-[13px] text-gray-400">אין פריטים בסינון הזה</li>}
          </ul>
        </div>

        <div className="min-w-0">
          {!selected || !draft ? (
            <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-[13px] text-gray-400">בחר קבוצה מהרשימה</div>
          ) : (
            <div className="space-y-3">
              {(selected.proposal.superseded || selected.decision?.needsRereview) && (
                <div className="bg-orange-50 border border-orange-300 rounded-xl p-3 text-[13px] text-orange-900">
                  <b>הוחזר לבדיקה.</b>{' '}
                  {selected.proposal.supersededReason || selected.decision?.rereviewReason}
                  {' '}ההחלטה הקודמת שלך נשמרה ומוצגת למטה.
                </div>
              )}

              {/* Evidence — every rule, pass AND fail */}
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <h3 className="text-sm font-semibold text-gray-900">למה הרשומות קובצו יחד</h3>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${CONF[selected.proposal.confidence].cls}`}>{CONF[selected.proposal.confidence].label}</span>
                </div>
                <p className="text-[13px] text-gray-600 leading-relaxed mb-3">{selected.proposal.reason}</p>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                  {(selected.proposal.evidence.checks || []).map((c) => (
                    <li key={c.rule} className="text-[12px] flex items-start gap-1.5">
                      <span className={c.passed ? 'text-green-600' : 'text-gray-300'}>{c.passed ? '✓' : '✗'}</span>
                      <span className={c.passed ? 'text-gray-900' : 'text-gray-400'}>
                        {c.rule}
                        {c.detail ? <span className="text-gray-400"> — {c.detail}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Per-source destination */}
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-gray-900 mb-1">יעד לכל רשומת מקור ({selected.proposal.members.length})</h3>
                <p className="text-[11px] text-gray-500 mb-2">לכל רשומה חייב להיות יעד אחד מחייב. אפשר להוציא רשומה מהקבוצה לארגון אחר, או לקבוע שלא ייווצר ממנה ארגון.</p>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                  {selected.proposal.members.map((m) => (
                    <OrgDispositionEditor
                      key={m.legacyId}
                      m={m} draft={draft} setDraft={setDraft}
                      registry={registry} selfKey={selfKey}
                      onShowSource={setSource}
                    />
                  ))}
                </div>
              </div>

              {source && (
                <div className="bg-white border border-gray-200 rounded-xl p-3">
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="text-sm font-semibold text-gray-900">רשומת מקור מלאה</h3>
                    <button type="button" onClick={() => setSource(null)} className="text-[12px] text-gray-500 hover:underline">סגור</button>
                  </div>
                  <SourceRecord entity={source.entity} id={source.id} onOpenRef={setSource} />
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {/* Canonical org + units */}
                <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-gray-900">הארגון הראשי של הקבוצה</h3>
                  <p className="text-[11px] text-gray-500 -mt-2">אפשר להקליד כל שם, גם כזה שלא קיים באף רשומת מקור.</p>

                  <label className="block">
                    <span className="text-[12px] text-gray-500">שם הארגון</span>
                    <input value={draft.canonicalName} onChange={(e) => set({ canonicalName: e.target.value })} className="mt-1 w-full border border-gray-200 rounded-md px-2 py-1.5 text-[13px]" placeholder="לדוגמה: בנק לאומי" />
                  </label>

                  <label className="block">
                    <span className="text-[12px] text-gray-500">סוג ארגון (מהרשימה המוגדרת)</span>
                    <select value={draft.organizationTypeId || ''} onChange={(e) => set({ organizationTypeId: e.target.value || null })} className="mt-1 w-full border border-gray-200 rounded-md px-2 py-1.5 text-[13px] bg-white">
                      <option value="">— ללא סוג —</option>
                      {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                  </label>

                  {selected.proposal.gosMatch && (
                    <label className="flex items-start gap-2">
                      <input type="checkbox" className="mt-0.5" checked={draft.mergeIntoGosId === selected.proposal.gosMatch.id} onChange={(e) => set({ mergeIntoGosId: e.target.checked ? selected.proposal.gosMatch.id : null })} />
                      <span className="text-[12px] text-gray-700">מזג לארגון הקיים ב-GOS: <b>{selected.proposal.gosMatch.name}</b></span>
                    </label>
                  )}

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[12px] text-gray-500">יחידות / סניפים</span>
                      <button type="button" onClick={() => set({ units: [...draft.units, { key: newUnitKey(), name: '' }] })} className="text-[12px] text-blue-700 hover:underline">+ הוסף יחידה</button>
                    </div>
                    <ul className="space-y-1">
                      {draft.units.map((u) => (
                        <li key={u.key} className="flex gap-1">
                          <input
                            value={u.name}
                            onChange={(e) => set({ units: draft.units.map((x) => (x.key === u.key ? { ...x, name: e.target.value } : x)) })}
                            className="flex-1 border border-gray-200 rounded-md px-2 py-1 text-[12px]"
                            placeholder="שם היחידה (חופשי)"
                          />
                          <button
                            type="button"
                            onClick={() => setDraft({
                              ...draft,
                              units: draft.units.filter((x) => x.key !== u.key),
                              dispositions: Object.fromEntries(Object.entries(draft.dispositions).map(([k, v]) => [
                                k, v.disposition === 'unit' && v.targetUnitKey === u.key ? { disposition: 'organization' } : v,
                              ])),
                            })}
                            className="text-[12px] px-2 text-red-600 hover:underline"
                          >הסר</button>
                        </li>
                      ))}
                      {!draft.units.length && <li className="text-[12px] text-gray-400">אין יחידות</li>}
                    </ul>
                  </div>
                </div>

                <div className="space-y-3">
                  {result && <OrgResultPreview result={result} typeLabel={typeLabel} />}
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    {(selected.resolved || selected.status === 'deferred') && (
                      <p className="text-[11px] text-gray-400 mb-2">
                        {STATUS[selected.status]?.label} · {selected.decidedByName || '—'} · {dateTime(selected.decidedAt)}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={busy || !result?.valid} onClick={() => act('edit')} className="text-[13px] px-3 py-1.5 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">אישור התוצאה</button>
                      <button type="button" disabled={busy} onClick={() => act('reject')} className="text-[13px] px-3 py-1.5 rounded-md border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50">לא כפילות — דחה</button>
                      <button type="button" disabled={busy} onClick={() => act('defer')} className="text-[13px] px-3 py-1.5 rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50">דחה למועד אחר</button>
                      <button type="button" disabled={busy} onClick={() => setDraft(draftFromProposal(selected.proposal, null))} className="text-[13px] px-3 py-1.5 text-gray-500 hover:underline">איפוס להצעה</button>
                    </div>
                    <p className="text-[11px] text-gray-400 mt-2">
                      היעד שנקבע לכל רשומה הוא התוצאה הסופית שתשמש בייבוא. ההחלטה נשמרת ביומן ההחלטות בלבד — שום ארגון לא נוצר ולא משתנה עכשיו.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
