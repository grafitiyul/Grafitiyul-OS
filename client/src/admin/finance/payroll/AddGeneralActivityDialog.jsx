import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api.js';
import { toMinor, minorToInput } from '../../../lib/money.js';
import { DateField } from '../../common/pickers/DateTimeFields.jsx';
import { StaffAvatar } from '../../tours/TourTeamEditor.jsx';

// Add General Addition (תוספת כללית; internal model: GeneralActivity) — two steps:
//   1. סוג תוספת + חודש שכר (חובה) + יום (אופציונלי) + בחירת צוות
//      (אף אחד לא מסומן מראש; "בחר הכל" זמין)
//   2. שורה לכל איש צוות עם ברירות המחדל של הפעילות — מחיר ליחידה, כמות
//      (יחידות גנריות), תוספת/ניכוי מהירים והערה
// אישור יוצר רשומת שכר אחת לכל איש צוות (טיוטה — אישור המשרד נשאר פעולה
// אחת ברמת הפעילות, במגירה).

const inputCls =
  'h-9 rounded-lg border border-gray-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200';

export default function AddGeneralActivityDialog({ defaultDate, onClose, onCreated }) {
  const [types, setTypes] = useState(null);
  const [staff, setStaff] = useState(null);
  const [typeId, setTypeId] = useState('');
  const [month, setMonth] = useState(String(defaultDate || '').slice(0, 7));
  const [date, setDate] = useState(defaultDate || null);
  const [selected, setSelected] = useState(new Set());
  const [step, setStep] = useState(1);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      // Canonical assignable list (active staff/trainees only) — the SAME
      // resolver Tour assignment uses; the server re-enforces on create.
      const [{ types: t }, { people }] = await Promise.all([
        api.payroll.activityTypes.list(),
        api.people.assignable(),
      ]);
      setTypes(t.filter((x) => x.active));
      setStaff(people);
    })();
  }, []);

  const type = useMemo(() => (types || []).find((t) => t.id === typeId) || null, [types, typeId]);

  const toStep2 = () => {
    if (!type || !month || selected.size === 0) return;
    setRows(
      [...selected].map((ext) => {
        const person = staff.find((p) => p.externalPersonId === ext);
        return {
          externalPersonId: ext,
          displayName: person?.displayName || ext,
          unitPrice: minorToInput(type.defaultUnitPriceMinor),
          quantity: String(Number(type.defaultQuantity)),
          addition: '',
          deduction: '',
          note: type.defaultNotes || '',
        };
      }),
    );
    setStep(2);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const { activityId } = await api.payroll.createGeneralActivity({
        typeId,
        payrollMonth: month,
        date: date || null,
        rows: rows.map((r) => ({
          externalPersonId: r.externalPersonId,
          unitPriceMinor: toMinor(r.unitPrice) || 0,
          quantity: Number(r.quantity) || 0,
          additionMinor: toMinor(r.addition) || 0,
          deductionMinor: toMinor(r.deduction) || 0,
          note: r.note.trim() || null,
        })),
      });
      onCreated(activityId);
    } catch (e) {
      setError(
        e.payload?.error === 'person_not_assignable'
          ? 'אחד מאנשי הצוות שנבחרו אינו פעיל במערכת (עזב, הושבת או שאינו בסטטוס צוות/מתלמד).'
          : e.payload?.error || e.message,
      );
      setBusy(false);
    }
  };

  const setRow = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" dir="rtl">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900 flex-1">
            תוספת כללית חדשה {step === 2 && type ? `— ${type.nameHe}` : ''}
          </h2>
          <button type="button" onClick={onClose} className="w-7 h-7 rounded hover:bg-gray-100 text-gray-500 text-lg">
            ×
          </button>
        </div>

        {error && <div className="px-5 py-2 bg-red-50 text-red-700 text-sm">{error}</div>}

        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          {types === null || staff === null ? (
            <div className="text-sm text-gray-400">טוען…</div>
          ) : step === 1 ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-4 items-end">
                <label className="block">
                  <span className="block text-[12px] text-gray-500 mb-1">סוג תוספת</span>
                  <select value={typeId} onChange={(e) => setTypeId(e.target.value)} className={`${inputCls} min-w-[14rem]`}>
                    <option value="">בחרו סוג…</option>
                    {types.map((t) => (
                      <option key={t.id} value={t.id}>{t.nameHe}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="block text-[12px] text-gray-500 mb-1">חודש שכר (חובה)</span>
                  <input
                    type="month"
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                    dir="ltr"
                    className={inputCls}
                  />
                </label>
                <div className="block">
                  <span className="block text-[12px] text-gray-500 mb-1">יום (אופציונלי)</span>
                  <div className="w-40">
                    <DateField value={date} onChange={setDate} clearable />
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-[13px] font-medium text-gray-700">אנשי צוות ({selected.size} נבחרו)</span>
                  <button
                    type="button"
                    onClick={() => setSelected(new Set(staff.map((p) => p.externalPersonId)))}
                    className="text-[12px] text-blue-600 hover:underline"
                  >
                    בחר הכל
                  </button>
                  {selected.size > 0 && (
                    <button type="button" onClick={() => setSelected(new Set())} className="text-[12px] text-gray-500 hover:underline">
                      נקה בחירה
                    </button>
                  )}
                </div>
                <div className="max-h-72 overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-3">
                  {/* Two clear groups: צוות (staff + legacy pre-lifecycle rows)
                      and מתלמדים — same grouping rule as the tour team editor. */}
                  {[
                    ['צוות', staff.filter((p) => p.lifecycleHint !== 'trainee')],
                    ['מתלמדים', staff.filter((p) => p.lifecycleHint === 'trainee')],
                  ].map(([label, group]) =>
                    group.length === 0 ? null : (
                      <div key={label}>
                        <div className="px-1 pb-1 text-[11px] font-semibold text-gray-400">{label}</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                          {group.map((p) => (
                            <label
                              key={p.externalPersonId}
                              className="flex items-center gap-2 text-[13px] text-gray-800 px-1.5 py-1 rounded hover:bg-gray-50 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={selected.has(p.externalPersonId)}
                                onChange={(e) => {
                                  setSelected((s) => {
                                    const next = new Set(s);
                                    if (e.target.checked) next.add(p.externalPersonId);
                                    else next.delete(p.externalPersonId);
                                    return next;
                                  });
                                }}
                              />
                              <StaffAvatar src={p.profile?.imageUrl} name={p.displayName} />
                              <span className="truncate">{p.displayName}</span>
                              {p.team?.displayName && (
                                <span className="text-[11px] text-gray-400 truncate">· {p.team.displayName}</span>
                              )}
                            </label>
                          ))}
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </div>
            </div>
          ) : (
            <table className="w-full text-right text-[13px]">
              <thead>
                <tr className="text-[11px] text-gray-500 border-b border-gray-200">
                  <th className="py-1.5 px-1 font-medium">איש צוות</th>
                  <th className="py-1.5 px-1 font-medium">מחיר ליחידה (₪)</th>
                  <th className="py-1.5 px-1 font-medium">כמות (יח׳)</th>
                  <th className="py-1.5 px-1 font-medium">תוספת (₪)</th>
                  <th className="py-1.5 px-1 font-medium">ניכוי (₪)</th>
                  <th className="py-1.5 px-1 font-medium">הערה</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.externalPersonId} className="border-b border-gray-100">
                    <td className="py-1.5 px-1 font-medium text-gray-900 whitespace-nowrap">{r.displayName}</td>
                    <td className="py-1 px-1">
                      <input dir="ltr" value={r.unitPrice} onChange={(e) => setRow(i, { unitPrice: e.target.value })} className={`${inputCls} w-20`} />
                    </td>
                    <td className="py-1 px-1">
                      <input dir="ltr" value={r.quantity} onChange={(e) => setRow(i, { quantity: e.target.value })} className={`${inputCls} w-16`} />
                    </td>
                    <td className="py-1 px-1">
                      <input dir="ltr" value={r.addition} onChange={(e) => setRow(i, { addition: e.target.value })} className={`${inputCls} w-20`} placeholder="0" />
                    </td>
                    <td className="py-1 px-1">
                      <input dir="ltr" value={r.deduction} onChange={(e) => setRow(i, { deduction: e.target.value })} className={`${inputCls} w-20`} placeholder="0" />
                    </td>
                    <td className="py-1 px-1">
                      <input value={r.note} onChange={(e) => setRow(i, { note: e.target.value })} className={`${inputCls} w-full min-w-[8rem]`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-gray-200 bg-gray-50">
          {step === 2 ? (
            <button type="button" onClick={() => setStep(1)} className="px-3 py-1.5 text-[13px] rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100">
              → חזרה לבחירת צוות
            </button>
          ) : <span />}
          {step === 1 ? (
            <button
              type="button"
              disabled={!type || !/^\d{4}-\d{2}$/.test(month) || selected.size === 0}
              onClick={toStep2}
              className="px-4 py-1.5 text-[13px] rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
            >
              המשך ({selected.size})
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={submit}
              className="px-4 py-1.5 text-[13px] rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
            >
              {busy ? 'יוצר…' : `אישור — צור ${rows.length} רשומות שכר`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
