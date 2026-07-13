import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';
import { formatMinor, toMinor, minorToInput } from '../../../lib/money.js';
import { fmtDate } from '../../common/pickers/DateTimeFields.jsx';
import { ACTIVITY_STATUS_META, ROLE_LABELS, entryStatusMeta } from './payrollConfig.js';
import { resolveAmountEdit, lineFinalMinor, isOverridden } from './payrollAmount.js';
import Dialog from '../../common/Dialog.jsx';
import CardKebabMenu from '../../common/CardKebabMenu.jsx';
import PayrollEntryDrawer from './PayrollEntryDrawer.jsx';

// The payroll activity editor — a LARGE centered modal (canonical Dialog shell,
// content-based width) over the day screen. Top: activity summary. Body: the
// Excel-like matrix — STAFF as columns (lead guide → guides → workshop
// assistants) with a FIXED compact width each, payroll COMPONENTS as rows,
// every cell editable. The modal sizes to the number of staff between a sane
// min and max; large teams scroll horizontally inside it rather than stretching
// columns across the screen. Editing writes an OVERRIDE; the calculation is
// never replaced. Office approval is PER PERSON (the footer button runs the
// same per-entry service in bulk).

const fmtSigned = (minor) => formatMinor(minor);

// One editable money cell. Commit on blur/Enter; Escape cancels. Empty input
// clears the override (return to calculated); the shared resolveAmountEdit
// semantics live in payrollAmount.js and are applied by the parent on commit.
function MoneyCell({ line, disabled, onCommit }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const overridden = isOverridden(line);

  const start = () => {
    if (disabled) return;
    setVal(minorToInput(lineFinalMinor(line)));
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    onCommit(val);
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
  const value = lineFinalMinor(line);
  return (
    <button
      type="button"
      onClick={start}
      disabled={disabled}
      className={`w-full px-1 py-0.5 text-sm tabular-nums rounded transition ${
        disabled ? 'cursor-default' : 'hover:bg-blue-50 cursor-text'
      } ${overridden ? 'ring-1 ring-amber-300 bg-amber-50/50' : ''} ${
        value === 0 ? 'text-gray-300' : sign < 0 ? 'text-red-600' : 'text-gray-800'
      }`}
      title={overridden ? `חושב אוטומטית: ${fmtSigned(line.calculatedMinor ?? 0)}` : undefined}
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
      <span className="text-gray-800">{fmtSigned(lineFinalMinor(line))}</span>
      <span className="block text-[10px] text-gray-400">
        {Number(line.quantity ?? 0)} × {fmtSigned(line.unitPriceMinor ?? 0)}
      </span>
    </button>
  );
}

export default function PayrollActivityDrawer({ activityId, onClose, refreshTick = 0 }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // Per-column approval feedback ("סכום אפס" etc.) — keyed by entry id.
  const [entryErrors, setEntryErrors] = useState({});
  // בבירור chip → that person's focused entry editor (nested modal on top).
  const [openEntryId, setOpenEntryId] = useState(null);

  const load = useCallback(async ({ silent = false } = {}) => {
    try {
      setData(await api.payroll.activity(activityId));
      setError(null);
    } catch (e) {
      if (!silent) setError(e.message); // background refresh stays quiet
    }
  }, [activityId]);

  useEffect(() => {
    load();
  }, [load]);

  // Real-time signal from the page-level stream (ONE EventSource per surface
  // — the drawer never opens its own): silently re-pull the matrix without
  // closing the modal or dropping scroll.
  useEffect(() => {
    if (refreshTick > 0) load({ silent: true });
  }, [refreshTick, load]);

  // Commit one amount cell edit. The parent resolves the raw string → override
  // via the shared payrollAmount rules; quantity cells pass a {quantity,unit}
  // body straight through.
  const commitCell = async (line, input) => {
    let body;
    if (input && typeof input === 'object') {
      body = input; // quantity cell — {quantity, unitPriceMinor}
    } else {
      const res = resolveAmountEdit(input, line);
      if (res.noop) return;
      body = { overrideMinor: res.overrideMinor };
    }
    setBusy(true);
    try {
      await api.payroll.updateLine(line.id, body);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const clearOverride = async (line) => {
    setBusy(true);
    try {
      await api.payroll.updateLine(line.id, { overrideMinor: null });
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
  const approvedCount = entries.filter((e) => e.officeStatus === 'approved').length;
  const remainingCount = entries.length - approvedCount;

  // Esc / backdrop: while the nested focused-entry modal is open it owns the
  // interaction — the outer close is a no-op so one Esc doesn't collapse both.
  const guardedClose = () => {
    if (openEntryId) return;
    onClose();
  };

  const header = (
    <div className="flex items-center gap-3 w-full min-w-0">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-gray-900 truncate">
          {activity?.titleHe || '…'}
          {activity?.date && <span className="text-gray-500 font-normal"> · {fmtDate(activity.date)}</span>}
        </div>
      </div>
      <div className="flex-1" />
      {statusMeta && (
        <span className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium ${statusMeta.cls}`}>{statusMeta.label}</span>
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
  );

  // Footer: per-activity approval progress + the bulk action (same per-entry
  // service as the per-person controls — never a second approval truth).
  const footer =
    data && activity?.state === 'active' && entries.length > 0 ? (
      <div className="flex items-center gap-3 flex-wrap w-full">
        <span className="text-[12px] text-gray-600">
          {approvedCount} מתוך {entries.length} אושרו במשרד
          {remainingCount > 0 && ` · ${remainingCount} נותרו`}
        </span>
        <div className="flex-1" />
        {remainingCount > 0 && (
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
            {approvedCount > 0 ? 'אשר את הנותרים' : 'אשר שכר'}
          </button>
        )}
      </div>
    ) : null;

  return (
    <>
      <Dialog
        open
        onClose={guardedClose}
        title={header}
        ariaLabel={activity ? `פעילות שכר · ${activity.titleHe}` : 'פעילות שכר'}
        fitContent
        minWidthPx={700}
        maxWidthPx={1400}
        footer={footer}
      >
        {error && <div className="mb-3 px-3 py-2 rounded bg-red-50 text-red-700 text-sm">{error}</div>}
        {!data ? (
          <div className="text-sm text-gray-400">טוען…</div>
        ) : (
          <div className="space-y-4">
            {/* Tour / general summary */}
            {data.tour && (
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-gray-600 border-b border-gray-100 pb-3">
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
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-gray-600 border-b border-gray-100 pb-3">
                <span><b className="text-gray-800">{data.general.titleHe}</b></span>
                <span>חודש שכר: {data.general.payrollMonth}</span>
                {data.general.date && <span>🗓 {fmtDate(data.general.date)}</span>}
                {data.general.notes && <span className="text-gray-500">{data.general.notes}</span>}
              </div>
            )}

            {/* Matrix — staff columns have a FIXED compact width; the whole
                matrix scrolls horizontally inside the modal for large teams
                instead of stretching columns across the screen. */}
            {entries.length === 0 ? (
              <div className="text-sm text-gray-500">אין רשומות שכר פעילות — לסיור לא שובץ צוות.</div>
            ) : (
              <div className="overflow-x-auto -mx-1 px-1">
                <table className="w-auto border-collapse text-right">
                  <thead>
                    <tr>
                      <th className="sticky right-0 bg-white text-[12px] font-medium text-gray-500 px-3 py-2 border-b border-gray-200 w-44 min-w-[11rem]">
                        רכיב שכר
                      </th>
                      {entries.map((e) => (
                        <th key={e.id} className="text-center px-2 py-2 border-b border-gray-200 w-52 min-w-[13rem] max-w-[15rem]">
                          <div className="text-[13px] font-semibold text-gray-900 truncate">{e.displayName}</div>
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
                        <td className="sticky right-0 bg-white px-3 py-1.5 text-[13px] text-gray-700 w-44 min-w-[11rem]">
                          {row.name}
                          {row.sign < 0 && <span className="text-[11px] text-red-500 mr-1">(ניכוי)</span>}
                        </td>
                        {entries.map((e) => {
                          const line = e.lines.find((l) => l.componentId === row.componentId);
                          if (!line) return <td key={e.id} className="text-center text-gray-200">·</td>;
                          const isQty = line.quantity != null || line.unitPriceMinor != null;
                          return (
                            <td key={e.id} className="text-center px-2 py-1 align-top">
                              {isQty ? (
                                <QuantityCell line={line} disabled={busy} onCommit={(b) => commitCell(line, b)} />
                              ) : (
                                <MoneyCell line={line} disabled={busy} onCommit={(v) => commitCell(line, v)} />
                              )}
                              {line.overrideMinor != null && (
                                <button
                                  type="button"
                                  onClick={() => clearOverride(line)}
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
                        column, directly beneath that person. */}
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
                            <div className="mt-1 text-[10px] text-red-600 max-w-[13rem] mx-auto">{entryErrors[e.id]}</div>
                          )}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* History */}
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
          </div>
        )}
      </Dialog>

      {openEntryId && (
        <PayrollEntryDrawer
          entryId={openEntryId}
          refreshTick={refreshTick}
          onClose={() => {
            setOpenEntryId(null);
            load();
          }}
        />
      )}
    </>
  );
}
