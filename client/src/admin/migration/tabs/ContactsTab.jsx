import { useEffect, useState, useCallback, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { migrationApi } from '../api.js';
import { num, dateTime } from '../components/format.js';
import SourceRecord from '../components/SourceRecord.jsx';
import IdentityEditor from '../components/IdentityEditor.jsx';
import { contactDraftFromProposal, resolveContactResult } from '../components/contactPreview.js';
import { toggleRemove, setMoveTarget, clusterKeySurvives, anyEdits } from '../components/identityPreview.js';

// Business impact drives the queue. The owner lands on `critical` and, when it is
// empty, is told plainly that Identity Import can begin.
const SECTIONS = [
  { key: 'critical', emoji: '🔥', label: 'דורש הכרעה לפני ייבוא הזהויות', cls: 'bg-red-50 border-red-200 text-red-800' },
  { key: 'recent', emoji: '🟠', label: 'עסקים אחרונים', cls: 'bg-orange-50 border-orange-200 text-orange-800' },
  { key: 'historical', emoji: '🟡', label: 'היסטוריה עסקית', cls: 'bg-amber-50 border-amber-200 text-amber-800' },
  { key: 'low', emoji: '⚪', label: 'עדיפות נמוכה', cls: 'bg-gray-50 border-gray-200 text-gray-700' },
  { key: 'none', emoji: '⚫', label: 'לא נדרשת הכרעה', cls: 'bg-gray-100 border-gray-300 text-gray-500' },
];
const CONF = {
  safe: { label: 'בטוח', cls: 'bg-green-50 text-green-700' },
  probable: { label: 'סביר', cls: 'bg-blue-50 text-blue-700' },
  ambiguous: { label: 'לא ברור', cls: 'bg-amber-50 text-amber-800' },
  shared: { label: 'מפתח משותף', cls: 'bg-red-50 text-red-700' },
};
const STATUS = {
  pending: { label: 'ממתין', cls: 'bg-gray-100 text-gray-600' },
  approved: { label: 'אושר', cls: 'bg-green-50 text-green-700' },
  edited: { label: 'אושר בעריכה', cls: 'bg-green-50 text-green-700' },
  rejected: { label: 'נדחה', cls: 'bg-red-50 text-red-700' },
  deferred: { label: 'נדחה למועד אחר', cls: 'bg-amber-50 text-amber-800' },
};

export default function ContactsTab() {
  const { reload } = useOutletContext() || {};
  const [section, setSection] = useState('critical');
  const [showResolved, setShowResolved] = useState(false);
  const [data, setData] = useState(null);
  const [work, setWork] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [source, setSource] = useState(null);
  const [busy, setBusy] = useState(false);
  const [batchMsg, setBatchMsg] = useState(null);
  const [error, setError] = useState(null);
  // Source-data corrections, edited per cluster but stored per source contact.
  const [edits, setEdits] = useState({});
  const [idNote, setIdNote] = useState('');
  const [idProblems, setIdProblems] = useState([]);

  const load = useCallback(async () => {
    try {
      const [q, w] = await Promise.all([
        migrationApi.queue('contacts', showResolved ? null : 'unresolved', section),
        migrationApi.contactWorkload(),
      ]);
      setData(q); setWork(w); setError(null);
    } catch { setError('טעינת התור נכשלה'); }
  }, [section, showResolved]);
  useEffect(() => { load(); }, [load]);

  const selected = data?.decisions?.find((d) => d.id === openId) || null;
  // The merge preview reads the CORRECTED identity: an identifier the owner removed
  // must not reappear on the survivor just because its record was merged in.
  const result = useMemo(
    () => (selected && draft ? resolveContactResult(selected.proposal, draft, edits) : null),
    [selected, draft, edits],
  );
  const keySurvives = useMemo(
    () => (selected ? clusterKeySurvives({ ...selected.proposal, edits }) : null),
    [selected, edits],
  );

  const head = work?.headline;
  const counts = (k) => work?.sections?.find((s) => s.key === k)?.counts || { total: 0, unresolved: 0 };
  const safeRemaining = work?.safe?.unresolved ?? 0;

  function select(d) {
    setOpenId(d.id);
    setSource(null);
    setDraft(contactDraftFromProposal(d.proposal, d.decision));
    setEdits(d.identityEdits || {});
    setIdNote(Object.values(d.identityEdits || {})[0]?.note || '');
    setIdProblems([]);
  }

  async function act(action) {
    setBusy(true);
    try {
      await migrationApi.decide(selected.id, { action, decision: action === 'approve' || action === 'edit' ? draft : null });
      await load(); reload?.();
      setDraft(null); setOpenId(null); setEdits({});
    } catch (e) { setError(e?.status === 400 ? 'ההחלטה אינה תקינה' : 'שמירת ההחלטה נכשלה'); }
    setBusy(false);
  }

  async function saveIdentity() {
    setBusy(true);
    setIdProblems([]);
    try {
      await migrationApi.saveIdentityEdits(selected.id, { edits, note: idNote });
      await load(); reload?.();
    } catch (e) {
      // The server re-validates against the snapshot and is the authority.
      setIdProblems(e?.body?.problems || ['שמירת התיקון נכשלה']);
    }
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
      {/* Owner dashboard — the four numbers that decide what to do today. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
        <Stat label="בטוחים — מאוחדים אוטומטית" value={head?.safe} tone="text-green-700" note={safeRemaining > 0 ? `${num(safeRemaining)} ממתינים לאישור קבוצתי` : 'כולם אושרו'} />
        <Stat label="דורש הכרעה לפני ייבוא" value={head?.beforeImport} tone={head?.beforeImport ? 'text-red-700' : 'text-green-700'} note="עסקה פתוחה או סיור עתידי" emphasise />
        <Stat label="הכרעה היסטורית" value={head?.historicalReview} tone="text-amber-700" note="לא חוסם ייבוא" />
        <Stat label="לא נדרשת הכרעה" value={head?.noDecisionRequired} tone="text-gray-400" note="פחות משני אנשי קשר ייובאו" />
      </div>

      {/* The gate: when the critical section is empty, say so plainly. */}
      {work?.criticalCleared ? (
        <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2 mb-3 text-[13px] text-green-900">
          <b>אין יותר כפילויות שנוגעות לתפעול חי.</b> כל קבוצה שנשארה פתוחה נוגעת להיסטוריה סגורה בלבד —
          אם לא תוכרע, שתי הרשומות פשוט ייובאו בנפרד. שום עסקה פתוחה ושום סיור עתידי לא יושפעו.
        </div>
      ) : (
        <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3 text-[13px] text-red-900">
          <b>{num(head?.beforeImport)} קבוצות נוגעות לעסקה פתוחה או לסיור עתידי.</b> אלה היחידות שאיחוד שגוי בהן
          עלול לפגוע בתפעול חי — כדאי להכריע אותן לפני ייבוא הזהויות.
        </div>
      )}

      {safeRemaining > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-3 mb-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-[13px] text-gray-700">
              <b>{num(safeRemaining)}</b> קבוצות בטוחות ממתינות לאישור קבוצתי.
            </div>
            <button
              type="button" disabled={busy} onClick={batchApprove}
              className="text-[13px] px-3 py-1.5 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 mr-auto"
            >
              אשר את כל {num(safeRemaining)} הקבוצות הבטוחות
            </button>
          </div>
          {batchMsg && <div className="mt-2 text-[12px] text-green-800 bg-green-50 border border-green-200 rounded px-2 py-1">{batchMsg}</div>}
          <p className="text-[11px] text-gray-400 mt-1.5">
            "בטוח" = יש ראיה בלתי תלויה במפתח שיצר את הקבוצה, ואף סימן אחר לא סותר. כל השאר נשאר להכרעה שלך.
          </p>
        </div>
      )}

      {/* Sections — priority order, not alphabetical. */}
      <div className="flex flex-wrap gap-1 mb-1">
        {SECTIONS.map((s) => {
          const c = counts(s.key);
          const n = s.key === 'none' ? c.total : c.unresolved;
          return (
            <button
              key={s.key} type="button"
              onClick={() => { setSection(s.key); setOpenId(null); setDraft(null); }}
              className={`text-[12px] px-2.5 py-1.5 rounded-lg border transition ${
                section === s.key ? `${s.cls} font-semibold` : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {s.emoji} {s.label} <span className="opacity-70">({num(n)})</span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <label className="flex items-center gap-1.5 text-[12px] text-gray-500">
          <input type="checkbox" checked={showResolved} onChange={(e) => { setShowResolved(e.target.checked); setOpenId(null); }} />
          הצג גם קבוצות שכבר הוכרעו
        </label>
        <span className="text-[12px] text-gray-400">{num(data.counts.shown)} מוצגות</span>
      </div>

      {section === 'none' && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 mb-3 text-[12px] text-gray-600">
          הקבוצות האלה מוצגות לשקיפות בלבד — <b>אין בהן מה להכריע</b>. בכל אחת מהן לכל היותר איש קשר אחד
          ייובא ל-GOS בכלל: לשאר אין אף עסקה, פעילות, הערה או קובץ, ולכן הם נשמרים בצילום ובארכיון ולא נוצרים
          כאנשי קשר. כפילות לא יכולה להיווצר כאן.
        </div>
      )}

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
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${CONF[p.confidence]?.cls || 'bg-gray-100 text-gray-600'}`}>{CONF[p.confidence]?.label || p.confidence}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS[d.status]?.cls}`}>{STATUS[d.status]?.label}</span>
                      <span className="text-[10px] text-gray-400">
                        {p.clusterKind === 'phone' ? 'טלפון' : 'אימייל'} · {num(p.totals.deals)} עסקאות
                        {p.totals.openDeals ? <b className="text-red-700"> · {num(p.totals.openDeals)} פתוחות</b> : null}
                        {p.totals.futureTourDeals ? <b className="text-blue-700"> · {num(p.totals.futureTourDeals)} סיור עתידי</b> : null}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
            {!data.decisions.length && (
              <li className="px-3 py-8 text-center text-[13px] text-gray-400">
                {section === 'critical' ? '✓ אין כאן כלום — אפשר להמשיך בבטחה' : 'אין פריטים בסינון הזה'}
              </li>
            )}
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
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${CONF[selected.proposal.confidence]?.cls || 'bg-gray-100 text-gray-600'}`}>
                    {CONF[selected.proposal.confidence]?.label || selected.proposal.confidence}
                  </span>
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
                          <div className="flex items-center gap-1.5">
                            <div className="text-[13px] font-semibold text-gray-900">{m.name}</div>
                            {m.importable === false && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500" title="אין לו אף עסקה, פעילות, הערה או קובץ">
                                לא ייובא — רשומה ריקה
                              </span>
                            )}
                          </div>
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
                            {m.openDealCount ? <span className="text-red-700"> · {num(m.openDealCount)} פתוחות</span> : null}
                            {m.futureTourDeals ? <span className="text-blue-700"> · {num(m.futureTourDeals)} סיור עתידי</span> : null}
                            {m.activityCount ? <span> · {num(m.activityCount)} פעילויות</span> : null}
                            {m.noteCount ? <span> · {num(m.noteCount)} הערות</span> : null}
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

              {/* Source-data corrections — an independent decision from the merge. */}
              <IdentityEditor
                members={selected.proposal.members}
                clusterKind={selected.proposal.clusterKind}
                edits={edits}
                note={idNote}
                busy={busy}
                problems={idProblems}
                keySurvives={keySurvives}
                onToggle={(id, kind, v) => setEdits((e) => toggleRemove(e, id, kind, v))}
                onMove={(fromId, kind, v, toId) => setEdits((e) => setMoveTarget(e, fromId, kind, v, toId))}
                onNote={setIdNote}
                onSave={saveIdentity}
                onReset={() => { setEdits(selected.identityEdits || {}); setIdProblems([]); }}
              />

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

function Stat({ label, value, tone, note, emphasise }) {
  return (
    <div className={`bg-white border rounded-xl px-3 py-2 ${emphasise && value ? 'border-red-300 ring-1 ring-red-100' : 'border-gray-200'}`}>
      <div className={`text-2xl font-bold tabular-nums ${tone}`}>{num(value)}</div>
      <div className="text-[12px] text-gray-700 leading-tight mt-0.5">{label}</div>
      {note && <div className="text-[11px] text-gray-400 mt-0.5">{note}</div>}
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
