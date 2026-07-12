import { useCallback, useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { formatMinor } from '../lib/money.js';

// שכר — the guide's payroll view. Server truth only (viewPay-gated,
// office-approved entries): the guide sees ONLY components that actually
// affect them (zero rows are hidden server-side), approves each entry, or
// opens an inquiry ("יש הערה? לחץ כאן") which moves the entry to בבירור.
// Guide totals count entries approved by BOTH office and guide; everything
// else office-approved shows as ממתין לאישורך.

const STATUS_META = {
  pending: { label: 'ממתין לאישורך', cls: 'bg-blue-50 text-blue-700' },
  approved: { label: 'אושר ✓', cls: 'bg-emerald-50 text-emerald-700' },
  inquiry: { label: 'בבירור', cls: 'bg-orange-50 text-orange-700' },
};

function monthLabel(m) {
  const [y, mm] = String(m).split('-');
  const names = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  return `${names[Number(mm) - 1] || mm} ${y}`;
}

function EntryCard({ token, entry, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [commenting, setCommenting] = useState(false);
  const [text, setText] = useState('');
  const meta = STATUS_META[entry.guideStatus];

  const post = async (path, body) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/portal/${encodeURIComponent(token)}/pay/entries/${entry.id}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await onChanged();
    } finally {
      setBusy(false);
      setCommenting(false);
      setText('');
    }
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-semibold text-gray-900 truncate">{entry.activityTitle}</div>
          <div className="text-[12px] text-gray-500">
            {entry.date ? entry.date.split('-').reverse().join('/') : monthLabel(entry.payrollMonth)}
            {entry.sourceType === 'tour_event' ? ' · סיור' : ' · פעילות'}
          </div>
        </div>
        {meta && (
          <span className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium ${meta.cls}`}>{meta.label}</span>
        )}
      </div>

      <div className="mt-3 space-y-1">
        {entry.lines.map((l, i) => (
          <div key={i} className="flex items-center justify-between text-[13px]">
            <span className="text-gray-600">{l.name}</span>
            <span className={`tabular-nums ${l.sign < 0 ? 'text-red-600' : 'text-gray-800'}`}>
              {l.sign < 0 ? '−' : ''}{formatMinor(l.amountMinor)}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-3 pt-2 border-t border-gray-100 space-y-0.5">
        {entry.vatStatus === 'vat_18' ? (
          <>
            <div className="flex items-center justify-between text-[12px] text-gray-500">
              <span>לפני מע״מ</span>
              <span className="tabular-nums">{formatMinor(entry.totals.netMinor)}</span>
            </div>
            <div className="flex items-center justify-between text-[12px] text-gray-500">
              <span>מע״מ ({entry.vatRate}%)</span>
              <span className="tabular-nums">{formatMinor(entry.totals.vatMinor)}</span>
            </div>
            <div className="flex items-center justify-between text-[14px] font-semibold text-gray-900">
              <span>סה״כ</span>
              <span className="tabular-nums">{formatMinor(entry.totals.totalMinor)}</span>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between text-[14px] font-semibold text-gray-900">
            <span>סה״כ לתשלום</span>
            <span className="tabular-nums">{formatMinor(entry.totals.totalMinor)}</span>
          </div>
        )}
      </div>

      {entry.guideStatus !== 'approved' && (
        <div className="mt-3 flex flex-col gap-2">
          {!commenting ? (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => post('approve')}
                className="flex-1 h-10 rounded-xl bg-emerald-600 text-white text-[14px] font-medium hover:bg-emerald-700 disabled:opacity-50"
              >
                אשר ✓
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setCommenting(true)}
                className="flex-1 h-10 rounded-xl border border-gray-300 text-gray-700 text-[13px] hover:bg-gray-50"
              >
                יש הערה? לחץ כאן
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <textarea
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                placeholder="מה לא מסתדר? המשרד יקבל את ההערה והרשומה תעבור לבירור."
                className="w-full rounded-xl border border-gray-300 p-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy || !text.trim()}
                  onClick={() => post('comment', { text: text.trim() })}
                  className="flex-1 h-9 rounded-xl bg-orange-500 text-white text-[13px] font-medium hover:bg-orange-600 disabled:opacity-50"
                >
                  שלח הערה
                </button>
                <button
                  type="button"
                  onClick={() => { setCommenting(false); setText(''); }}
                  className="h-9 px-4 rounded-xl border border-gray-300 text-gray-600 text-[13px]"
                >
                  ביטול
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function PayPage() {
  const { token } = useOutletContext();
  const [month, setMonth] = useState(null); // null → server default (current month)
  const [state, setState] = useState({ phase: 'loading', data: null });

  const load = useCallback(async () => {
    try {
      const q = month ? `?month=${encodeURIComponent(month)}` : '';
      const res = await fetch(`/api/portal/${encodeURIComponent(token)}/pay${q}`, { cache: 'no-store' });
      if (res.status === 403) return setState({ phase: 'forbidden', data: null });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState({ phase: 'ready', data: await res.json() });
    } catch (e) {
      setState({ phase: 'error', data: null, message: e?.message });
    }
  }, [token, month]);

  useEffect(() => {
    load();
  }, [load]);

  if (state.phase === 'loading' && !state.data) {
    return <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">טוען…</div>;
  }
  if (state.phase === 'forbidden') {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
        צפייה בנתוני שכר אינה זמינה.
      </div>
    );
  }
  if (state.phase === 'error') {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
        <div className="mb-2 text-sm text-gray-600">שגיאה בטעינת נתוני השכר</div>
        <button type="button" onClick={load} className="text-[13px] text-blue-600 hover:underline">נסה שוב</button>
      </div>
    );
  }

  const data = state.data;
  const months = data.months.includes(data.month) ? data.months : [data.month, ...data.months];

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 px-1">
        <h1 className="flex-1 text-[17px] font-bold text-gray-900">שכר</h1>
        <select
          value={data.month}
          onChange={(e) => setMonth(e.target.value)}
          className="h-9 rounded-xl border border-gray-300 bg-white px-2 text-[13px]"
        >
          {months.map((m) => (
            <option key={m} value={m}>{monthLabel(m)}</option>
          ))}
        </select>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2">
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3 text-center">
          <div className="text-[11px] text-emerald-700">אושר על ידך</div>
          <div className="text-[17px] font-bold text-emerald-800 tabular-nums">{formatMinor(data.totals.approvedMinor)}</div>
        </div>
        <div className="rounded-2xl border border-blue-100 bg-blue-50 p-3 text-center">
          <div className="text-[11px] text-blue-700">ממתין לאישורך</div>
          <div className="text-[17px] font-bold text-blue-800 tabular-nums">{formatMinor(data.totals.waitingMinor)}</div>
        </div>
      </div>

      {data.entries.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
          <div className="mb-3 text-4xl opacity-50">🧾</div>
          <div className="mb-1 text-base font-semibold text-gray-800">אין רשומות שכר לחודש זה</div>
          <div className="text-sm text-gray-500">רשומות מופיעות כאן אחרי אישור המשרד.</div>
        </div>
      ) : (
        <div className="space-y-3">
          {data.entries.map((e) => (
            <EntryCard key={e.id} token={token} entry={e} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}
