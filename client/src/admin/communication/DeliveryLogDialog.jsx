import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import Dialog from '../common/Dialog.jsx';
import Pager from '../common/Pager.jsx';
import useDebouncedValue from '../../shell/search/useDebouncedValue.js';
import { DELIVERY_STATUS_LABELS, DELIVERY_STATUS_TONES, ChannelBadge } from './commLabels.jsx';

// יומן שליחות — the delivery log: every scheduled/sent/failed delivery with
// its full explanation (intended vs effective time, wait reason, attempts,
// provider id, linked deal). Search by #number; waiting deliveries can be
// cancelled.

const PAGE_SIZE = 25;

export default function DeliveryLogDialog({ onClose, messageId = null }) {
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [numberInput, setNumberInput] = useState('');
  const number = useDebouncedValue(numberInput, 300);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const r = await api.communication.deliveries({
        page, pageSize: PAGE_SIZE,
        status: status || undefined,
        number: number || undefined,
        messageId: messageId || undefined,
      });
      setData(r);
    } catch (err) {
      setError(err?.payload?.error || err.message);
    }
  }, [page, status, number, messageId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [status, number]);

  const fmt = (iso) => (iso ? new Date(iso).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

  async function cancel(row) {
    try {
      await api.communication.cancelDelivery(row.id);
      load();
    } catch (err) {
      alert(err?.payload?.error === 'not_cancellable' ? 'המשלוח כבר אינו בהמתנה — לא ניתן לבטל.' : `ביטול נכשל: ${err.message}`);
    }
  }

  return (
    <Dialog open onClose={onClose} title="יומן שליחות" size="2xl">
      <div dir="rtl" className="p-1">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            type="text" value={numberInput} onChange={(e) => setNumberInput(e.target.value)}
            placeholder="חיפוש לפי מספר מסר (#24)…"
            className="w-52 rounded-lg border border-gray-200 px-3 py-2 text-[13px] focus:border-blue-400 focus:outline-none"
          />
          <select value={status} onChange={(e) => setStatus(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-[13px] focus:outline-none">
            <option value="">כל הסטטוסים</option>
            {Object.entries(DELIVERY_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>

        {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">שגיאה: {error}</div>}
        {!data && !error && <div className="py-10 text-center text-[13px] text-gray-400">טוען…</div>}
        {data?.rows.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-300 px-4 py-12 text-center text-[13px] text-gray-400">
            אין עדיין משלוחים. משלוחים נוצרים אוטומטית כשטריגר עסקי פוגש אירוע פעיל.
          </div>
        )}

        <div className="space-y-1.5">
          {data?.rows.map((row) => {
            const open = expandedId === row.id;
            const snap = row.recipientSnapshot || {};
            const cancellable = ['scheduled', 'waiting_window', 'waiting_dependency', 'failed'].includes(row.status);
            return (
              <div key={row.id} className="rounded-xl border border-gray-200 bg-white">
                <button type="button" onClick={() => setExpandedId(open ? null : row.id)}
                  className="flex w-full flex-wrap items-center gap-2.5 px-3.5 py-2.5 text-right hover:bg-gray-50">
                  <span className="font-mono text-[12px] font-bold text-gray-500">#{row.messageNumber}</span>
                  <ChannelBadge channel={row.channel} />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-gray-800">
                    <span className="font-medium">{row.event?.internalName}</span>
                    {row.message?.internalName && <span className="text-gray-500"> · {row.message.internalName}</span>}
                    {snap.name && <span className="text-gray-500"> · אל {snap.name}</span>}
                  </span>
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${DELIVERY_STATUS_TONES[row.status] || ''}`}>
                    {DELIVERY_STATUS_LABELS[row.status] || row.status}
                  </span>
                  <span className="text-[11.5px] text-gray-400" dir="ltr">{fmt(row.intendedAt)}</span>
                </button>
                {open && (
                  <div className="grid gap-x-6 gap-y-1 border-t border-gray-100 px-4 py-3 text-[12.5px] sm:grid-cols-2">
                    <D k="נמען" v={snap.name || snap.error || '—'} />
                    <D k={row.channel === 'whatsapp' ? 'טלפון / קבוצה' : 'אימייל'} v={row.channel === 'whatsapp' ? (snap.groupJid ? `קבוצה: ${snap.name}` : snap.phone) : snap.email} />
                    {row.channel === 'whatsapp' && <D k="חשבון שולח" v={snap.waAccountId} />}
                    <D k="שפה" v={row.language === 'en' ? 'English' : 'עברית'} />
                    <D k="מועד מיועד" v={fmt(row.intendedAt)} />
                    <D k="מועד בפועל" v={fmt(row.sentAt || row.effectiveAt)} />
                    {row.waitReason && <D k="סיבת המתנה" v={row.waitReason} full />}
                    {row.skipReason && <D k="סיבת דילוג" v={row.skipReason} full />}
                    {row.lastError && <D k="שגיאה אחרונה" v={row.lastError} full />}
                    <D k="נסיונות" v={String(row.attemptCount)} />
                    {row.providerMessageId && <D k="מזהה ספק" v={row.providerMessageId} mono />}
                    {row.deal && (
                      <div className="flex gap-2 py-0.5">
                        <span className="text-gray-500">דיל</span>
                        <Link to={`/admin/crm/deals/${row.deal.orderNo}`} className="font-medium text-blue-700 hover:underline" onClick={onClose}>
                          #{row.deal.orderNo} · {row.deal.title}
                        </Link>
                      </div>
                    )}
                    {cancellable && (
                      <div className="pt-1 sm:col-span-2">
                        <button type="button" onClick={() => cancel(row)}
                          className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[12px] font-medium text-red-700 hover:bg-red-100">
                          בטל משלוח
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {data && data.total > PAGE_SIZE && (
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        )}
      </div>
    </Dialog>
  );
}

function D({ k, v, full, mono }) {
  return (
    <div className={`flex gap-2 py-0.5 ${full ? 'sm:col-span-2' : ''}`}>
      <span className="shrink-0 text-gray-500">{k}</span>
      <span className={`min-w-0 break-words font-medium text-gray-900 ${mono ? 'font-mono text-[11px]' : ''}`} dir="auto">{v || '—'}</span>
    </div>
  );
}
