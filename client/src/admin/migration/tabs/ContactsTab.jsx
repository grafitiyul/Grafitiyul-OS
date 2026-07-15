import { useEffect, useState, useCallback, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { migrationApi } from '../api.js';
import { num, dateTime } from '../components/format.js';
import SourceRecord from '../components/SourceRecord.jsx';
import { contactDraftFromProposal, resolveContactResult } from '../components/contactPreview.js';

const FILTERS = [
  { key: 'needsReview', label: 'דורש הכרעה' },
  { key: 'probable', label: 'סביר' },
  { key: 'ambiguous', label: 'לא ברור' },
  { key: 'shared', label: 'מספר משותף' },
  { key: 'active', label: 'פעילים תפעולית' },
  { key: 'safe', label: 'בטוחים' },
  { key: 'approved', label: 'אושרו' },
  { key: 'rejected', label: 'נדחו' },
  { key: 'deferred', label: 'נדחו למועד אחר' },
  { key: null, label: 'הכול' },
];
const CONF = {
  safe: { label: 'בטוח', cls: 'bg-green-50 text-green-700' },
  probable: { label: 'סביר', cls: 'bg-blue-50 text-blue-700' },
  ambiguous: { label: 'לא ברור', cls: 'bg-amber-50 text-amber-800' },
  shared: { label: 'מספר משותף', cls: 'bg-red-50 text-red-700' },
};
const STATUS = {
  pending: { label: 'ממתין', cls: 'bg-gray-100 text-gray-600' },
  approved: { label: 'אושר', cls: 'bg-green-50 text-green-700' },
  edited: { label: 'אושר בעריכה', cls: 'bg-green-50 text-green-700' },
  rejected: { label: 'נדחה', cls: 'bg-red-50 text-red-700' },
  deferred: { label: 'נדחה למועד אחר', cls: 'bg-amber-50 text-amber-800' },
};

export default function ContactsTab() {
  const { summary, reload } = useOutletContext() || {};
  const [filter, setFilter] = useState('needsReview');
  const [data, setData] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [source, setSource] = useState(null);
  const [busy, setBusy] = useState(false);
  const [batchMsg, setBatchMsg] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try { setData(await migrationApi.queue('contacts', filter)); setError(null); }
    catch { setError('טעינת התור נכשלה'); }
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  const selected = data?.decisions?.find((d) => d.id === openId) || null;
  const result = useMemo(
    () => (selected && draft ? resolveContactResult(selected.proposal, draft) : null),
    [selected, draft],
  );

  const contactsQueue = summary?.queues?.find((q) => q.key === 'contacts');
  const safeRemaining = data?.decisions?.filter((d) => d.status === 'pending' && d.proposal.batchApprovable).length ?? 0;

  function select(d) { setOpenId(d.id); setSource(null); setDraft(contactDraftFromProposal(d.proposal, d.decision)); }

  async function act(action) {
    setBusy(true);
    try {
      await migrationApi.decide(selected.id, { action, decision: action === 'approve' || action === 'edit' ? draft : null });
      await load(); reload?.();
      setDraft(null); setOpenId(null);
    } catch (e) { setError(e?.status === 400 ? 'ההחלטה אינה תקינה' : 'שמירת ההחלטה נכשלה'); }
    setBusy(false);
  }

  async function batchApprove() {
    setBusy(true);
    try {
      const r = await migrationApi.batchApproveSafe('contacts');
      setBatchMsg(`אושרו ${r.approved.toLocaleString('he-IL')} קבוצות בטוחות. ${r.skipped.toLocaleString('he-IL')} קבוצות ממתינות להכרעה פרטנית.`);
      await load(); reload?.();
    } catch { setError('האישור הקבוצתי נכשל'); }
    setBusy(false);
  }

  if (error) return <div className="p-4"><div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div></div>;
  if (!data) return <div className="p-6 text-sm text-gray-500">טוען…</div>;
  if (!data.counts.all) {
    return (
      <div className="p-6">
        <div className="max-w-lg mx-auto bg-white border border-gray-200 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">👤</div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">אין הצעות עדיין</h2>
          <p className="text-sm text-gray-500">ההצעות נבנות מהצילום בתהליך נפרד.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      {/* Batch bar — the workload shortcut */}
      <div className="bg-white border border-gray-200 rounded-xl p-3 mb-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-[13px] text-gray-700">
            <b>{num(contactsQueue?.counts.total)}</b> קבוצות כפילות בלבד — לא כל אנשי הקשר.
            {' '}נותרו <b>{num(contactsQueue?.counts.unresolved)}</b> להכרעה.
          </div>
          {safeRemaining > 0 && (
            <button
              type="button" disabled={busy} onClick={batchApprove}
              className="text-[13px] px-3 py-1.5 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 mr-auto"
            >
              אשר את כל {num(safeRemaining)} הקבוצות הבטוחות
            </button>
          )}
        </div>
        {batchMsg && <div className="mt-2 text-[12px] text-green-800 bg-green-50 border border-green-200 rounded px-2 py-1">{batchMsg}</div>}
        <p className="text-[11px] text-gray-400 mt-1.5">
          קבוצה "בטוחה" = אותו טלפון וגם אותו שם (או אימייל משותף). רק מקרים סבירים, לא ברורים או מספר משותף דורשים הכרעה פרטנית.
        </p>
      </div>

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

      <div className="grid grid-cols-1 xl:grid-cols-[22rem_1fr] gap-3">
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <ul className="divide-y divide-gray-100 max-h-[70vh] overflow-y-auto">
            {data.decisions.map((d) => {
              const p = d.proposal;
              return (
                <li key={d.id}>
                  <button type="button" onClick={() => select(d)} className={`w-full text-right px-3 py-2.5 hover:bg-gray-50 ${openId === d.id ? 'bg-blue-50' : ''}`}>
                    <div className="text-[13px] font-medium text-gray-900 truncate mb-1">
                      {p.members.map((m) => m.name).join(' · ')}
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${CONF[p.confidence].cls}`}>{CONF[p.confidence].label}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS[d.status]?.cls}`}>{STATUS[d.status]?.label}</span>
                      <span className="text-[10px] text-gray-400">
                        {p.clusterKind === 'phone' ? 'טלפון' : 'אימייל'} · {num(p.totals.deals)} עסקאות{p.totals.activeDeals ? ` · ${num(p.totals.activeDeals)} פעילות` : ''}
                      </span>
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
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <h3 className="text-sm font-semibold text-gray-900">למה הרשומות קובצו יחד</h3>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${CONF[selected.proposal.confidence].cls}`}>{CONF[selected.proposal.confidence].label}</span>
                </div>
                <p className="text-[13px] text-gray-600 leading-relaxed mb-3">{selected.proposal.reason}</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <List title="ראיה מוכחת" items={selected.proposal.evidence.exact} tone="text-green-700" />
                  <List title="ראיה משוערת" items={selected.proposal.evidence.inferred} tone="text-blue-700" />
                  <List title="סתירות" items={selected.proposal.evidence.conflicts} tone="text-red-700" />
                </div>
              </div>

              {/* Records + assignment */}
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-gray-900 mb-2">רשומות המקור ({selected.proposal.members.length})</h3>
                <div className="space-y-2">
                  {selected.proposal.members.map((m) => {
                    const a = draft.assignments[m.legacyId];
                    return (
                      <div key={m.legacyId} className={`border rounded-lg p-3 ${a === 'primary' ? 'border-green-300 bg-green-50/40' : 'border-gray-200'}`}>
                        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
                          <div className="text-[13px] font-semibold text-gray-900">{m.name}</div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] text-gray-400">מזהה מקור: {m.legacyId}</span>
                            <button type="button" onClick={() => setSource(m.source)} className="text-[11px] text-blue-700 hover:underline">מקור →</button>
                          </div>
                        </div>
                        <div className="text-[12px] text-gray-600 space-y-0.5">
                          {m.phones.length > 0 && <div>טלפון: {m.phones.join(' · ')}</div>}
                          {m.emails.length > 0 && <div>אימייל: {m.emails.join(' · ')}</div>}
                          {m.orgName && <div>ארגון: {m.orgName}</div>}
                          <div className="text-gray-500">
                            {num(m.dealCount)} עסקאות
                            {m.activeDealCount ? <span className="text-green-700"> · {num(m.activeDealCount)} פעילות</span> : null}
                            {m.futureTourDeals ? <span className="text-blue-700"> · {num(m.futureTourDeals)} סיור עתידי</span> : null}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-gray-100">
                          <label className="flex items-center gap-1.5 text-[12px]">
                            <input
                              type="radio" name={`primary-${selected.id}`}
                              checked={a === 'primary'}
                              onChange={() => setDraft({
                                primaryLegacyId: m.legacyId,
                                assignments: Object.fromEntries(selected.proposal.members.map((x) => [
                                  x.legacyId,
                                  x.legacyId === m.legacyId ? 'primary' : (draft.assignments[x.legacyId] === 'primary' ? 'merge' : draft.assignments[x.legacyId]),
                                ])),
                              })}
                            />
                            איש הקשר שנשמר
                          </label>
                          {a !== 'primary' && (
                            <select
                              value={a}
                              onChange={(e) => setDraft({ ...draft, assignments: { ...draft.assignments, [m.legacyId]: e.target.value } })}
                              className="text-[12px] border border-gray-200 rounded-md px-2 py-1 bg-white"
                            >
                              <option value="merge">מאוחד לאיש הקשר שנשמר</option>
                              <option value="separate">נשאר איש קשר נפרד</option>
                            </select>
                          )}
                        </div>
                      </div>
                    );
                  })}
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

              {/* Preview + actions */}
              {result && (
                <div className="bg-blue-50/50 border border-blue-200 rounded-xl p-4">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <h3 className="text-sm font-semibold text-gray-900">התוצאה לאחר ההעברה</h3>
                    <span className="text-[11px] text-gray-500">{num(result.totals.contactsBefore)} רשומות → {num(result.totals.contactsAfter)} אנשי קשר</span>
                  </div>
                  {result.primary && (
                    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 mb-2">
                      <div className="text-[14px] font-semibold text-gray-900">{result.primary.name}</div>
                      <div className="text-[11px] text-gray-500 mt-0.5">
                        {num(result.primary.deals)} עסקאות{result.primary.activeDeals ? ` · ${num(result.primary.activeDeals)} פעילות` : ''}
                      </div>
                      {result.primary.phones.length > 0 && <div className="text-[11px] text-gray-500">טלפונים שיישמרו: {result.primary.phones.join(' · ')}</div>}
                      {result.primary.emails.length > 0 && <div className="text-[11px] text-gray-500">אימיילים: {result.primary.emails.join(' · ')}</div>}
                      {result.primary.absorbs.length > 0 && (
                        <div className="text-[11px] text-gray-400 mt-1">מאחד לתוכו: {result.primary.absorbs.map((a) => a.name).join(' · ')}</div>
                      )}
                    </div>
                  )}
                  {result.separate.length > 0 && (
                    <>
                      <div className="text-[11px] text-gray-500 mb-1">נשארים נפרדים</div>
                      <ul className="space-y-1">
                        {result.separate.map((s) => (
                          <li key={s.legacyId} className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-[13px] text-gray-900">
                            {s.name} <span className="text-[11px] text-gray-400">· {num(s.deals)} עסקאות</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {result.warnings.map((w) => (
                    <p key={w} className="mt-2 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">{w}</p>
                  ))}
                </div>
              )}

              <div className="bg-white border border-gray-200 rounded-xl p-4">
                {(selected.resolved || selected.status === 'deferred') && (
                  <p className="text-[11px] text-gray-400 mb-2">
                    {STATUS[selected.status]?.label} · {selected.decidedByName || '—'} · {dateTime(selected.decidedAt)}
                    {selected.note ? ` · ${selected.note}` : ''}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy || !result?.valid} onClick={() => act('edit')} className="text-[13px] px-3 py-1.5 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">אישור התוצאה</button>
                  <button type="button" disabled={busy} onClick={() => act('reject')} className="text-[13px] px-3 py-1.5 rounded-md border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50">לא כפילות — השאר בנפרד</button>
                  <button type="button" disabled={busy} onClick={() => act('defer')} className="text-[13px] px-3 py-1.5 rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50">דחה למועד אחר</button>
                </div>
                <p className="text-[11px] text-gray-400 mt-2">ההחלטה נשמרת ביומן ההחלטות בלבד. שום איש קשר לא מאוחד ולא משתנה עכשיו.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function List({ title, items, tone }) {
  return (
    <div>
      <div className="text-[11px] text-gray-500 mb-1">{title}</div>
      {items?.length ? (
        <ul className={`text-[12px] ${tone} space-y-0.5`}>{items.map((x) => <li key={x}>• {x}</li>)}</ul>
      ) : (
        <div className="text-[12px] text-gray-300">אין</div>
      )}
    </div>
  );
}
