import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';
import { formatMinor, toMinor, minorToInput } from '../../../lib/money.js';
import { fmtDate } from '../../common/pickers/DateTimeFields.jsx';
import { ACTIVITY_STATUS_META, ROLE_LABELS, entryStatusMeta } from './payrollConfig.js';
import CardKebabMenu from '../../common/CardKebabMenu.jsx';
import PayrollEntryDrawer from './PayrollEntryDrawer.jsx';

// The payroll activity drawer — DealDrawer pattern (absolute inset-0 slide-in
// over the day screen). Top: activity summary. Body: the Excel-like matrix —
// STAFF as columns (lead guide → guides → workshop assistants), payroll
// COMPONENTS as rows, every cell editable. Editing writes an OVERRIDE; the
// calculation is never replaced (calculated shown as a hint + restorable).
// Office approval is ONE action for the whole activity.

const fmtSigned = (minor) => formatMinor(minor);

function final(line) {
  if (line.overrideMinor != null) return Number(line.overrideMinor);
  if (line.calculatedMinor != null) return Number(line.calculatedMinor);
  return 0;
}

// One editable money cell. Commit on blur/Enter; Escape cancels. Clearing the
// input restores the calculated value (override = null).
function MoneyCell({ line, disabled, onCommit }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const overridden = line.overrideMinor != null && line.overrideMinor !== line.calculatedMinor;

  const start = () => {
    if (disabled) return;
    setVal(minorToInput(line.overrideMinor != null ? line.overrideMinor : line.calculatedMinor));
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    const trimmed = String(val).trim();
    if (trimmed === '') {
      if (line.overrideMinor != null) onCommit({ overrideMinor: null });
      return;
    }
    const minor = toMinor(trimmed);
    if (minor == null) return;
    const current = line.overrideMinor != null ? Number(line.overrideMinor) : null;
    if (minor === current) return;
    if (current == null && minor === Number(line.calculatedMinor)) return; // no-op — matches the calculation
    onCommit({ overrideMinor: minor });
  };

  if (editing) {
    return (
      <input
        autoFocus
        dir="ltr"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setEditing(false);
        }}
        className="w-24 px-1.5 py-0.5 text-sm text-center border border-blue-400 rounded outline-none"
      />
    );
  }
  const sign = Number(line.sign) || 1;
  const value = final(line);
  return (
    <button
      type="button"
      onClick={start}
      disabled={disabled}
      className={`w-full px-1 py-0.5 text-sm tabular-nums rounded transition ${
        disabled ? 'cursor-default' : 'hover:bg-blue-50 cursor-text'
      } ${value === 0 ? 'text-gray-300' : sign < 0 ? 'text-red-600' : 'text-gray-800'}`}
      title={overridden ? `מחושב: ${fmtSigned(line.calculatedMinor ?? 0)}` : undefined}
    >
      {value === 0 && line.calculatedMinor == null && line.overrideMinor == null ? '—' : fmtSigned(value)}
      {overridden && <span className="text-[10px] text-amber-600 mr-1">✎</span>}
    </button>
  );
}

// Quantity-based cell (general activities): amount + inline qty × unit editor.
function QuantityCell({ line, disabled, onCommit }) {
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('');

  const start = () => {
    if (disabled) return;
    setQty(String(line.quantity ?? 1));
    setUnit(minorToInput(line.unitPriceMinor));
    setOpen(true);
  };
  const commit = () => {
    setOpen(false);
    const q = Number(qty);
    const u = toMinor(unit);
    if (!Number.isFinite(q) || q < 0 || u == null) return;
    if (q === Number(line.quantity) && u === Number(line.unitPriceMinor)) return;
    onCommit({ quantity: q, unitPriceMinor: u });
  };

  if (open) {
    return (
      <span className="inline-flex items-center gap-1" dir="ltr">
        <input
          autoFocus
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          className="w-12 px-1 py-0.5 text-sm text-center border border-blue-400 rounded outline-none"
          title="כמות (יחידות)"
        />
        <span className="text-gray-400 text-xs">×</span>
        <input
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          onBlur={commit}
          className="w-16 px-1 py-0.5 text-sm text-center border border-blue-400 rounded outline-none"
          title="מחיר ליחידה"
        />
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={start}
      disabled={disabled}
      className={`w-full px-1 py-0.5 text-sm tabular-nums rounded transition ${disabled ? 'cursor-default' : 'hover:bg-blue-50'}`}
    >
      <span className="text-gray-800">{fmtSigned(final(line))}</span>
      <span className="block text-[10px] text-gray-400">
        {Number(line.quantity ?? 0)} × {fmtSigned(line.unitPriceMinor ?? 0)}
      </span>
    </button>
  );
}

export default function PayrollActivityDrawer({ activityId, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // Per-column approval feedback ("סכום אפס" etc.) — keyed by entry id.
  const [entryErrors, setEntryErrors] = useState({});
  // בבירור chip → that person's focused entry editor (inquiry workspace).
  const [openEntryId, setOpenEntryId] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await api.payroll.activity(activityId));
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [activityId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const updateLine = async (lineId, body) => {
    setBusy(true);
    try {
      await api.payroll.updateLine(lineId, body);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const activity = data?.activity;
  const entries = (data?.entries || []).filter((e) => e.state === 'active');
  const statusMeta = activity ? ACTIVITY_STATUS_META[activity.displayStatus] : null;

  // Matrix rows: the union of component lines across entries, catalog order.
  const rowMap = new Map();
  for (const e of entries) {
    for (const l of e.lines) {
      if (!rowMap.has(l.componentId)) {
        rowMap.set(l.componentId, { componentId: l.componentId, name: l.componentNameHe, sortOrder: l.sortOrder, sign: l.sign });
      }
    }
  }
  const componentRows = [...rowMap.values()].sort((a, b) => a.sortOrder - b.sortOrder);
  const anyVat = entries.some((e) => e.vatStatus === 'vat_18');

  return (
    <div className="absolute inset-0 z-30 bg-white flex flex-col shadow-2xl" dir="rtl">
      {/* Header */}
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
            {activity?.titleHe || '…'}
            {activity?.date && <span className="text-gray-500 font-normal"> · {fmtDate(activity.date)}</span>}
          </div>
        </div>
        {statusMeta && (
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${statusMeta.cls}`}>{statusMeta.label}</span>
        )}
        {activity && activity.state === 'active' && (
          <CardKebabMenu ariaLabel="פעולות פעילות">
            {(close) => (
              <button
                type="button"
                onClick={async () => {
                  close();
                  if (!window.confirm('לבטל את כל פעילות השכר? כל הרשומות יוסתרו מהסכומים ומפורטל המדריכים; ההיסטוריה נשמרת.')) return;
                  const reason = window.prompt('סיבת הביטול (אופציונלי):', '');
                  if (reason === null) return;
                  setBusy(true);
                  try {
                    await api.payroll.voidActivity(activity.id, reason.trim() || null);
                    onClose();
                  } finally { setBusy(false); }
                }}
                className="block w-full text-right px-3 py-1.5 text-[13px] text-red-600 hover:bg-red-50"
              >
                🗑️ בטל פעילות שכר
              </button>
            )}
          </CardKebabMenu>
        )}
      </div>

      {error && <div className="px-4 py-2 bg-red-50 text-red-700 text-sm">{error}</div>}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {!data ? (
          <div className="p-6 text-sm text-gray-400">טוען…</div>
        ) : (
          <>
            {/* Tour / general summary */}
            {data.tour && (
              <div className="px-4 py-3 border-b border-gray-100 bg-white flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-gray-600">
                {data.tour.productName && <span><b className="text-gray-800">{data.tour.productName}</b></span>}
                {data.tour.locationName && <span>📍 {data.tour.locationName}</span>}
                {data.tour.date && <span>🗓 {fmtDate(data.tour.date)}{data.tour.startTime ? ` · ${data.tour.startTime}` : ''}</span>}
                <span>👥 {data.tour.participants} משתתפים</span>
                {data.tour.customers.map((c, i) => (
                  <span key={i}>
                    🤝 {c.title || '—'}
                    {c.organization ? ` (${c.organization})` : ''}
                    {c.orderNo ? ` · #${c.orderNo}` : ''}
                  </span>
                ))}
              </div>
            )}
            {data.general && (
              <div className="px-4 py-3 border-b border-gray-100 bg-white flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-gray-600">
                <span><b className="text-gray-800">{data.general.titleHe}</b></span>
                <span>חודש שכר: {data.general.payrollMonth}</span>
                {data.general.date && <span>🗓 {fmtDate(data.general.date)}</span>}
                {data.general.notes && <span className="text-gray-500">{data.general.notes}</span>}
              </div>
            )}

            {/* Matrix */}
            {entries.length === 0 ? (
              <div className="p-6 text-sm text-gray-500">אין רשומות שכר פעילות — לסיור לא שובץ צוות.</div>
            ) : (
              <div className="p-4 overflow-x-auto">
                <table className="w-full border-collapse text-right" style={{ minWidth: entries.length * 140 + 200 }}>
                  <thead>
                    <tr>
                      <th className="sticky right-0 bg-white text-[12px] font-medium text-gray-500 px-3 py-2 border-b border-gray-200 w-48">
                        רכיב שכר
                      </th>
                      {entries.map((e) => (
                        <th key={e.id} className="text-center px-2 py-2 border-b border-gray-200 min-w-[130px]">
                          <div className="text-[13px] font-semibold text-gray-900">{e.displayName}</div>
                          <div className="text-[11px] text-gray-500">{ROLE_LABELS[e.role] || 'כללי'}</div>
                          {e.inquiryStatus === 'open' ? (
                            <button
                              type="button"
                              onClick={() => setOpenEntryId(e.id)}
                              className={`inline-block mt-0.5 px-1.5 rounded-full text-[10px] underline decoration-dotted ${entryStatusMeta(e).cls}`}
                              title="פתיחת הבירור של איש צוות זה"
                            >
                              {entryStatusMeta(e).label}
                            </button>
                          ) : (
                            <span className={`inline-block mt-0.5 px-1.5 rounded-full text-[10px] ${entryStatusMeta(e).cls}`}>
                              {entryStatusMeta(e).label}
                            </span>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {componentRows.map((row) => (
                      <tr key={row.componentId} className="border-b border-gray-100">
                        <td className="sticky right-0 bg-white px-3 py-1.5 text-[13px] text-gray-700">
                          {row.name}
                          {row.sign < 0 && <span className="text-[11px] text-red-500 mr-1">(ניכוי)</span>}
                        </td>
                        {entries.map((e) => {
                          const line = e.lines.find((l) => l.componentId === row.componentId);
                          if (!line) return <td key={e.id} className="text-center text-gray-200">·</td>;
                          const isQty = line.quantity != null || line.unitPriceMinor != null;
                          return (
                            <td key={e.id} className="text-center px-2 py-1">
                              {isQty ? (
                                <QuantityCell line={line} disabled={busy} onCommit={(b) => updateLine(line.id, b)} />
                              ) : (
                                <MoneyCell line={line} disabled={busy} onCommit={(b) => updateLine(line.id, b)} />
                              )}
                              {line.overrideMinor != null && (
                                <button
                                  type="button"
                                  onClick={() => updateLine(line.id, { overrideMinor: null })}
                                  className="block mx-auto text-[10px] text-gray-400 hover:text-blue-600"
                                  title="חזרה לערך המחושב"
                                >
                                  ↺ מחושב {line.calculatedMinor != null ? fmtSigned(line.calculatedMinor) : '—'}
                                </button>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    {/* Totals — VAT rows appear ONLY when some guide charges VAT;
                        exempt guides get a single total (no VAT concept). */}
                    {anyVat && (
                      <>
                        <tr className="border-t border-gray-300">
                          <td className="sticky right-0 bg-white px-3 py-1.5 text-[12px] text-gray-500">לפני מע״מ</td>
                          {entries.map((e) => (
                            <td key={e.id} className="text-center text-[13px] text-gray-600 tabular-nums">
                              {e.vatStatus === 'vat_18' ? fmtSigned(e.totals.netMinor) : ''}
                            </td>
                          ))}
                        </tr>
                        <tr>
                          <td className="sticky right-0 bg-white px-3 py-1.5 text-[12px] text-gray-500">מע״מ ({entries.find((e) => e.vatStatus === 'vat_18')?.vatRate}%)</td>
                          {entries.map((e) => (
                            <td key={e.id} className="text-center text-[13px] text-gray-600 tabular-nums">
                              {e.vatStatus === 'vat_18' ? fmtSigned(e.totals.vatMinor) : ''}
                            </td>
                          ))}
                        </tr>
                      </>
                    )}
                    <tr className={anyVat ? '' : 'border-t border-gray-300'}>
                      <td className="sticky right-0 bg-white px-3 py-2 text-[13px] font-semibold text-gray-900">
                        סה״כ לתשלום
                      </td>
                      {entries.map((e) => (
                        <td key={e.id} className="text-center text-sm font-semibold text-gray-900 tabular-nums">
                          {fmtSigned(e.totals.totalMinor)}
                        </td>
                      ))}
                    </tr>
                    {/* Office approval — PER PERSON, visually attached to the
                        column. The bulk button below runs the SAME service. */}
                    <tr className="border-t border-gray-200 bg-gray-50/50">
                      <td className="sticky right-0 bg-white px-3 py-2 text-[12px] text-gray-500">
                        אישור משרד
                      </td>
                      {entries.map((e) => (
                        <td key={e.id} className="text-center py-2 align-top">
                          {e.officeStatus === 'approved' ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={async () => {
                                if (!window.confirm(`להסיר את אישור המשרד של ${e.displayName}? הרשומה תוסתר מהמדריך.`)) return;
                                setBusy(true);
                                try { await api.payroll.officeUnapproveEntry(e.id); await load(); } finally { setBusy(false); }
                              }}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-semibold hover:bg-emerald-200"
                              title={`אושר${e.officeApprovedBy ? ` על ידי ${e.officeApprovedBy}` : ''} — לחיצה מסירה את האישור`}
                            >
                              ✓ אושר
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={async () => {
                                setBusy(true);
                                setEntryErrors((m) => ({ ...m, [e.id]: null }));
                                try {
                                  await api.payroll.officeApproveEntry(e.id);
                                  await load();
                                } catch (err) {
                                  setEntryErrors((m) => ({
                                    ...m,
                                    [e.id]: err.payload?.error === 'zero_total'
                                      ? 'סכום אפס — אין מה לאשר'
                                      : err.payload?.error || err.message,
                                  }));
                                } finally { setBusy(false); }
                              }}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-gray-300 text-gray-500 text-[11px] hover:border-blue-400 hover:text-blue-600"
                              title="אשר את הרשומה של איש צוות זה בלבד"
                            >
                              ☐ אשר
                            </button>
                          )}
                          {entryErrors[e.id] && (
                            <div className="mt-1 text-[10px] text-red-600 max-w-[130px] mx-auto">{entryErrors[e.id]}</div>
                          )}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>

                {/* Matrix footer — counts + the bulk action (same service as
                    the per-person control; never a second approval truth). */}
                {activity.state === 'active' && (
                  <div className="mt-3 flex items-center gap-3 flex-wrap border-t border-gray-100 pt-3">
                    <span className="text-[12px] text-gray-600">
                      {entries.filter((e) => e.officeStatus === 'approved').length} מתוך {entries.length} אושרו במשרד
                      {entries.some((e) => e.officeStatus !== 'approved') &&
                        ` · ${entries.filter((e) => e.officeStatus !== 'approved').length} נותרו`}
                    </span>
                    <div className="flex-1" />
                    {entries.some((e) => e.officeStatus !== 'approved') && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          setError(null);
                          try {
                            const r = await api.payroll.approveActivity(activity.id);
                            if (r.skipped?.length) {
                              setError(`לא אושרו (סכום אפס): ${r.skipped.map((s) => s.displayName).join(', ')}`);
                            }
                            await load();
                          } finally { setBusy(false); }
                        }}
                        className="px-4 py-1.5 text-[13px] rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
                      >
                        {entries.some((e) => e.officeStatus === 'approved') ? 'אשר את הנותרים' : 'אשר שכר'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* History */}
            <div className="px-4 pb-6">
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
                        {h.createdByName ? ` · ${h.createdByName}` : ''}
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

      {openEntryId && (
        <PayrollEntryDrawer
          entryId={openEntryId}
          onClose={() => {
            setOpenEntryId(null);
            load();
          }}
        />
      )}
    </div>
  );
}
