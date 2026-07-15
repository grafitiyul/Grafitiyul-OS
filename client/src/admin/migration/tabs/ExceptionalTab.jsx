import { useEffect, useState, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { migrationApi } from '../api.js';
import { num, dateTime } from '../components/format.js';
import SourceRecord from '../components/SourceRecord.jsx';

const STATUS = {
  pending: { label: 'ממתין', cls: 'bg-gray-100 text-gray-600' },
  approved: { label: 'אושר', cls: 'bg-green-50 text-green-700' },
  edited: { label: 'אושר בעריכה', cls: 'bg-green-50 text-green-700' },
  rejected: { label: 'הוחרג', cls: 'bg-red-50 text-red-700' },
  deferred: { label: 'נדחה למועד אחר', cls: 'bg-amber-50 text-amber-800' },
};
const TREATMENTS = [
  ['import_as_open', 'לייבא כפי שהיא'],
  ['import_as_contact', 'לייבא כאיש קשר'],
  ['link_to_organization_only', 'לשייך לארגון בלבד'],
  ['archive_only', 'ארכיון בלבד — לא לייבא'],
  ['needs_owner_route', 'לנתב ידנית ליעד אחר'],
];

export default function ExceptionalTab() {
  const { reload } = useOutletContext() || {};
  const [scope, setScope] = useState('blocking');
  const [data, setData] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [treatment, setTreatment] = useState('');
  const [note, setNote] = useState('');
  const [source, setSource] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try { setData(await migrationApi.queue('exceptional')); setError(null); }
    catch { setError('טעינת התור נכשלה'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const rows = (data?.decisions || []).filter((d) =>
    scope === 'blocking' ? d.proposal.blocksIdentity : scope === 'other' ? !d.proposal.blocksIdentity : true,
  );
  const selected = rows.find((d) => d.id === openId) || null;
  const blocking = (data?.decisions || []).filter((d) => d.proposal.blocksIdentity && !d.resolved).length;
  const other = (data?.decisions || []).filter((d) => !d.proposal.blocksIdentity && !d.resolved).length;

  function select(d) { setOpenId(d.id); setSource(null); setTreatment(d.decision?.treatment || d.proposal.proposedTreatment); setNote(d.note || ''); }
  async function act(action) {
    setBusy(true);
    try {
      await migrationApi.decide(selected.id, { action, decision: ['approve', 'edit'].includes(action) ? { treatment } : null, note: note || null });
      await load(); reload?.();
      setOpenId(null);
    } catch { setError('שמירת ההחלטה נכשלה'); }
    setBusy(false);
  }

  if (error) return <div className="p-4"><div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div></div>;
  if (!data) return <div className="p-6 text-sm text-gray-500">טוען…</div>;
  if (!data.counts.all) {
    return (
      <div className="p-6">
        <div className="max-w-lg mx-auto bg-white border border-gray-200 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">⚠️</div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">אין חריגים</h2>
          <p className="text-sm text-gray-500">ההצעות נבנות מהצילום בתהליך נפרד.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className={`border rounded-xl px-3 py-2 mb-3 text-[13px] ${blocking ? 'bg-red-50 border-red-200 text-red-900' : 'bg-green-50 border-green-200 text-green-900'}`}>
        {blocking
          ? <><b>{num(blocking)} חריגים חוסמים את ייבוא הזהויות.</b> אלה מקרים שבהם ייווצר איש קשר או ארגון שגוי — או שלא ייווצר בכלל.</>
          : <><b>אף חריג לא חוסם את ייבוא הזהויות.</b> {num(other)} החריגים הפתוחים נוגעים לייבוא העסקאות, הסיורים והגבייה — שלבים מאוחרים יותר.</>}
      </div>
      <p className="text-[11px] text-gray-400 mb-3">
        כאן מופיעים רק מקרים חריגים באמת — לא אזהרות ולידציה רגילות. לקוח פרטי בלי ארגון הוא תקין ולא מופיע כאן.
      </p>

      <div className="flex flex-wrap gap-1 mb-3">
        {[['blocking', `חוסם ייבוא זהויות (${num(blocking)})`], ['other', `לא חוסם (${num(other)})`], ['all', `הכול (${num(data.counts.all)})`]].map(([k, label]) => (
          <button key={k} type="button" onClick={() => { setScope(k); setOpenId(null); }}
            className={`text-[12px] px-2.5 py-1 rounded-full border transition ${scope === k ? 'bg-blue-50 border-blue-200 text-blue-700 font-semibold' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[22rem_1fr] gap-3">
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <ul className="divide-y divide-gray-100 max-h-[70vh] overflow-y-auto">
            {rows.map((d) => (
              <li key={d.id}>
                <button type="button" onClick={() => select(d)} className={`w-full text-right px-3 py-2.5 hover:bg-gray-50 ${openId === d.id ? 'bg-blue-50' : ''}`}>
                  <div className="text-[13px] font-medium text-gray-900 truncate mb-1">{d.proposal.title}</div>
                  <div className="flex flex-wrap items-center gap-1">
                    {d.proposal.blocksIdentity
                      ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-700">חוסם זהויות</span>
                      : <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">לא חוסם</span>}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS[d.status]?.cls}`}>{STATUS[d.status]?.label}</span>
                    <span className="text-[10px] text-gray-400 truncate">{d.proposal.label}</span>
                  </div>
                </button>
              </li>
            ))}
            {!rows.length && <li className="px-3 py-8 text-center text-[13px] text-gray-400">{scope === 'blocking' ? '✓ אין חריגים שחוסמים ייבוא זהויות' : 'אין פריטים'}</li>}
          </ul>
        </div>

        <div className="min-w-0">
          {!selected ? (
            <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-[13px] text-gray-400">בחר חריג מהרשימה</div>
          ) : (
            <div className="space-y-3">
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <h3 className="text-sm font-semibold text-gray-900">{selected.proposal.label}</h3>
                  {selected.proposal.blocksIdentity
                    ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-50 text-red-700">חוסם ייבוא זהויות</span>
                    : <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">לא חוסם ייבוא זהויות</span>}
                </div>
                <p className="text-[13px] text-gray-600 leading-relaxed mb-2">{selected.proposal.why}</p>
                <p className="text-[12px] text-gray-500">השפעה תפעולית: <b>{selected.proposal.impact}</b></p>
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-gray-900 mb-2">הראיות</h3>
                <ul className="text-[12px] text-gray-700 space-y-0.5">
                  {selected.proposal.evidence.map((e) => <li key={e}>• {e}</li>)}
                </ul>
                <div className="mt-2 pt-2 border-t border-gray-100 flex flex-wrap gap-2">
                  {selected.proposal.records.map((r) => (
                    <button key={`${r.entity}-${r.id}`} type="button" onClick={() => setSource({ entity: r.entity, id: r.id })}
                      className="text-[11px] text-blue-700 hover:underline">
                      {r.entity.split('/').pop()} #{r.id} →
                    </button>
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

              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-gray-900 mb-2">הטיפול</h3>
                <div className="space-y-1">
                  {TREATMENTS.filter(([k]) => selected.proposal.proposedTreatment === k || selected.proposal.choices.includes('edit')).map(([k, label]) => (
                    <label key={k} className="flex items-center gap-2 text-[13px]">
                      <input type="radio" name={`t-${selected.id}`} checked={treatment === k} onChange={() => setTreatment(k)} />
                      {label}
                      {selected.proposal.proposedTreatment === k && <span className="text-[10px] text-gray-400">(ההצעה)</span>}
                    </label>
                  ))}
                </div>
                {(selected.resolved || selected.status === 'deferred') && (
                  <p className="text-[11px] text-gray-400 mt-2">
                    {STATUS[selected.status]?.label} · {selected.decidedByName || '—'} · {dateTime(selected.decidedAt)}
                  </p>
                )}
                <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="הערת החלטה (לא חובה)"
                  className="w-full text-[13px] border border-gray-200 rounded-md px-2 py-1.5 bg-white my-2" />
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy || !treatment} onClick={() => act('edit')}
                    className="text-[13px] px-3 py-1.5 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">אשר טיפול</button>
                  <button type="button" disabled={busy} onClick={() => act('reject')}
                    className="text-[13px] px-3 py-1.5 rounded-md border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50">החרג לגמרי</button>
                  <button type="button" disabled={busy} onClick={() => act('defer')}
                    className="text-[13px] px-3 py-1.5 rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50">דחה למועד אחר</button>
                </div>
                <p className="text-[11px] text-gray-400 mt-2">ההחלטה נשמרת ביומן ההחלטות בלבד. שום רשומה לא נוצרת ולא משתנה עכשיו.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
