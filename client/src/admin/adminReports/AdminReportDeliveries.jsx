import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import Dialog from '../common/Dialog.jsx';
import Pager from '../common/Pager.jsx';

// Admin-report delivery log — every dispatch attempt with the FROZEN message
// text that was reported (or would have been, for skipped rows).

const STATUS = {
  pending: { label: 'ממתין', tone: 'bg-blue-50 text-blue-700 ring-blue-200' },
  sent: { label: 'נשלח', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  failed: { label: 'נכשל — ינוסה שוב', tone: 'bg-amber-50 text-amber-700 ring-amber-200' },
  failed_final: { label: 'נכשל סופית', tone: 'bg-red-50 text-red-700 ring-red-200' },
  skipped: { label: 'דולג', tone: 'bg-gray-100 text-gray-500 ring-gray-200' },
};
const PAGE_SIZE = 25;

export default function AdminReportDeliveries({ report, onClose }) {
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await api.adminReports.deliveries({
        page, pageSize: PAGE_SIZE, reportNumber: report?.number || undefined,
      }));
    } catch (err) {
      setError(err?.payload?.error || err.message);
    }
  }, [page, report?.number]);
  useEffect(() => { load(); }, [load]);

  const fmt = (iso) => (iso ? new Date(iso).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

  return (
    <Dialog open onClose={onClose} title={report ? `יומן שליחות — דיווח #${report.number}` : 'יומן שליחות — דיווחי מנהלים'} size="2xl">
      <div dir="rtl" className="p-1">
        {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">שגיאה: {error}</div>}
        {!data && !error && <div className="py-10 text-center text-[13px] text-gray-400">טוען…</div>}
        {data?.rows.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-300 px-4 py-12 text-center text-[13px] text-gray-400">
            אין עדיין שליחות. דיווח נוצר אוטומטית כשהאירוע העסקי מתרחש.
          </div>
        )}
        <div className="space-y-1.5">
          {data?.rows.map((row) => {
            const st = STATUS[row.status] || STATUS.pending;
            const open = openId === row.id;
            return (
              <div key={row.id} className="rounded-xl border border-gray-200 bg-white">
                <button type="button" onClick={() => setOpenId(open ? null : row.id)}
                  className="flex w-full flex-wrap items-center gap-2.5 px-3.5 py-2.5 text-right hover:bg-gray-50">
                  <span className="font-mono text-[12px] font-bold text-gray-500">#{row.reportNumber}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-gray-800">
                    {row.destinationLabel || row.skipReason || '—'}
                    {row.deal && <span className="text-gray-500"> · דיל {row.deal.orderNo}</span>}
                  </span>
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${st.tone}`}>{st.label}</span>
                  <span className="text-[11.5px] text-gray-400" dir="ltr">{fmt(row.sentAt || row.createdAt)}</span>
                </button>
                {open && (
                  <div className="space-y-2 border-t border-gray-100 px-4 py-3 text-[12.5px]">
                    {row.skipReason && <div className="text-amber-700">⚠ {row.skipReason}</div>}
                    {row.lastError && <div className="text-red-600">שגיאה: {row.lastError}</div>}
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-gray-600">
                      <span>נסיונות: {row.attemptCount}</span>
                      {row.providerMessageId && <span className="font-mono text-[11px]">ספק: {row.providerMessageId}</span>}
                      {row.deal && (
                        <Link to={`/admin/crm/deals/${row.deal.orderNo}`} onClick={onClose} className="font-medium text-blue-700 hover:underline">
                          פתח דיל #{row.deal.orderNo}
                        </Link>
                      )}
                    </div>
                    <div>
                      <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-gray-400">ההודעה כפי שדווחה (מוקפאת)</div>
                      <div className="whitespace-pre-wrap rounded-lg bg-gray-50 p-2.5 text-[12.5px] text-gray-800">{row.renderedText || '—'}</div>
                    </div>
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
