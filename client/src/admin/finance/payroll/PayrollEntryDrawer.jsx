import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';
import { formatMinor, toMinor, minorToInput } from '../../../lib/money.js';
import { fmtDate } from '../../common/pickers/DateTimeFields.jsx';
import { ROLE_LABELS, entryStatusMeta } from './payrollConfig.js';

// Focused single-entry editor — the Reports flow: one row = ONE person's
// PayrollEntry, without the rest of the activity matrix. Same large-drawer
// pattern (absolute inset-0 slide-over). Everything here is a PAYROLL
// correction only: guide/product context changes affect this entry's
// calculation snapshot and history — never the Deal, the TourEvent, Tour
// assignments, the ProductVariant master record, or the PersonProfile.

const fieldCls =
  'h-8 rounded-lg border border-gray-300 bg-white px-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-blue-100';

function lineFinal(l) {
  if (l.overrideMinor != null) return Number(l.overrideMinor);
  if (l.calculatedMinor != null) return Number(l.calculatedMinor);
  return 0;
}

export default function PayrollEntryDrawer({ entryId, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(true);
  const [changingGuide, setChangingGuide] = useState(false);
  const [changingContext, setChangingContext] = useState(false);
  const [assignable, setAssignable] = useState(null);
  const [variants, setVariants] = useState(null);
  const [overrideDrafts, setOverrideDrafts] = useState({});
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    try {
      const payload = await api.payroll.entry(entryId);
      setData(payload);
      setNotes(payload.entry.notes || '');
      setOverrideDrafts({});
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [entryId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(
        e.payload?.error === 'person_already_in_activity'
          ? 'לאיש הצוות שנבחר כבר יש רשומת שכר בפעילות זו.'
          : e.payload?.error === 'person_not_assignable'
            ? 'איש הצוות שנבחר אינו פעיל במערכת.'
            : e.payload?.error || e.message,
      );
    } finally {
      setBusy(false);
    }
  };

  const entry = data?.entry;
  const meta = entry ? entryStatusMeta(entry) : null;

  return (
    <div className="absolute inset-0 z-30 bg-white flex flex-col shadow-2xl" dir="rtl">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-200 bg-gray-50">
        <button
          type="button"
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-200 text-gray-500 text-lg"
          title="סגור (Esc)"
        >
          ×
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-gray-900 truncate">
            {entry ? `${entry.displayName} · ${data.activity.titleHe}` : '…'}
          </div>
          {entry && (
            <div className="text-[11px] text-gray-500">
              {data.activity.date ? fmtDate(data.activity.date) : `חודש ${data.activity.payrollMonth}`}
              {' · '}חודש שכר {data.activity.payrollMonth}
              {' · '}{data.activity.sourceType === 'tour_event' ? 'סיור' : 'פעילות כללית'}
              {entry.role ? ` · ${ROLE_LABELS[entry.role] || entry.role}` : ''}
            </div>
          )}
        </div>
        {meta && (
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${meta.cls}`}>{meta.label}</span>
        )}
        {entry && entry.state === 'active' && (
          entry.officeStatus === 'approved' ? (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                window.confirm(`להסיר את אישור המשרד של ${entry.displayName}?`) &&
                run(() => api.payroll.officeUnapproveEntry(entry.id))
              }
              className="px-3 py-1.5 text-[12px] rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100"
            >
              הסר אישור משרד
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => api.payroll.officeApproveEntry(entry.id))}
              className="px-3 py-1.5 text-[12px] rounded-md bg-blue-600 text-white hover:bg-blue-700"
            >
              אשר במשרד
            </button>
          )
        )}
      </div>

      {error && <div className="px-4 py-2 bg-red-50 text-red-700 text-sm">{error}</div>}

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {!data ? (
          <div className="text-sm text-gray-400">טוען…</div>
        ) : (
          <>
            {/* Context bar — payroll-only correction controls */}
            <div className="flex flex-wrap items-center gap-3 text-[12px] bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              {data.tour && (
                <span className="text-gray-600">
                  {data.tour.productName}
                  {data.tour.locationName ? ` · ${data.tour.locationName}` : ''}
                  {data.tour.startTime ? ` · ${data.tour.startTime}` : ''}
                </span>
              )}
              <label className="flex items-center gap-1.5">
                <span className="text-gray-500">תפקיד:</span>
                <select
                  value={entry.role || ''}
                  disabled={busy}
                  onChange={(e) => run(() => api.payroll.updateEntry(entry.id, { role: e.target.value || null }))}
                  className={fieldCls}
                >
                  <option value="">כללי</option>
                  {Object.entries(ROLE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5">
                <span className="text-gray-500">מע״מ:</span>
                <select
                  value={entry.vatStatus}
                  disabled={busy}
                  onChange={(e) => run(() => api.payroll.updateEntry(entry.id, { vatStatus: e.target.value }))}
                  className={fieldCls}
                >
                  <option value="exempt">פטור ממע״מ</option>
                  <option value="vat_18">חייב מע״מ ({entry.vatRate}%)</option>
                </select>
              </label>
              <button
                type="button"
                onClick={async () => {
                  setChangingGuide((v) => !v);
                  if (!assignable) setAssignable((await api.people.assignable()).people);
                }}
                className="text-blue-600 hover:underline"
              >
                החלף מדריך…
              </button>
              {data.activity.sourceType === 'tour_event' && (
                <button
                  type="button"
                  onClick={async () => {
                    setChangingContext((v) => !v);
                    if (!variants) setVariants(await api.products.variantOptions());
                  }}
                  className="text-blue-600 hover:underline"
                >
                  שנה הקשר מוצר לשכר…
                </button>
              )}
            </div>

            {changingGuide && (
              <div className="border border-blue-200 bg-blue-50/40 rounded-lg p-3 text-[12px]">
                <div className="mb-1.5 text-gray-700 font-medium">
                  העברת רשומת השכר לאיש צוות אחר — שינוי זה משפיע על רשומת השכר בלבד (השיבוץ בסיור לא משתנה).
                  הרשומה תחזור לטיוטה ותידרש אישור משרד מחדש.
                </div>
                <select
                  disabled={busy || !assignable}
                  defaultValue=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    run(() => api.payroll.changeEntryGuide(entry.id, e.target.value)).then(() => setChangingGuide(false));
                  }}
                  className={`${fieldCls} min-w-[14rem]`}
                >
                  <option value="">{assignable ? 'בחרו איש צוות…' : 'טוען…'}</option>
                  {(assignable || [])
                    .filter((p) => p.externalPersonId !== entry.externalPersonId)
                    .map((p) => (
                      <option key={p.externalPersonId} value={p.externalPersonId}>
                        {p.displayName}
                        {p.lifecycleHint === 'trainee' ? ' · מתלמד' : ''}
                      </option>
                    ))}
                </select>
              </div>
            )}

            {changingContext && (
              <div className="border border-blue-200 bg-blue-50/40 rounded-lg p-3 text-[12px]">
                <div className="mb-1.5 text-gray-700 font-medium">
                  חישוב בסיס/נסיעות לפי וריאנט אחר — שינוי זה משפיע על רשומת השכר בלבד (הסיור והדיל לא משתנים).
                </div>
                <select
                  disabled={busy || !variants}
                  defaultValue=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    run(() => api.payroll.setEntryPayrollContext(entry.id, e.target.value)).then(() => setChangingContext(false));
                  }}
                  className={`${fieldCls} min-w-[16rem]`}
                >
                  <option value="">{variants ? 'בחרו וריאנט…' : 'טוען…'}</option>
                  {(variants || []).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.productNameHe} · {v.locationNameHe}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Lines: calculated / override / final stay separate concepts */}
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-right text-[13px]">
                <thead>
                  <tr className="text-[11px] text-gray-500 bg-gray-50 border-b border-gray-200">
                    <th className="px-3 py-2 font-medium">רכיב</th>
                    <th className="px-3 py-2 font-medium">מחושב</th>
                    <th className="px-3 py-2 font-medium">דריסה</th>
                    <th className="px-3 py-2 font-medium">סופי</th>
                  </tr>
                </thead>
                <tbody>
                  {entry.lines.map((l) => (
                    <tr key={l.id} className="border-b border-gray-50">
                      <td className="px-3 py-1.5 text-gray-700">
                        {l.componentNameHe}
                        {l.sign < 0 && <span className="text-[11px] text-red-500 mr-1">(ניכוי)</span>}
                        {l.quantity != null && (
                          <span className="block text-[10px] text-gray-400">
                            {Number(l.quantity)} × {formatMinor(l.unitPriceMinor ?? 0)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-gray-500 tabular-nums" dir="ltr">
                        {l.calculatedMinor != null ? formatMinor(l.calculatedMinor) : '—'}
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          dir="ltr"
                          disabled={busy}
                          value={overrideDrafts[l.id] ?? minorToInput(l.overrideMinor)}
                          placeholder="—"
                          onChange={(e) => setOverrideDrafts((m) => ({ ...m, [l.id]: e.target.value }))}
                          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                          onBlur={(e) => {
                            const raw = e.target.value.trim();
                            const next = raw === '' ? null : toMinor(raw);
                            const cur = l.overrideMinor == null ? null : Number(l.overrideMinor);
                            if (raw !== '' && next == null) return;
                            if (next === cur) return;
                            run(() => api.payroll.updateLine(l.id, { overrideMinor: next }));
                          }}
                          className="w-24 h-7 rounded border border-gray-200 px-1.5 text-[12px] text-center focus:border-blue-400 focus:outline-none"
                        />
                      </td>
                      <td className={`px-3 py-1.5 font-medium tabular-nums ${l.sign < 0 ? 'text-red-600' : 'text-gray-900'}`} dir="ltr">
                        {formatMinor(lineFinal(l))}
                      </td>
                    </tr>
                  ))}
                  {entry.vatStatus === 'vat_18' && (
                    <>
                      <tr className="border-t border-gray-200 text-[12px] text-gray-500">
                        <td className="px-3 py-1" colSpan={3}>לפני מע״מ</td>
                        <td className="px-3 py-1 tabular-nums" dir="ltr">{formatMinor(entry.totals.netMinor)}</td>
                      </tr>
                      <tr className="text-[12px] text-gray-500">
                        <td className="px-3 py-1" colSpan={3}>מע״מ ({entry.vatRate}%)</td>
                        <td className="px-3 py-1 tabular-nums" dir="ltr">{formatMinor(entry.totals.vatMinor)}</td>
                      </tr>
                    </>
                  )}
                  <tr className="border-t border-gray-300 font-semibold text-gray-900">
                    <td className="px-3 py-2" colSpan={3}>סה״כ לתשלום</td>
                    <td className="px-3 py-2 tabular-nums" dir="ltr">{formatMinor(entry.totals.totalMinor)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Notes */}
            <div>
              <div className="text-[12px] text-gray-500 mb-1">הערות</div>
              <textarea
                value={notes}
                disabled={busy}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={() => {
                  if ((entry.notes || '') !== notes) {
                    run(() => api.payroll.updateEntry(entry.id, { notes }));
                  }
                }}
                rows={2}
                className="w-full rounded-lg border border-gray-200 p-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>

            {/* History + inquiry comments */}
            <div>
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                className="text-[12px] text-gray-500 hover:text-gray-800"
              >
                {showHistory ? '▾' : '◂'} היסטוריה ({data.history?.length || 0})
              </button>
              {showHistory && (
                <div className="mt-2 space-y-1.5">
                  {(data.history || []).map((h) => (
                    <div key={h.id} className="text-[12px] text-gray-600 bg-gray-50 rounded px-3 py-1.5">
                      <span>{h.body}</span>
                      <span className="text-gray-400 mr-2">
                        · {new Date(h.createdAt).toLocaleString('he-IL')}
                        {h.createdByName ? ` · ${h.createdByName}` : h.actorLabel ? ` · ${h.actorLabel}` : ''}
                      </span>
                      {(h.comments || []).map((c) => (
                        <div key={c.id} className="mr-4 mt-1 text-gray-700 bg-white border border-gray-100 rounded px-2 py-1">
                          💬 {c.body}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
