import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import WhatsAppLogo from '../common/WhatsAppLogo.jsx';

// WhatsApp connections admin ("תקשורת → חיבורי וואטסאפ") — Slice 1.
//
// One card per WhatsAppAccount (one bridge service per number). The card
// polls its account's live status through the GOS API → bridge proxy with
// the proven adaptive cadence: fast (2.5s) while pairing/disconnected so a
// rotating QR stays fresh, slow (15s) heartbeat while connected. Polling
// pauses when the browser tab is hidden.
//
// Recovery actions mirror the bridge:
//   restart  — rebuild the socket, KEEP the session (wedged socket).
//   hardReset— wipe the session + fresh QR (corrupt session). Destructive.
//   signOut  — unlink the device on WhatsApp's side + wipe. Destructive.

const STATUS_THEME = {
  connected: { label: 'מחובר', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  qr_required: { label: 'ממתין לסריקת QR', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  pairing: { label: 'מקשר מכשיר…', cls: 'bg-blue-50 text-blue-600 ring-blue-100' },
  connecting: { label: 'מתחבר…', cls: 'bg-blue-50 text-blue-600 ring-blue-100' },
  disconnected: { label: 'מנותק', cls: 'bg-red-50 text-red-700 ring-red-200' },
};

function fmtTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

function phoneFromJid(jid) {
  const digits = String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
  if (!digits) return null;
  return digits.startsWith('972') ? `0${digits.slice(3)}` : digits;
}

// Product-level wiring hints, keyed by the server's diagnose verdict. The
// exact env-var/service specifics stay inside the collapsed technical pane.
const DIAGNOSE_HINTS = {
  bridge_not_configured: 'החיבור של המספר הזה עדיין לא הוגדר בשרת המערכת.',
  bridge_unreachable: 'שירות החיבור של המספר הזה לא נגיש כרגע. בדקו שהשירות פעיל ושכתובת הרשת הפנימית נכונה.',
  wrong_service_code: 'השירות שמוגדר עבור המספר הזה לא מריץ את רכיב החיבור של וואטסאפ — ככל הנראה חסרות פקודות ההפעלה בהגדרות השירות.',
  account_id_mismatch: 'השירות שמוגדר עבור המספר הזה מזוהה כחשבון אחר — יש אי-התאמה בזיהוי החשבון.',
  secret_missing: 'סוד הגישה לשירות החיבור אינו מוגדר בשרת המערכת.',
  secret_mismatch: 'סוד הגישה בין שרת המערכת לשירות החיבור אינו תואם.',
  different_database: 'שירות החיבור פעיל אך שומר נתונים במסד נתונים אחר — יש לוודא שהוא מחובר לאותו מסד נתונים של המערכת.',
};

// Small colored dot for the account tabs — persisted status only (the live
// status is polled by the selected card; unselected accounts don't poll).
const TAB_DOT = {
  connected: 'bg-emerald-500',
  qr_required: 'bg-amber-500',
  pairing: 'bg-blue-500',
  connecting: 'bg-blue-500',
  disconnected: 'bg-red-500',
};

export default function WhatsAppConnectionsPage() {
  const [accounts, setAccounts] = useState(null);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  const load = useCallback(async () => {
    try {
      setAccounts(await api.whatsapp.accounts());
      setError(null);
    } catch (e) {
      setError(e?.payload?.error || e?.message || 'failed');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Exactly ONE account is manageable at a time: only the selected account's
  // card (and QR) exists in the DOM, so scanning the wrong account's QR is
  // impossible. Keep the selection valid across reloads.
  const selected =
    (accounts || []).find((a) => a.id === selectedId) || (accounts || [])[0] || null;

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-4xl mx-auto">
      <header className="mb-8">
        <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight text-gray-900">
          <WhatsAppLogo size={28} />
          WhatsApp
        </h1>
        <p className="text-[15px] text-gray-500 mt-1.5 leading-relaxed">
          חיבור מספרי ה-WhatsApp של העסק למערכת — קישור מכשיר בסריקת QR, מעקב
          אחרי מצב החיבור ופעולות ניהול.
        </p>
      </header>

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          שגיאה בטעינת החשבונות: <span dir="ltr" className="font-mono">{error}</span>
        </div>
      )}

      {accounts && accounts.length === 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
            <WhatsAppLogo size={30} />
          </div>
          <h2 className="text-[15px] font-semibold text-gray-900">עדיין אין חשבון WhatsApp מחובר</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-gray-500 leading-relaxed">
            כל מספר WhatsApp מתחבר למערכת בסריקת QR מהטלפון. לאחר החיבור תוכלו
            לראות כאן את מצב החיבור ולבצע פעולות ניהול.
          </p>
        </div>
      )}

      {/* Account switcher — a segmented control; each number is managed in
          its own tab so only one QR can ever be on screen. */}
      {accounts && accounts.length > 1 && (
        <div
          role="tablist"
          aria-label="חשבונות WhatsApp"
          className="mb-5 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-gray-100 p-1"
        >
          {accounts.map((a) => {
            const active = selected && a.id === selected.id;
            return (
              <button
                key={a.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSelectedId(a.id)}
                className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-[13px] font-semibold transition ${
                  active
                    ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${TAB_DOT[a.status] || TAB_DOT.disconnected}`} />
                {a.label}
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        // key= forces a full remount on tab switch: polling state, QR image
        // and diagnostics never leak between accounts.
        <AccountCard key={selected.id} account={selected} onChanged={load} />
      )}
    </div>
  );
}

function AccountCard({ account, onChanged }) {
  const [live, setLive] = useState(null); // last /status payload
  const [unreachable, setUnreachable] = useState(false);
  const [diagnosis, setDiagnosis] = useState(null); // server verdict when something is wrong
  const [busy, setBusy] = useState(null); // action key in flight
  const [confirm, setConfirm] = useState(null); // 'hardReset' | 'signOut'
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(account.label);
  const timerRef = useRef(null);
  const diagnoseBusyRef = useRef(false);

  const status = live?.status || account.status || 'disconnected';
  const ready = !!live?.readiness?.ok;
  const theme = STATUS_THEME[status] || STATUS_THEME.disconnected;
  // Something is wrong with the WIRING (as opposed to a normal QR wait):
  // the bridge never provisioned its account row, or the status proxy fails.
  const wiringProblem = !account.provisioned || unreachable;

  const runDiagnose = useCallback(async () => {
    if (diagnoseBusyRef.current) return;
    diagnoseBusyRef.current = true;
    try {
      const d = await api.whatsapp.diagnose(account.id);
      setDiagnosis(d);
      // Self-heal: the bridge came alive and provisioned its row since the
      // page loaded — refresh the accounts list so the card goes normal.
      if (d.verdict === 'ok' && !account.provisioned) await onChanged?.();
    } catch {
      /* diagnose itself failing = server unreachable; the page error covers it */
    } finally {
      diagnoseBusyRef.current = false;
    }
  }, [account.id, account.provisioned, onChanged]);

  useEffect(() => {
    if (wiringProblem) runDiagnose();
    else setDiagnosis(null);
  }, [wiringProblem, runDiagnose]);

  const poll = useCallback(async () => {
    if (!account.bridgeConfigured) return;
    try {
      const s = await api.whatsapp.accountStatus(account.id);
      setLive(s);
      setUnreachable(false);
    } catch {
      setUnreachable(true);
    }
  }, [account.id, account.bridgeConfigured]);

  // Adaptive polling: 2.5s while pairing/disconnected (QR rotates ~20s),
  // 15s heartbeat while connected+ready. Paused when the tab is hidden.
  // While a wiring problem is showing, re-diagnose on a slow cadence so the
  // card heals itself once the operator fixes the deployment.
  useEffect(() => {
    let cancelled = false;
    let ticks = 0;
    function schedule() {
      const fast = !(status === 'connected' && ready);
      timerRef.current = setTimeout(async () => {
        if (cancelled) return;
        if (!document.hidden) {
          await poll();
          ticks++;
          if (wiringProblem && ticks % 4 === 0) await runDiagnose();
        }
        if (!cancelled) schedule();
      }, fast ? 2500 : 15000);
    }
    poll();
    schedule();
    return () => {
      cancelled = true;
      clearTimeout(timerRef.current);
    };
  }, [poll, status, ready, wiringProblem, runDiagnose]);

  async function run(action, fn) {
    setBusy(action);
    setConfirm(null);
    try {
      await fn();
      await poll();
    } catch {
      /* surfaced by the unreachable banner / next poll */
      setUnreachable(true);
    } finally {
      setBusy(null);
    }
  }

  async function saveLabel() {
    const label = labelDraft.trim();
    setEditingLabel(false);
    if (!label || label === account.label) return;
    try {
      await api.whatsapp.updateAccount(account.id, { label });
      await onChanged?.();
    } catch {
      setLabelDraft(account.label);
    }
  }

  const phone = phoneFromJid(live?.phoneJid || account.phoneJid);
  const r = live?.readiness;

  return (
    <section className="bg-white border border-gray-200 rounded-2xl shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3 border-b border-gray-100">
        <div className="flex items-center gap-3 min-w-0">
          <WhatsAppLogo size={22} />
          {editingLabel ? (
            <input
              autoFocus
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              onBlur={saveLabel}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveLabel();
                else if (e.key === 'Escape') { setLabelDraft(account.label); setEditingLabel(false); }
              }}
              className="text-[15px] font-semibold text-gray-900 border-b-2 border-blue-400 focus:outline-none px-0.5"
            />
          ) : (
            <h2
              onClick={() => account.provisioned && setEditingLabel(true)}
              title={account.provisioned ? 'לחצו לשינוי השם' : undefined}
              className={`text-[15px] font-semibold text-gray-900 rounded px-1 -mx-1 truncate ${account.provisioned ? 'cursor-text hover:bg-gray-50' : ''}`}
            >
              {account.label}
            </h2>
          )}
        </div>
        <span className={`inline-flex items-center rounded-full px-3 py-1 text-[12px] font-semibold ring-1 ${theme.cls}`}>
          {theme.label}
        </span>
      </div>

      <div className="p-5 space-y-4">
        {!account.bridgeConfigured && (
          <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[13px] text-amber-800">
            החיבור של המספר הזה עדיין לא הופעל במערכת — מוצג המצב האחרון שנשמר בלבד.
          </p>
        )}
        {/* Wiring problem — the server's self-diagnosis pinpoints the cause;
            the friendly line is product-level, specifics stay collapsed. */}
        {account.bridgeConfigured && wiringProblem && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 space-y-1.5">
            <p className="text-[13px] text-amber-800">
              {(diagnosis && DIAGNOSE_HINTS[diagnosis.verdict]) ||
                'החיבור של המספר הזה עדיין לא דיווח למערכת — בודקים את החיבור…'}
            </p>
            {diagnosis && diagnosis.verdict !== 'ok' && (
              <details>
                <summary className="cursor-pointer text-[12px] text-amber-700/80 select-none">פרטים טכניים</summary>
                <p dir="ltr" className="mt-1.5 text-[11px] font-mono text-amber-800/80 overflow-x-auto">
                  verdict={diagnosis.verdict} url={diagnosis.url ?? '—'} health={diagnosis.health ?? '—'}{' '}
                  bridgeAccountId={diagnosis.bridgeAccountId ?? '—'} statusCheck={diagnosis.statusCheck ?? '—'}{' '}
                  dbRow={String(diagnosis.dbRowExists)} secretConfigured={String(diagnosis.secretConfigured)}
                </p>
              </details>
            )}
          </div>
        )}

        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <Row label="מספר מקושר" value={phone || '—'} ltr />
          <Row label="שם מכשיר" value={live?.deviceName || account.deviceName || '—'} />
          <Row label="חיבור אחרון" value={fmtTime(live?.lastConnectedAt || account.lastConnectedAt)} ltr />
          <Row label="ניתוק אחרון" value={fmtTime(live?.lastDisconnectAt || account.lastDisconnectAt)} ltr />
        </dl>

        {(live?.lastDisconnectReason || account.lastDisconnectReason) && status !== 'connected' && (
          <p className="text-[12px] text-gray-500">
            סיבת ניתוק: <span dir="ltr" className="font-mono">{live?.lastDisconnectReason || account.lastDisconnectReason}</span>
          </p>
        )}

        {/* QR pane — only while pairing is required. The bridge rotates the
            QR ~every 20s; the fast poll keeps the image fresh. */}
        {status === 'qr_required' && live?.qrDataUrl && (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 p-4">
            <p className="text-[13px] font-semibold text-gray-900">
              קוד QR עבור: {account.label}
            </p>
            <img src={live.qrDataUrl} alt={`WhatsApp QR — ${account.label}`} className="w-64 h-64 rounded-lg bg-white p-2 border border-gray-200" />
            <p className="text-[13px] text-gray-700 text-center leading-relaxed">
              בטלפון: וואטסאפ ← הגדרות ← מכשירים מקושרים ← קישור מכשיר
            </p>
            <p className="text-[11px] text-gray-400">הקוד מתחדש אוטומטית · הונפק {fmtTime(live?.lastQrAt)}</p>
          </div>
        )}

        {/* Technical diagnostics — collapsed by default so the card stays a
            product surface; support opens it only when something is wrong. */}
        {account.bridgeConfigured && !unreachable && r && !r.ok && status !== 'qr_required' && (
          <details className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
            <summary className="cursor-pointer text-[12px] text-gray-500 select-none">פרטים טכניים</summary>
            <p dir="ltr" className="mt-1.5 text-[11px] font-mono text-gray-500 overflow-x-auto">
              reason={r.reason} ws={r.wsState} lastUpdate={r.lastUpdate ?? '—'} reconnecting={String(r.reconnecting)}
            </p>
          </details>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            disabled={!account.bridgeConfigured || !!busy}
            onClick={() => run('restart', () => api.whatsapp.restartSocket(account.id))}
            className="rounded-lg border border-gray-300 text-gray-700 text-[13px] font-medium px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
          >
            {busy === 'restart' ? 'מפעיל מחדש…' : 'הפעל מחדש את החיבור'}
          </button>
          <button
            type="button"
            disabled={!account.bridgeConfigured || !!busy}
            onClick={() => setConfirm('hardReset')}
            className="rounded-lg border border-dashed border-red-300 text-red-600 text-[13px] font-medium px-3 py-1.5 hover:bg-red-50 disabled:opacity-50"
          >
            {busy === 'hardReset' ? 'מאתחל…' : 'אתחול מלא + QR חדש'}
          </button>
          <button
            type="button"
            disabled={!account.bridgeConfigured || !!busy}
            onClick={() => setConfirm('signOut')}
            className="rounded-lg border border-gray-300 text-gray-500 text-[13px] font-medium px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
          >
            {busy === 'signOut' ? 'מנתק…' : 'נתק מכשיר (Sign out)'}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirm === 'hardReset'}
        title="אתחול מלא של החיבור"
        body={'פעולה זו מוחקת את סשן הוואטסאפ השמור של המספר הזה ותידרש סריקת QR מחדש.\nהיסטוריית ההודעות במערכת לא נמחקת. להמשיך?'}
        confirmLabel="אתחל וצור QR חדש"
        danger
        onCancel={() => setConfirm(null)}
        onConfirm={() => run('hardReset', () => api.whatsapp.hardResetSession(account.id))}
      />
      <ConfirmDialog
        open={confirm === 'signOut'}
        title="ניתוק המכשיר"
        body={'הפעולה מנתקת את המספר הזה מהמערכת (Sign out) ומוחקת את הסשן השמור.\nכדי לחבר מחדש יהיה צורך באתחול מלא וסריקת QR. להמשיך?'}
        confirmLabel="נתק מכשיר"
        danger
        onCancel={() => setConfirm(null)}
        onConfirm={() => run('signOut', () => api.whatsapp.signOut(account.id))}
      />
    </section>
  );
}

function Row({ label, value, ltr }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-gray-900 truncate" dir={ltr ? 'ltr' : undefined}>{value}</dd>
    </div>
  );
}
