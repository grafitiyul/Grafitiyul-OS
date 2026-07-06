import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import EmailInbox from './EmailInbox.jsx';

// Email module page — the inbox is the working surface (landing view);
// Gmail account management lives one tab over, mirroring the WhatsApp page.
//
// Connect flow: "חיבור חשבון Gmail" → server mints the Google OAuth URL →
// full-page redirect → Google consent → callback lands back here with
// ?connected=<email> or ?connect_error=<reason>.

const SYNC_STATUS = {
  idle: { label: 'מסונכרן', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  syncing: { label: 'מסנכרן…', cls: 'bg-blue-50 text-blue-600 ring-blue-100' },
  error: { label: 'שגיאת סנכרון', cls: 'bg-red-50 text-red-700 ring-red-200' },
  disconnected: { label: 'מנותק', cls: 'bg-gray-100 text-gray-500 ring-gray-200' },
};

const CONNECT_ERRORS = {
  not_configured: 'האינטגרציה עדיין לא הוגדרה בשרת (משתני סביבה חסרים).',
  bad_state: 'אימות האבטחה של החיבור נכשל — נסו שוב.',
  missing_code: 'גוגל לא החזירה קוד הרשאה — נסו שוב.',
  exchange_failed: 'החלפת קוד ההרשאה מול גוגל נכשלה — נסו שוב.',
  no_email_claim: 'גוגל לא החזירה את כתובת המייל של החשבון.',
  access_denied: 'החיבור בוטל במסך ההרשאות של גוגל.',
};

function fmtTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

export default function EmailPage() {
  const [data, setData] = useState(null); // { configured, missing, accounts }
  const [error, setError] = useState(null);
  const [view, setView] = useState('inbox'); // 'inbox' | 'connections'
  const [busy, setBusy] = useState(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(null);
  const [notice, setNotice] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const load = useCallback(async () => {
    try {
      setData(await api.email.accounts());
      setError(null);
    } catch (e) {
      setError(e?.payload?.error || e?.message || 'failed');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // OAuth callback feedback (?connected= / ?connect_error=) — show once, clean the URL.
  useEffect(() => {
    const connected = searchParams.get('connected');
    const connectError = searchParams.get('connect_error');
    if (!connected && !connectError) return;
    if (connected) {
      setNotice({ kind: 'ok', text: `החשבון ${connected} חובר בהצלחה — הסנכרון הראשוני רץ ברקע.` });
      setView('connections');
    } else {
      setNotice({ kind: 'error', text: CONNECT_ERRORS[connectError] || `החיבור נכשל (${connectError}).` });
      setView('connections');
    }
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  async function connect() {
    setBusy('connect');
    try {
      const { url } = await api.email.connectStart();
      window.location.href = url; // full-page redirect to Google consent
    } catch (e) {
      setError(e?.payload?.error === 'email_not_configured'
        ? 'האינטגרציה עדיין לא הוגדרה בשרת — ראו ההנחיות למטה.'
        : e?.payload?.error || e?.message);
      setBusy(null);
    }
  }

  async function syncNow(account) {
    setBusy(account.id);
    try {
      await api.email.syncAccount(account.id);
      await load();
    } catch (e) {
      setError('הסנכרון נכשל: ' + (e?.payload?.detail || e?.payload?.error || e?.message));
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(account) {
    setBusy(account.id);
    try {
      await api.email.disconnectAccount(account.id);
      await load();
    } catch (e) {
      setError('הניתוק נכשל: ' + (e?.payload?.error || e?.message));
    } finally {
      setBusy(null);
      setConfirmDisconnect(null);
    }
  }

  const isInbox = view === 'inbox';
  const accounts = data?.accounts || [];
  const connectedAccounts = accounts.filter((a) => a.connected);

  return (
    <div className={isInbox ? 'px-3 pt-4 pb-3 lg:px-4' : 'px-5 py-8 lg:px-10 lg:py-10 max-w-6xl mx-auto'} dir="rtl">
      <header className={isInbox ? 'mb-3' : 'mb-8'}>
        <h1 className={`flex items-center gap-3 font-bold tracking-tight text-gray-900 ${isInbox ? 'text-xl' : 'text-2xl'}`}>
          <span aria-hidden>📧</span>
          אימייל
        </h1>
        {!isInbox && (
          <p className="text-[15px] text-gray-500 mt-1.5 leading-relaxed">
            כל המיילים העסקיים במקום אחד — מעבר מהיר מהשיחה לדיל הנכון, שיוך לאנשי קשר,
            ומעקב פתיחות. הסנכרון קורא בלבד: שום דבר לא נמחק, לא מסומן כנקרא ולא מועבר ב-Gmail.
          </p>
        )}
      </header>

      {notice && (
        <div
          className={`mb-3 flex items-center justify-between rounded-xl border px-4 py-2.5 text-sm ${
            notice.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-lg leading-none opacity-60 hover:opacity-100">×</button>
        </div>
      )}
      {error && (
        <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700" dir="auto">
          {error}
        </div>
      )}

      {/* View switch */}
      <div className={`flex items-center gap-1 border-b border-gray-200 ${isInbox ? 'mb-3' : 'mb-6'}`}>
        {[
          { key: 'inbox', label: 'תיבת מיילים' },
          { key: 'connections', label: 'חשבונות מחוברים' },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setView(t.key)}
            className={`-mb-px border-b-2 px-3.5 py-2 text-[13.5px] font-semibold transition ${
              view === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isInbox ? (
        connectedAccounts.length === 0 && data ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-6 py-14 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-3xl">📧</div>
            <p className="text-[15px] font-semibold text-gray-800">אין עדיין חשבון Gmail מחובר</p>
            <p className="mx-auto mt-1 max-w-md text-[13.5px] leading-relaxed text-gray-500">
              חברו את חשבון המייל העסקי כדי שכל התכתובת תופיע כאן ותתקשר אוטומטית לאנשי קשר ולדילים.
            </p>
            <button
              type="button"
              onClick={() => setView('connections')}
              className="mt-4 rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              לחיבור חשבון →
            </button>
          </div>
        ) : (
          <EmailInbox accounts={connectedAccounts} />
        )
      ) : (
        <div className="space-y-4">
          {/* Server configuration status */}
          {data && !data.configured && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
              <h2 className="text-[15px] font-bold text-amber-900">האינטגרציה עדיין לא מוגדרת בשרת</h2>
              <p className="mt-1 text-[13.5px] leading-relaxed text-amber-800">
                כדי לחבר Gmail יש להגדיר בשרת (Railway) את משתני הסביבה הבאים:
              </p>
              <ul className="mt-2 space-y-1 text-[13px] text-amber-800">
                {(data.missing || []).map((m) => (
                  <li key={m}>
                    <code dir="ltr" className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[12px]">{m}</code>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[12.5px] leading-relaxed text-amber-700">
                GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET — מתוך Google Cloud Console (OAuth client, Web application,
                עם Redirect URI: <code dir="ltr" className="font-mono text-[11.5px]">{'{origin}'}/api/email/connect/callback</code>).
                EMAIL_TOKEN_KEY — מחרוזת אקראית ארוכה (16+ תווים) להצפנת הטוקנים.
              </p>
            </div>
          )}

          {/* Accounts */}
          <div className="space-y-3">
            {accounts.map((a) => {
              const st = SYNC_STATUS[a.connected ? a.syncStatus : 'disconnected'] || SYNC_STATUS.idle;
              return (
                <div key={a.id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2">
                        <span className="text-[15px] font-bold text-gray-900" dir="ltr">{a.emailAddress}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${st.cls}`}>{st.label}</span>
                        {a.connected && !a.backfillDone && (
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-600 ring-1 ring-blue-100">
                            ייבוא ראשוני רץ…
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-[12.5px] text-gray-500">
                        {a.displayName && <span dir="auto">{a.displayName} · </span>}
                        סנכרון אחרון: {fmtTime(a.lastSyncAt)}
                      </p>
                      {a.syncError && (
                        <p className="mt-1 text-[12px] text-red-600" dir="ltr">{a.syncError}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {a.connected && (
                        <button
                          type="button"
                          disabled={busy === a.id}
                          onClick={() => syncNow(a)}
                          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                        >
                          {busy === a.id ? 'מסנכרן…' : 'סנכרון עכשיו'}
                        </button>
                      )}
                      {a.connected ? (
                        <button
                          type="button"
                          disabled={busy === a.id}
                          onClick={() => setConfirmDisconnect(a)}
                          className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          ניתוק
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busy === 'connect' || !data?.configured}
                          onClick={connect}
                          className="rounded-lg bg-blue-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          חיבור מחדש
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            disabled={busy === 'connect' || (data && !data.configured)}
            onClick={connect}
            className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy === 'connect' ? 'מעביר לגוגל…' : '+ חיבור חשבון Gmail'}
          </button>

          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-[12.5px] leading-relaxed text-gray-500">
            <p className="font-semibold text-gray-600">איך הסנכרון עובד?</p>
            <p className="mt-1">
              המערכת קוראת את המיילים מ-Gmail (30 הימים האחרונים בחיבור ראשון, ואז כל דקה) ושולחת מיילים דרך
              החשבון המחובר. היא <b>לא</b> מוחקת, לא מארכבת, לא מסמנת כנקרא ולא משנה שום דבר בתיבה עצמה —
              בטוח להשאיר את Make/Pipedrive מחוברים במקביל בתקופת המעבר.
            </p>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDisconnect}
        title="ניתוק חשבון Gmail"
        body={`לנתק את ${confirmDisconnect?.emailAddress || ''}?\nהסנכרון והשליחה ייפסקו. המיילים שכבר נקלטו יישארו במערכת, וחיבור מחדש ימשיך מאותה נקודה.`}
        confirmLabel="ניתוק"
        onCancel={() => setConfirmDisconnect(null)}
        onConfirm={() => disconnect(confirmDisconnect)}
      />
    </div>
  );
}
