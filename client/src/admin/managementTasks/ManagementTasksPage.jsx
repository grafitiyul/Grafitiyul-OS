import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';

// משימות הנהלה — the operational review inbox.
//
// Cards about the same tour sit together because they describe one situation,
// but they are INDEPENDENT rows: the summary card and its logistics card each
// have their own "טופל" button, and handling one never touches the other.
//
// The logistics card is deliberately loud (red, on the leading side in RTL):
// it is the one that means somebody has to go and do something.

const TABS = [
  { key: 'open', labelHe: 'ממתין לטיפול' },
  { key: 'handled', labelHe: 'טופלו' },
];

export default function ManagementTasksPage() {
  const [status, setStatus] = useState('open');
  const [data, setData] = useState(null);
  const [kinds, setKinds] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const [inbox, k] = await Promise.all([
        api.managementTasks.list({ status }),
        api.managementTasks.kinds().catch(() => ({ kinds: [] })),
      ]);
      setData(inbox);
      setKinds(k.kinds || []);
      setError('');
    } catch (e) {
      setError(e.payload?.error || e.message);
    }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  const act = async (id, action) => {
    setBusy(id);
    try {
      await (action === 'handle' ? api.managementTasks.handle(id) : api.managementTasks.reopen(id));
      await load();
    } catch (e) {
      setError(e.payload?.error === 'already_handled_or_missing' ? 'הכרטיס כבר טופל' : (e.payload?.error || e.message));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="w-full px-5 py-6 lg:px-10 lg:py-8" dir="rtl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">משימות הנהלה</h1>
        <p className="mt-1 text-[14px] text-gray-500">מה מחכה לקריאה ולאישור?</p>
      </header>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setStatus(t.key)}
            className={`rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition ${
              status === t.key ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {t.labelHe}
            {status === t.key && data ? <span className="ms-1.5 opacity-70" dir="ltr">{data.total}</span> : null}
          </button>
        ))}
        {data?.counts ? (
          <div className="ms-auto flex flex-wrap gap-2 text-[12px] text-gray-500">
            {Object.entries(data.counts).map(([kind, n]) => (
              <span key={kind} className="rounded-full bg-gray-100 px-2.5 py-1">
                {kinds.find((k) => k.kind === kind)?.labelHe || kind}: <span dir="ltr">{n}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-[13px] text-red-700">{error}</div>
      ) : null}

      {!data ? (
        <div className="py-16 text-center text-[13px] text-gray-400">טוען…</div>
      ) : data.groups.length === 0 ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-6 py-12 text-center">
          <div className="mb-2 text-3xl">✅</div>
          <div className="text-[15px] font-semibold text-emerald-800">
            {status === 'open' ? 'אין משימות ממתינות' : 'עדיין לא טופלו משימות'}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {data.groups.map((group, i) => (
            <TourGroup
              key={group.tourEventId || i}
              group={group}
              status={status}
              busy={busy}
              onAct={act}
            />
          ))}
        </div>
      )}

      {kinds.length ? (
        <section className="mt-8 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-[14px] font-semibold text-gray-900">סוגי כרטיסים</h2>
          <ul className="mt-2 space-y-2">
            {kinds.map((k) => (
              <li key={k.kind} className="text-[12.5px]">
                <span className="font-medium text-gray-800">{k.labelHe}</span>
                <span className="text-gray-600"> — {k.descriptionHe}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** One tour's cards. Summary on the right (leading in RTL), logistics beside it. */
function TourGroup({ group, status, busy, onAct }) {
  const cards = [...group.cards].sort((a, b) => {
    // Summary first in reading order; the alert card sits next to it.
    if (a.kind === b.kind) return 0;
    return a.kind === 'tour_summary' ? -1 : 1;
  });
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {cards.map((card) => (
        <ReviewCard key={card.id} card={card} status={status} busy={busy} onAct={onAct} />
      ))}
    </div>
  );
}

function ReviewCard({ card, status, busy, onAct }) {
  const [open, setOpen] = useState(false);
  const alert = card.tone === 'alert';
  const d = card.data || {};

  return (
    <article className={`rounded-2xl border bg-white ${alert ? 'border-red-300 shadow-[0_0_0_1px_rgba(239,68,68,0.1)]' : 'border-gray-200'}`}>
      <div className={`flex flex-wrap items-start gap-2 rounded-t-2xl px-4 py-2.5 ${alert ? 'bg-red-50' : 'bg-gray-50'}`}>
        <span className={`text-[12px] font-semibold ${alert ? 'text-red-700' : 'text-gray-600'}`}>
          {alert ? '⚠ ' : ''}{card.kindLabelHe}
        </span>
        {card.link ? (
          <Link to={card.link} className="ms-auto text-[12px] text-blue-600 hover:underline">פתיחת הסיור ↗</Link>
        ) : null}
      </div>

      <div className="px-4 py-3">
        <h3 className="text-[14px] font-semibold text-gray-900">{card.title}</h3>

        {/* Frozen context — what the manager needs without opening anything. */}
        <dl className="mt-2 grid gap-x-4 gap-y-0.5 text-[12px] sm:grid-cols-2">
          <Row label="מדריך" value={d.guideName} />
          <Row label="לקוח" value={[d.customerName, d.orgName].filter(Boolean).join(' · ')} />
          <Row label="מועד" value={[d.tourDate, d.tourTime].filter(Boolean).join(' ')} />
          <Row label="מוצר" value={[d.productName, d.variantName].filter(Boolean).join(' · ')} />
        </dl>

        {card.summary ? (
          <p className={`mt-2 rounded-lg px-2.5 py-1.5 text-[12.5px] ${alert ? 'bg-red-50 text-red-800' : 'bg-gray-50 text-gray-700'}`}>
            {card.summary}
          </p>
        ) : null}

        {(d.details?.length || d.findings?.length) ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-2 text-[12px] text-blue-600 hover:underline"
          >
            {open ? 'הסתרת הפרטים' : 'הצגת הפרטים המלאים'}
          </button>
        ) : null}

        {open ? (
          <div className="mt-2 space-y-2 border-t border-gray-100 pt-2">
            {(d.details || []).map((x) => (
              <div key={x.role}>
                <div className="text-[11.5px] font-medium text-gray-500">{x.labelHe}</div>
                <div className="whitespace-pre-wrap text-[12.5px] text-gray-800">{String(x.value)}</div>
              </div>
            ))}
            {(d.findings || []).map((f) => (
              <div key={f.role} className="rounded-lg bg-red-50 px-2.5 py-1.5">
                <div className="text-[11.5px] font-medium text-red-700">{f.labelHe}</div>
                {typeof f.value === 'string' && f.value.trim() && !f.value.startsWith('o_') ? (
                  <div className="whitespace-pre-wrap text-[12.5px] text-red-900">{f.value}</div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-2 border-t border-gray-100 px-4 py-2.5">
        {status === 'open' ? (
          <button
            type="button"
            disabled={busy === card.id}
            onClick={() => onAct(card.id, 'handle')}
            className={`rounded-lg px-3.5 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-50 ${
              alert ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-900 hover:bg-gray-800'
            }`}
          >
            סמן כטופל
          </button>
        ) : (
          <>
            <span className="text-[11.5px] text-gray-500">
              טופל{card.handledByName ? ` ע״י ${card.handledByName}` : ''}
            </span>
            <button
              type="button"
              disabled={busy === card.id}
              onClick={() => onAct(card.id, 'reopen')}
              className="ms-auto rounded-lg border border-gray-300 px-3 py-1 text-[12px] text-gray-600 hover:bg-gray-50"
            >
              החזרה לטיפול
            </button>
          </>
        )}
        {/* Independence, stated on the card itself. */}
        {status === 'open' ? (
          <span className="text-[11px] text-gray-400">כרטיס זה מטופל בנפרד</span>
        ) : null}
      </div>
    </article>
  );
}

function Row({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <dt className="w-16 shrink-0 text-gray-500">{label}</dt>
      <dd className="flex-1 text-gray-800">{value}</dd>
    </div>
  );
}
