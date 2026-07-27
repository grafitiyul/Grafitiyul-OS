import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import SettingsChrome from '../settings/SettingsChrome.jsx';
import Dialog from '../common/Dialog.jsx';
import SearchSelect from '../communication/SearchSelect.jsx';
import AdminReportDeliveries from './AdminReportDeliveries.jsx';

// ─────────────────────────────────────────────────────────────────────────────
// "דיווחי מנהלים" — the catalog of CODE-MANAGED internal notifications.
//
// Deliberately NOT presented as editable templates: each card carries a
// prominent "מנוהל בקוד" banner and a copy-a-change-request action, because
// the message text lives in the codebase and changes through a development
// update. What IS editable here: whether the report is active and where it is
// delivered.
// ─────────────────────────────────────────────────────────────────────────────

const card = 'rounded-xl border border-gray-200 bg-white shadow-sm';

export default function AdminReportsPage() {
  const [data, setData] = useState(null);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(null); // {type:'test'|'log'|'copy'|'preview', report}
  const [copied, setCopied] = useState(null);

  const load = useCallback(async () => {
    try {
      const [r, m] = await Promise.all([api.adminReports.list(), api.communication.meta()]);
      setData(r);
      setMeta(m);
    } catch (err) {
      setError(err?.payload?.error || err.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function saveConfig(number, patch) {
    try {
      await api.adminReports.saveConfig(number, patch);
      await load();
    } catch (err) {
      const code = err?.payload?.error;
      alert(code === 'chat_wrong_account'
        ? 'הקבוצה שנבחרה שייכת לחשבון WhatsApp אחר — בחרו קבוצה של אותו חשבון.'
        : `שמירה נכשלה: ${code || err.message}`);
    }
  }

  function copyChangeRequest(report) {
    const prompt = [
      `שנה את דיווח מנהלים #${report.number}`,
      '',
      `מספר דיווח: #${report.number}`,
      `שם הדיווח: ${report.nameHe}`,
      `טריגר נוכחי: ${report.triggerHe}`,
      `נמענים נוכחיים: ${report.configured ? `${report.destinationName || report.waChatId} (חשבון ${report.waAccountId})` : 'לא הוגדר יעד'}`,
      `סטטוס: ${report.enabled ? 'פעיל' : 'מושבת'}`,
      '',
      'תצוגה מקדימה של ההודעה הנוכחית:',
      '---',
      report.preview || '',
      '---',
      '',
      'השינוי המבוקש:',
      '<כתבו כאן מה לשנות>',
    ].join('\n');
    navigator.clipboard?.writeText(prompt).then(
      () => { setCopied(report.number); setTimeout(() => setCopied(null), 2500); },
      () => alert('ההעתקה נכשלה — סמנו והעתיקו ידנית מהתצוגה המקדימה.'),
    );
  }

  if (error) {
    return (
      <div dir="rtl" className="px-8 py-10">
        <SettingsChrome />
        <div className="text-sm text-red-600">שגיאה: <span className="font-mono">{error}</span></div>
      </div>
    );
  }
  if (!data) return <div dir="rtl" className="px-8 py-10 text-sm text-gray-400">טוען…</div>;

  return (
    <div dir="rtl" className="mx-auto max-w-[1400px] px-5 pb-16 lg:px-8">
      <SettingsChrome />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 text-xl text-white shadow-sm">📣</div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold tracking-tight text-gray-900">דיווחי מנהלים</h1>
          <p className="mt-0.5 text-[13px] text-gray-500">
            התראות פנימיות אוטומטיות המנוהלות בקוד. לכל דיווח מספר קבוע — אפשר לבקש שינוי לפי המספר.
          </p>
        </div>
        <button type="button" onClick={() => setDialog({ type: 'log' })}
          className="rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-[13px] font-medium text-gray-700 hover:bg-gray-50">
          יומן שליחות
        </button>
      </div>

      {/* module-level code-managed banner */}
      <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <span className="text-[18px] leading-none">🔒</span>
        <div className="text-[13px] leading-relaxed text-amber-900">
          <div className="font-bold">הודעות אלו מנוהלות בקוד</div>
          נוסח ההודעה, הטריגר והשדות מוגדרים בקוד המערכת — הם אינם נערכים דרך מרכז התקשורת
          (נוסחים למייל + WhatsApp). לשינוי נוסח או תוכן נדרש עדכון פיתוח: השתמשו בכפתור
          «העתק בקשת שינוי לקלוד» שבכרטיס הדיווח. כאן ניתן להגדיר יעד שליחה ולהפעיל/להשבית.
        </div>
      </div>

      <div className="space-y-4">
        {data.reports.map((r) => (
          <div key={r.number} className={`${card} overflow-hidden`}>
            <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3">
              <span className="rounded-lg bg-gray-900 px-2.5 py-1 font-mono text-[14px] font-bold text-white">#{r.number}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[14.5px] font-bold text-gray-900">{r.nameHe}</div>
                <div className="text-[11.5px] text-gray-400">
                  {r.deliveryCount} שליחות
                  {r.lastSentAt && ` · נשלח לאחרונה ${new Date(r.lastSentAt).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`}
                  {r.lastFailedAt && ` · כשל אחרון ${new Date(r.lastFailedAt).toLocaleDateString('he-IL')}`}
                </div>
              </div>
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${
                !r.configured ? 'bg-gray-100 text-gray-500 ring-gray-200'
                  : r.enabled ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                    : 'bg-amber-50 text-amber-700 ring-amber-200'
              }`}>
                {!r.configured ? 'לא הוגדר יעד' : r.enabled ? 'פעיל' : 'מושבת'}
              </span>
              <label className="flex cursor-pointer items-center gap-1.5 text-[12.5px] text-gray-700">
                <input type="checkbox" checked={r.enabled} onChange={(e) => saveConfig(r.number, { enabled: e.target.checked })} className="h-4 w-4" />
                פעיל
              </label>
            </div>

            <div className="grid gap-4 p-4 lg:grid-cols-2">
              <div className="space-y-3">
                <Field label="מתי נשלח">{r.triggerHe}</Field>
                {r.dataHe && <Field label="מקור הנתונים">{r.dataHe}</Field>}

                <div>
                  <div className="mb-1 text-[12.5px] font-semibold text-gray-700">יעד השליחה (WhatsApp)</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <SearchSelect
                      value={r.waAccountId ? { id: r.waAccountId, label: meta?.waAccounts?.find((a) => a.id === r.waAccountId)?.label || r.waAccountId } : null}
                      onSelect={(item) => saveConfig(r.number, { waAccountId: item?.id || null, waChatId: null })}
                      search={async (q) => (meta?.waAccounts || [])
                        .filter((a) => !q || a.label.includes(q))
                        .map((a) => ({ id: a.id, label: a.label, icon: '📱', subtitle: a.status === 'connected' ? 'מחובר' : a.status }))}
                      placeholder="חשבון שולח…"
                    />
                    <SearchSelect
                      value={r.waChatId ? { id: r.waChatId, label: r.destinationName || 'קבוצה נבחרה' } : null}
                      onSelect={(item) => saveConfig(r.number, { waChatId: item?.id || null })}
                      search={async (q) => {
                        const rows = await api.communication.waGroups({ q, accountId: r.waAccountId || undefined });
                        return rows.map((g) => ({ id: g.id, label: g.subject, avatar: g.avatar, subtitle: g.accountLabel }));
                      }}
                      placeholder={r.waAccountId ? 'קבוצה פנימית…' : 'בחרו קודם חשבון'}
                      disabled={!r.waAccountId}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  <button type="button" onClick={() => copyChangeRequest(r)}
                    className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-[12.5px] font-semibold text-violet-700 hover:bg-violet-100">
                    {copied === r.number ? '✓ הועתק' : '📋 העתק בקשת שינוי לקלוד'}
                  </button>
                  <button type="button" onClick={() => setDialog({ type: 'test', report: r })}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[12.5px] font-medium text-gray-700 hover:bg-gray-50">
                    🧪 שליחת בדיקה
                  </button>
                  <button type="button" onClick={() => setDialog({ type: 'log', report: r })}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[12.5px] font-medium text-gray-700 hover:bg-gray-50">
                    יומן שליחות
                  </button>
                </div>
              </div>

              {/* preview — the SAME renderer production uses */}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[12.5px] font-semibold text-gray-700">תצוגה מקדימה (נתוני דוגמה)</span>
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">מנוהל בקוד</span>
                </div>
                <div className="rounded-xl bg-[#efe7dd] p-3"
                  style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(0,0,0,0.035) 1px, transparent 0)', backgroundSize: '14px 14px' }}>
                  <div className="mr-auto max-w-[95%] whitespace-pre-wrap break-words rounded-xl rounded-tr-sm bg-[#d9fdd3] px-3 py-2 text-[13px] leading-relaxed text-gray-900 shadow-sm">
                    {r.preview}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {dialog?.type === 'test' && (
        <TestSendDialog report={dialog.report} meta={meta} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'log' && (
        <AdminReportDeliveries report={dialog.report || null} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div className="text-[12.5px] font-semibold text-gray-700">{label}</div>
      <div className="mt-0.5 text-[12.5px] leading-relaxed text-gray-600">{children}</div>
    </div>
  );
}

function TestSendDialog({ report, meta, onClose }) {
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
