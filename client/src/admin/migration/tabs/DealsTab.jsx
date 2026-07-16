import { useEffect, useState, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { migrationApi } from '../api.js';
import { num, dateTime } from '../components/format.js';
import SourceRecord from '../components/SourceRecord.jsx';

// Deals Review — the owner's final authority over legacy deals before import.
// The queue holds ONLY the focused populations (seeded by the rehearsal runner);
// the other ~24k deals import unchanged with no owner workload. A legacy foreign
// key never blocks a decision here: destructive choices show the IMPACT REPORT
// and the owner approves the graph change.
const SECTIONS = [
  { key: 'blocking', emoji: '⛔', label: 'חוסם לפני ייבוא', cls: 'bg-red-50 border-red-300 text-red-800' },
  { key: 'open_active', emoji: '🔥', label: 'פתוחות / פעילות', cls: 'bg-orange-50 border-orange-200 text-orange-800' },
  { key: 'archived_open', emoji: '📦', label: 'פתוחות בארכיון', cls: 'bg-amber-50 border-amber-200 text-amber-800' },
  { key: 'open_past_tour', emoji: '🕓', label: 'פתוחה עם סיור שעבר', cls: 'bg-amber-50 border-amber-200 text-amber-800' },
  { key: 'identity_problem', emoji: '👤', label: 'בעיית זהות', cls: 'bg-blue-50 border-blue-200 text-blue-800' },
  { key: 'stage_anomaly', emoji: '🧭', label: 'חריגת שלב/סטטוס', cls: 'bg-blue-50 border-blue-200 text-blue-800' },
  { key: 'zero_value_won', emoji: '❓', label: 'WON בשווי 0', cls: 'bg-gray-50 border-gray-200 text-gray-700' },
  { key: 'owner_deleted', emoji: '🗑️', label: 'נמחקו ע"י הבעלים', cls: 'bg-gray-100 border-gray-300 text-gray-500' },
];
const STATUS = {
  pending: { label: 'ממתין', cls: 'bg-gray-100 text-gray-600' },
  approved: { label: 'אושר', cls: 'bg-green-50 text-green-700' },
  edited: { label: 'הוכרע', cls: 'bg-green-50 text-green-700' },
  rejected: { label: 'נדחה', cls: 'bg-red-50 text-red-700' },
  deferred: { label: 'נדחה למועד אחר', cls: 'bg-amber-50 text-amber-800' },
};
const TREATMENT_LABEL = {
  import: 'ייבוא כפי שהיא', import_corrected: 'ייבוא עם תיקונים', merge: 'איחוד לעסקה אחרת',
  exclude: 'לא לייבא', deleted: 'נמחקה — זבל היסטורי',
};

export default function DealsTab() {
  const { reload } = useOutletContext() || {};
  const [section, setSection] = useState('blocking');
  const [showResolved, setShowResolved] = useState(false);
  const [data, setData] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [mode, setMode] = useState('import'); // the treatment being edited
  const [corr, setCorr] = useState({});
  const [mergeTarget, setMergeTarget] = useState('');
  const [impact, setImpact] = useState(null);
  const [note, setNote] = useState('');
  const [source, setSource] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try { setData(await migrationApi.queue('deals', showResolved ? null : 'unresolved')); setError(null); }
    catch { setError('טעינת התור נכשלה'); }
  }, [showResolved]);
  useEffect(() => { load(); }, [load]);

  const rows = (data?.decisions || []).filter((d) => d.proposal.section === section);
  const counts = {};
  for (const d of data?.decisions || []) counts[d.proposal.section] = (counts[d.proposal.section] || 0) + 1;
  const selected = rows.find((d) => d.id === openId) || null;

  function select(d) {
    setOpenId(d.id); setSource(null); setImpact(null); setNote(d.note || '');
    setMode(d.decision?.treatment || 'import');
    setCorr(d.decision?.corrections || {});
    setMergeTarget(d.decision?.mergeIntoDealId ? String(d.decision.mergeIntoDealId) : '');
  }
  async function chooseDelete() {
    setMode('deleted');
    setImpact(null);
    try { setImpact(await migrationApi.dealImpact(selected.proposal.dealId)); }
    catch { setImpact({ consequences: ['לא ניתן לחשב דוח השלכות — נסה שוב'], error: true }); }
  }
  async function act(action, decision = null) {
    setBusy(true);
    try {
      await migrationApi.decide(selected.id, { action, decision, note: note || null });
      await load(); reload?.();
      setOpenId(null);
    } catch (e) { setError(e?.body?.problems?.join(' · ') || 'שמירת ההחלטה נכשלה'); }
    setBusy(false);
  }
  const approve = () => {
    const decision =
      mode === 'import' ? { treatment: 'import' }
      : mode === 'import_corrected' ? { treatment: 'import_corrected', corrections: corr }
      : mode === 'merge' ? { treatment: 'merge', mergeIntoDealId: Number(mergeTarget) || null }
      : mode === 'exclude' ? { treatment: 'exclude' }
      : { treatment: 'deleted', deleted: { impact } };
    return act('edit', decision);
  };

  if (error) return <div className="p-4"><div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div></div>;
  if (!data) return <div className="p-6 text-sm text-gray-500">טוען…</div>;
  if (!data.counts.all) {
    return (
      <div className="p-6">
        <div className="max-w-lg mx-auto bg-white border border-gray-200 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">💼</div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">אין הצעות עדיין</h2>
          <p className="text-sm text-gray-500">התור נבנה מחזרת הייבוא (rehearsal) — רק העסקאות הדורשות תשומת לב מופיעות כאן.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="bg-white border border-gray-200 rounded-xl p-3 mb-3 text-[13px] text-gray-700">
        רק <b>{num(data.counts.all)}</b> עסקאות דורשות תשומת לב — כל שאר ה-24,359 מיובאות כפי שהן, ללא עבודת בעלים.
        <span className="block text-[11px] text-gray-400 mt-0.5">מפתח זר במערכת הקודמת לעולם לא חוסם החלטה — פעולה הרסנית מציגה דוח השלכות ואתה מכריע.</span>
      </div>

      <div className="flex flex-wrap gap-1 mb-3">
        {SECTIONS.map((s) => (
          <button key={s.key} type="button"
            onClick={() => { setSection(s.key); setOpenId(null); }}
            className={`text-[12px] px-2.5 py-1.5 rounded-lg border transition ${section === s.key ? `${s.cls} font-semibold` : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {s.emoji} {s.label} <span className="opacity-70">({num(counts[s.key] ?? 0)})</span>
          </button>
        ))}
        <label className="flex items-center gap-1.5 text-[12px] text-gray-500 mr-2">
          <input type="checkbox" checked={showResolved} onChange={(e) => { setShowResolved(e.target.checked); setOpenId(null); }} />
          הצג גם שהוכרעו
        </label>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[24rem_1fr] gap-3">
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <ul className="divide-y divide-gray-100 max-h-[70vh] overflow-y-auto">
            {rows.map((d) => (
              <li key={d.id}>
                <button type="button" onClick={() => select(d)} className={`w-full text-right px-3 py-2.5 hover:bg-gray-50 ${openId === d.id ? 'bg-blue-50' : ''}`}>
                  <div className="text-[13px] font-medium text-gray-900 truncate mb-1">
                    #{d.proposal.dealId} · {d.proposal.title || '(ללא כותרת)'}
                  </div>
                  <div className="flex flex-wrap items-center gap-1 text-[10px]">
                    <span className={`px-1.5 py-0.5 rounded ${d.proposal.status === 'open' ? 'bg-red-50 text-red-700' : d.proposal.status === 'won' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{d.proposal.status}</span>
                    <span className={`px-1.5 py-0.5 rounded ${STATUS[d.status]?.cls}`}>{d.decision?.treatment ? TREATMENT_LABEL[d.decision.treatment] : STATUS[d.status]?.label}</span>
                    <span className="text-gray-400">₪{num(d.proposal.value)} · {d.proposal.tourDate || 'ללא תאריך סיור'}{d.proposal.archived ? ' · ארכיון' : ''}</span>
                  </div>
                </button>
              </li>
            ))}
            {!rows.length && <li className="px-3 py-8 text-center text-[13px] text-gray-400">אין פריטים בקטגוריה הזו</li>}
          </ul>
        </div>

        <div className="min-w-0">
          {!selected ? (
            <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-[13px] text-gray-400">בחר עסקה מהרשימה</div>
          ) : (
            <div className="space-y-3">
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                  <h3 className="text-sm font-semibold text-gray-900">עסקה #{selected.proposal.dealId} — {selected.proposal.title}</h3>
                  <button type="button" onClick={() => setSource(selected.proposal.source)} className="text-[11px] text-blue-700 hover:underline">רשומת מקור →</button>
                </div>
                <div className="text-[12px] text-gray-600 space-y-0.5">
                  <div>סטטוס: <b>{selected.proposal.status}</b>{selected.proposal.wonTime ? ` · נסגרה ${selected.proposal.wonTime}` : ''} · שווי ₪{num(selected.proposal.value)} {selected.proposal.currency}</div>
                  {selected.proposal.stage && <div>שלב מקור: {selected.proposal.stage.pipeline} · {selected.proposal.stage.stage} → יעד: <b>{selected.proposal.stage.target}</b></div>}
                  {selected.proposal.tourDate && <div>תאריך סיור: {selected.proposal.tourDate}</div>}
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

              {/* Treatment selector — the five canonical decisions. No split. */}
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {Object.entries(TREATMENT_LABEL).map(([k, label]) => (
                    <button key={k} type="button"
                      onClick={() => (k === 'deleted' ? chooseDelete() : (setMode(k), setImpact(null)))}
                      className={`text-[12px] px-2.5 py-1.5 rounded-lg border transition ${mode === k
                        ? (k === 'deleted' ? 'bg-red-600 border-red-600 text-white font-semibold' : 'bg-blue-50 border-blue-300 text-blue-800 font-semibold')
                        : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                      {k === 'deleted' ? '🗑️ ' : ''}{label}
                    </button>
                  ))}
                </div>

                {mode === 'import_corrected' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                    <Field label="כותרת" value={corr.title ?? selected.proposal.title} onChange={(v) => setCorr({ ...corr, title: v })} />
                    <Field label="שווי (באגורות)" value={corr.valueMinor ?? Math.round(selected.proposal.value * 100)} onChange={(v) => setCorr({ ...corr, valueMinor: Number(v) || 0 })} />
                    <Field label="מטבע" value={corr.currency ?? selected.proposal.currency} onChange={(v) => setCorr({ ...corr, currency: v })} />
                    <Field label="שלב יעד (key)" value={corr.stage ?? selected.proposal.stage?.target ?? ''} onChange={(v) => setCorr({ ...corr, stage: v })} />
                    <Field label="איש קשר — מזהה מקור" value={corr.contactSourceId ?? selected.proposal.personSourceId ?? ''} onChange={(v) => setCorr({ ...corr, contactSourceId: Number(v) || null })} />
                    <Field label="ארגון — מזהה מקור" value={corr.organizationSourceId ?? selected.proposal.orgSourceId ?? ''} onChange={(v) => setCorr({ ...corr, organizationSourceId: Number(v) || null })} />
                    <p className="sm:col-span-2 text-[11px] text-gray-400">מזהי מקור נפתרים דרך ה-crosswalk בלבד — מצא מזהים בדפדפן הצילום. שדה ריק = ללא שינוי.</p>
                  </div>
                )}

                {mode === 'merge' && (
                  <div className="mb-2">
                    <Field label="מזהה עסקת היעד (Pipedrive)" value={mergeTarget} onChange={setMergeTarget} />
                    <p className="text-[11px] text-gray-400 mt-1">העסקה הזו לא תיווצר; רשומת ה-crosswalk שלה תצביע על עסקת היעד.</p>
                  </div>
                )}

                {mode === 'deleted' && (
                  <div className="border-2 border-red-300 rounded-lg p-3 mb-2">
                    <div className="text-[12px] text-gray-700 bg-red-50 border border-red-200 rounded px-2.5 py-2 mb-2">
                      העסקה לא תיווצר ב-GOS ולא תופיע כישות בארכיון. צילום המקור נשמר לביקורת בלבד.
                    </div>
                    <div className="text-[12px] font-semibold text-gray-900 mb-1">דוח השלכות:</div>
                    {!impact && <div className="text-[12px] text-gray-400">מחשב…</div>}
                    {impact?.consequences?.map((c) => <div key={c} className="text-[12px] text-gray-700">• {c}</div>)}
                  </div>
                )}

                {(selected.resolved || selected.status === 'deferred') && (
                  <p className="text-[11px] text-gray-400 mb-2">{STATUS[selected.status]?.label} · {selected.decidedByName || '—'} · {dateTime(selected.decidedAt)}</p>
                )}
                <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="הערת החלטה (לא חובה)"
                  className="w-full text-[13px] border border-gray-200 rounded-md px-2 py-1.5 bg-white mb-2" />
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy || (mode === 'deleted' && !impact) || (mode === 'merge' && !mergeTarget)} onClick={approve}
                    className={`text-[13px] px-3 py-1.5 rounded-md text-white disabled:opacity-50 ${mode === 'deleted' ? 'bg-red-600 hover:bg-red-700 font-semibold' : 'bg-green-600 hover:bg-green-700'}`}>
                    {mode === 'deleted' ? 'מחק סופית — אני מאשר' : `אשר: ${TREATMENT_LABEL[mode]}`}
                  </button>
                  <button type="button" disabled={busy} onClick={() => act('defer')}
                    className="text-[13px] px-3 py-1.5 rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50">דחה לבדיקה</button>
                </div>
                <p className="text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded px-2 py-1.5 mt-2">
                  🔒 <b>הצילום המקורי לעולם לא משתנה.</b> ההחלטה נשמרת ביומן בלבד וניתנת לשינוי עד ייבוא העסקאות.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }) {
  return (
    <label className="block">
      <span className="block text-[11px] text-gray-500 mb-0.5">{label}</span>
      <input type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value)}
        className="w-full text-[13px] border border-gray-200 rounded-md px-2 py-1.5 bg-white" />
    </label>
  );
}
