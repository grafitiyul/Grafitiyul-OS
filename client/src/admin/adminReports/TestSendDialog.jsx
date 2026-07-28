import { useState } from 'react';
import { api } from '../../lib/api.js';
import Dialog from '../common/Dialog.jsx';
import SearchSelect from '../communication/SearchSelect.jsx';

// Test send for a code-managed notification. Shared by the Manager Reports
// screen and the Tour Settings notifications tab — one dialog, one behaviour:
// the message goes ONLY to the destination chosen here, is marked as a test,
// and is never recorded as a real delivery.

export default function TestSendDialog({ report, meta, onClose }) {
  const [account, setAccount] = useState(report.waAccountId ? { id: report.waAccountId, label: report.waAccountId } : null);
  const [chat, setChat] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  async function send() {
    setBusy(true); setResult(null);
    try {
      await api.adminReports.testSend(report.number, { testAccountId: account?.id, testChatId: chat?.id });
      setResult({ ok: true });
    } catch (err) {
      setResult({ ok: false, error: err?.payload?.detail || err?.payload?.error || err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={`שליחת בדיקה — דיווח #${report.number}`} size="md">
      <div dir="rtl" className="space-y-3 p-1">
        <div className="rounded-lg bg-blue-50 px-3 py-2 text-[12px] text-blue-800">
          הבדיקה נשלחת רק ליעד שתבחרו כאן, מסומנת כבדיקה, ואינה נרשמת כדיווח אמיתי.
          התוכן מיוצר על ידי אותו רנדרר של הייצור, עם נתוני דוגמה.
        </div>
        <div>
          <label className="text-[12.5px] font-semibold text-gray-700">חשבון שולח</label>
          <div className="mt-1">
            <SearchSelect value={account} onSelect={(v) => { setAccount(v); setChat(null); }}
              search={async (q) => (meta?.waAccounts || []).filter((a) => !q || a.label.includes(q))
                .map((a) => ({ id: a.id, label: a.label, icon: '📱', subtitle: a.status === 'connected' ? 'מחובר' : a.status }))}
              placeholder="בחרו חשבון…" />
          </div>
        </div>
        <div>
          <label className="text-[12.5px] font-semibold text-gray-700">קבוצת בדיקה</label>
          <div className="mt-1">
            <SearchSelect value={chat} onSelect={setChat}
              search={async (q) => {
                const rows = await api.communication.waGroups({ q, accountId: account?.id || undefined });
                return rows.map((g) => ({ id: g.id, label: g.subject, avatar: g.avatar, subtitle: g.accountLabel }));
              }}
              placeholder={account ? 'חיפוש קבוצה…' : 'בחרו קודם חשבון'} disabled={!account} />
          </div>
        </div>
        {result && (
          <div className={`rounded-lg px-3 py-2 text-[13px] ${result.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
            {result.ok ? '✓ נשלחה הודעת בדיקה' : `השליחה נכשלה: ${result.error}`}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-[13px] text-gray-700">סגור</button>
          <button type="button" onClick={send} disabled={busy || !account || !chat}
            className="rounded-lg bg-blue-600 px-5 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-40">
            {busy ? 'שולח…' : '🧪 שלח בדיקה'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
