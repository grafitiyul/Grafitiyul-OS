import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import RichText from '../../editor/RichText.jsx';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import ScheduleSendDialog from './ScheduleSendDialog.jsx';
import EmailComposer from './EmailComposer.jsx';
import { canonicalDeliveryState, DELIVERY_LABEL_HE, DELIVERY_TONE } from '../../lib/emailDelivery.js';

// THE canonical management surface for scheduled emails. Used as the Email
// module's "מתוזמנים" view and, scoped by dealId/contactId, inside the Deal and
// Contact email panels — one component, one flow, everywhere.
//
// Queue vs history (matches the server's `scope`):
//   ממתינים — pending + failed: the actionable queue. SENT items leave it on
//             purpose; they live on in normal email history as a real thread.
//   היסטוריה — everything, so a CANCELLED item stays visible with its final
//             state for audit instead of vanishing.

// State + wording come from THE canonical delivery module, so this list, the
// deal timeline, the send archive and the בקרה cards can never disagree about
// whether a message went out.
const statusOf = (row) => {
  const state = canonicalDeliveryState(row.status, { claimedAt: row.claimedAt });
  return { state, label: DELIVERY_LABEL_HE[state], cls: DELIVERY_TONE[state] };
};

const DT = { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' };

function fmt(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('he-IL', DT);
  } catch {
    return '—';
  }
}

function recipients(row) {
  const list = (row.toJson || []).map((r) => r.name || r.email);
  const extra = (row.ccJson || []).length + (row.bccJson || []).length;
  return list.join(', ') + (extra ? ` (+${extra})` : '');
}

// Relative "in N minutes/hours" — the thing you actually want to know about a
// queue item at a glance.
function untilLabel(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return '';
  if (ms < 0) return 'אמור להישלח כעת';
  const min = Math.round(ms / 60_000);
  if (min < 60) return `בעוד ${min} דק׳`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `בעוד ${hours} שע׳`;
  return `בעוד ${Math.round(hours / 24)} ימים`;
}

export default function ScheduledEmailsView({ dealId = null, contactId = null, compact = false, onChanged }) {
  const [scope, setScope] = useState('open');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [preview, setPreview] = useState(null); // full row incl. bodyHtml
  const [editing, setEditing] = useState(null); // full row incl. bodyHtml
  const [rescheduling, setRescheduling] = useState(null);
  const [confirmCancel, setConfirmCancel] = useState(null);

  const load = useCallback(async () => {
    try {
      setRows(await api.email.scheduledList({ scope, dealId, contactId }));
      setError(null);
    } catch (e) {
      setError(e?.payload?.error || e?.message || 'failed');
    }
  }, [scope, dealId, contactId]);

  useEffect(() => {
    load();
  }, [load]);

  // A pending queue is time-sensitive — refresh so an item that just went out
  // stops being offered for edit/cancel.
  useEffect(() => {
    if (scope !== 'open') return undefined;
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [scope, load]);

  async function openFull(row, target) {
    setBusy(row.id);
    try {
      const full = await api.email.scheduledOne(row.id);
      target(full);
    } catch (e) {
      setError('טעינת הפריט נכשלה: ' + (e?.payload?.error || e?.message));
    } finally {
      setBusy(null);
    }
  }

  async function cancel(row) {
    setBusy(row.id);
    try {
      await api.email.cancelScheduled(row.id);
      setConfirmCancel(null);
      await load();
      onChanged?.();
    } catch (e) {
      setError(
        e?.payload?.error === 'not_cancellable'
          ? 'לא ניתן לבטל — הפריט כבר נשלח או בוטל.'
          : 'הביטול נכשל: ' + (e?.payload?.error || e?.message),
      );
      setConfirmCancel(null);
    } finally {
      setBusy(null);
    }
  }

  async function reschedule(instant) {
    const row = rescheduling;
    setBusy(row.id);
    try {
      await api.email.rescheduleScheduled(row.id, instant.toISOString());
      setRescheduling(null);
      await load();
      onChanged?.();
    } catch (e) {
      setError(
        e?.payload?.error === 'schedule_too_soon'
          ? 'יש לבחור מועד לפחות דקה קדימה'
          : 'שינוי המועד נכשל: ' + (e?.payload?.error || e?.message),
      );
      setRescheduling(null);
    } finally {
      setBusy(null);
    }
  }

  // Edit reuses the SAME composer as everywhere else; saving PUTs to the same
  // record, so the item keeps its id, creator and audit trail.
  if (editing) {
    return (
      <div dir="rtl" className={compact ? '' : 'px-1 py-2'}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[15px] font-bold text-gray-900">עריכת מייל מתוזמן</h3>
          <span className="text-[12.5px] text-gray-500">מתוזמן ל־{fmt(editing.scheduledAt)}</span>
        </div>
        <EmailComposer
          defaultTo={(editing.toJson || []).map((r) => r.email).join(', ')}
          defaultCc={(editing.ccJson || []).map((r) => r.email).join(', ')}
          defaultBcc={(editing.bccJson || []).map((r) => r.email).join(', ')}
          defaultSubject={editing.subject || ''}
          initialBody={editing.bodyHtml || ''}
          dealId={editing.dealId}
          contactId={editing.contactId}
          editScheduled={{ id: editing.id, scheduledAt: editing.scheduledAt }}
          onScheduledUpdated={async () => {
            setEditing(null);
            await load();
            onChanged?.();
          }}
          onCancel={() => setEditing(null)}
        />
      </div>
    );
  }

  const list = rows || [];
  // Embedded in a Deal/Contact card: stay completely silent when this customer
  // has nothing pending — an empty state there is noise, not information.
  if (compact && scope === 'open' && rows !== null && list.length === 0 && !error) return null;

  return (
    <div dir="rtl" className={compact ? 'rounded-xl border border-blue-100 bg-blue-50/40 p-2' : 'px-1'}>
      {compact && (
        <p className="mb-1.5 px-1 text-[12px] font-semibold text-blue-900">🕐 מיילים שממתינים לשליחה</p>
      )}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {!compact && (
          <p className="text-[13px] text-gray-500">
            מיילים שממתינים לשליחה אוטומטית. אפשר לערוך, לשנות מועד או לבטל עד לרגע השליחה.
          </p>
        )}
        <div className={`flex items-center gap-1 rounded-lg bg-gray-100 p-0.5 ${compact ? 'text-[11px]' : ''}`}>
          {[
            { key: 'open', label: 'ממתינים' },
            { key: 'history', label: 'היסטוריה' },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setScope(t.key)}
              className={`rounded-md px-3 py-1 text-[12.5px] font-semibold transition ${
                scope === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>
      )}

      {rows === null ? (
        <p className="py-6 text-center text-[13px] text-gray-400">טוען…</p>
      ) : list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-center">
          <div className="mx-auto mb-2 text-2xl">🕐</div>
          <p className="text-[14px] font-semibold text-gray-800">
            {scope === 'open' ? 'אין מיילים שממתינים לשליחה' : 'אין היסטוריית תזמונים'}
          </p>
          {scope === 'open' && (
            <p className="mt-1 text-[12.5px] text-gray-500">
              אפשר לתזמן מייל מכל מסך כתיבה — בכפתור «תזמון שליחה».
            </p>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <table className="w-full text-right">
            <thead className="bg-gray-50 text-[12px] text-gray-500">
              <tr>
                <th className="px-3 py-2 font-semibold">מועד שליחה</th>
                <th className="px-3 py-2 font-semibold">אל</th>
                <th className="px-3 py-2 font-semibold">נושא</th>
                {!compact && <th className="px-3 py-2 font-semibold">נשלח מ־</th>}
                {!compact && <th className="px-3 py-2 font-semibold">נוצר על ידי</th>}
                <th className="px-3 py-2 font-semibold">סטטוס</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {list.map((row) => {
                const st = statusOf(row);
                // Only a genuinely unclaimed queue row may still be edited —
                // a row a worker is mid-send on is no longer the operator's.
                const editable = st.state === 'queued';
                return (
                  <tr key={row.id} className="text-[13px] hover:bg-gray-50/60">
                    <td className="px-3 py-2 align-top">
                      <div className="font-medium text-gray-900">{fmt(row.scheduledAt)}</div>
                      {st.state === 'queued' && (
                        <div className="text-[11.5px] text-gray-400">{untilLabel(row.scheduledAt)}</div>
                      )}
                      {st.state === 'sent' && (
                        <div className="text-[11.5px] text-emerald-600">נשלח ב־{fmt(row.sentAt)}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top" dir="auto">
                      <span className="line-clamp-2">{recipients(row)}</span>
                    </td>
                    <td className="px-3 py-2 align-top" dir="auto">
                      <span className="line-clamp-2 font-medium text-gray-800">{row.subject || '(ללא נושא)'}</span>
                      {row.attachments?.length > 0 && (
                        <span className="text-[11.5px] text-gray-400">📎 {row.attachments.length} קבצים</span>
                      )}
                    </td>
                    {!compact && (
                      <td className="px-3 py-2 align-top text-[12.5px] text-gray-500" dir="ltr">
                        {row.accountEmail || '—'}
                      </td>
                    )}
                    {!compact && (
                      <td className="px-3 py-2 align-top text-[12.5px] text-gray-500">{row.createdByName || '—'}</td>
                    )}
                    <td className="px-3 py-2 align-top">
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${st.cls}`}>
                        {st.label}
                      </span>
                      {row.failureReason && row.status !== 'sent' && (
                        <div className="mt-1 max-w-[16rem] text-[11.5px] text-amber-700">{row.failureReason}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="flex flex-wrap justify-end gap-1">
                        <button
                          type="button"
                          disabled={busy === row.id}
                          onClick={() => openFull(row, setPreview)}
                          className="rounded-md px-2 py-1 text-[12px] font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                        >
                          תצוגה
                        </button>
                        {editable && (
                          <>
                            <button
                              type="button"
                              disabled={busy === row.id}
                              onClick={() => openFull(row, setEditing)}
                              className="rounded-md px-2 py-1 text-[12px] font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                            >
                              עריכה
                            </button>
                            <button
                              type="button"
                              disabled={busy === row.id}
                              onClick={() => setRescheduling(row)}
                              className="rounded-md px-2 py-1 text-[12px] font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                            >
                              שינוי מועד
                            </button>
                            <button
                              type="button"
                              disabled={busy === row.id}
                              onClick={() => setConfirmCancel(row)}
                              className="rounded-md px-2 py-1 text-[12px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                            >
                              ביטול
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Preview — exactly what will be sent, through the canonical renderer. */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setPreview(null)}>
          <div
            className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-[16px] font-bold text-gray-900" dir="auto">{preview.subject || '(ללא נושא)'}</h3>
                <p className="mt-0.5 text-[12.5px] text-gray-500">
                  אל: <span dir="ltr">{(preview.toJson || []).map((r) => r.email).join(', ')}</span>
                </p>
                {(preview.ccJson || []).length > 0 && (
                  <p className="text-[12.5px] text-gray-500">
                    עותק: <span dir="ltr">{preview.ccJson.map((r) => r.email).join(', ')}</span>
                  </p>
                )}
                <p className="text-[12.5px] text-gray-500">
                  יישלח ב־{fmt(preview.scheduledAt)} מ־<span dir="ltr">{preview.accountEmail}</span>
                </p>
              </div>
              <button type="button" onClick={() => setPreview(null)} className="text-2xl leading-none text-gray-400 hover:text-gray-700">
                ×
              </button>
            </div>
            <div className="rounded-xl border border-gray-200 p-4">
              <RichText html={preview.bodyHtml || ''} />
            </div>
            {preview.attachments?.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {preview.attachments.map((a, i) => (
                  <span key={i} className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-[12px]" dir="ltr">
                    📎 {a.filename}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <ScheduleSendDialog
        open={!!rescheduling}
        busy={busy === rescheduling?.id}
        onCancel={() => setRescheduling(null)}
        onConfirm={reschedule}
      />

      <ConfirmDialog
        open={!!confirmCancel}
        title="ביטול מייל מתוזמן"
        body={`לבטל את המייל «${confirmCancel?.subject || ''}»?\nהוא לא יישלח. הפריט יישאר בהיסטוריה לתיעוד.`}
        confirmLabel="ביטול המייל"
        onCancel={() => setConfirmCancel(null)}
        onConfirm={() => cancel(confirmCancel)}
      />
    </div>
  );
}
