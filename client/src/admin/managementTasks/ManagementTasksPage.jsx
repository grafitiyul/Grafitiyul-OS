import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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
  // Manager notifications and the daily digest deep-link to ?item=<reviewItemId>.
  // Without honouring it the link dumps the manager on the inbox to hunt for the
  // card they were just told about — the link may as well not exist.
  const [params, setParams] = useSearchParams();
  const focusId = params.get('item');
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

  // Scroll the linked card into view and flash it. If it has already been
  // handled it lives in the other tab, so switch there rather than showing
  // nothing — a manager following a link must always land on the card.
  useEffect(() => {
    if (!focusId || !data) return;
    const here = data.groups.some((g) => g.cards.some((c) => c.id === focusId));
    if (!here) {
      setStatus((cur) => (cur === 'open' ? 'handled' : cur));
      return;
    }
    const el = document.getElementById(`review-${focusId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusId, data]);

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

      {focusId ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-[12.5px] text-blue-800">
          <span>הגעתם מקישור להתראה — הכרטיס המסומן מודגש למטה.</span>
          <button
            type="button"
            onClick={() => setParams({}, { replace: true })}
            className="ms-auto rounded-lg border border-blue-300 bg-white px-2.5 py-1 text-[12px] font-medium text-blue-700 hover:bg-blue-100"
          >
            הצג את כל המשימות
          </button>
        </div>
      ) : null}

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
              focusId={focusId}
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

/**
 * One TOUR, rendered as the visual container for its tasks.
 *
 * The relationship the operator has to read instantly is: "this tour has N
 * independent management tasks". So the tour gets a real header — customer,
 * guide, product, when — and the cards sit INSIDE it. Previously they were two
 * loose cards in a grid and nothing said they belonged together.
 *
 * They stay completely independent: separate rows, separate handle buttons,
 * separate dedupeKeys. The container is presentation only.
 */
function TourGroup({ group, status, busy, focusId, onAct }) {
  const cards = [...group.cards].sort((a, b) => {
    // Summary leads (right in RTL); the alert card sits beside it.
    if (a.kind === b.kind) return 0;
    return a.kind === 'tour_summary' ? -1 : 1;
  });
  // Context is frozen identically on every card of a tour, so any card can
  // describe the tour.
  const d = cards[0]?.data || {};
  const when = [d.tourDate, d.tourTime].filter(Boolean).join(' ');
  const party = [d.customerName, d.orgName].filter(Boolean).join(' · ');
  const product = [d.productName, d.variantName].filter(Boolean).join(' · ');
  const hasAlert = cards.some((c) => c.tone === 'alert');
  // The SAME direct photo link the guide got in WhatsApp (server-resolved on
  // the summary card) — the office jumps straight to the tour's photos.
  const galleryUrl = cards.find((c) => c.galleryUrl)?.galleryUrl || null;

  return (
    <section
      className={`overflow-hidden rounded-2xl border bg-gray-50/70 ${
        hasAlert ? 'border-red-200' : 'border-gray-200'
      }`}
    >
      {/* Tour header — the container's identity */}
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-gray-200/80 bg-white/60 px-4 py-2.5">
        <h2 className="text-[14px] font-bold text-gray-900">{party || 'ללא לקוח'}</h2>
        {when ? <span className="text-[12.5px] font-medium text-gray-600">{when}</span> : null}
        {product ? <span className="text-[12px] text-gray-500">{product}</span> : null}
        {d.guideName ? <span className="text-[12px] text-gray-500">· {d.guideName}</span> : null}
        {galleryUrl ? (
          <a
            href={galleryUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[12px] font-medium text-blue-600 hover:underline"
          >
            📸 תמונות מהסיור ↗
          </a>
        ) : null}
        <span className="ms-auto text-[11.5px] text-gray-400">
          {cards.length === 1 ? 'משימה אחת' : `${cards.length} משימות נפרדות`}
        </span>
      </header>

      {/* The independent tasks */}
      <div className="grid gap-3 p-3 lg:grid-cols-2">
        {cards.map((card) => (
          <ReviewCard key={card.id} card={card} status={status} busy={busy} focused={card.id === focusId} onAct={onAct} />
        ))}
      </div>
    </section>
  );
}

function ReviewCard({ card, status, busy, focused, onAct }) {
  const [open, setOpen] = useState(false);
  const alert = card.tone === 'alert';
  const d = card.data || {};

  return (
    <article
      id={`review-${card.id}`}
      className={`rounded-2xl border bg-white transition ${
        focused ? 'border-blue-400 ring-2 ring-blue-300 ring-offset-2' : alert ? 'border-red-300 shadow-[0_0_0_1px_rgba(239,68,68,0.1)]' : 'border-gray-200'
      }`}
    >
      <div className={`flex flex-wrap items-center gap-2 rounded-t-2xl px-4 py-2.5 ${alert ? 'bg-red-50' : 'bg-blue-50/70'}`}>
        {/* Colour is the fastest signal: blue = read it, red = go do something. */}
        <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${alert ? 'bg-red-500' : 'bg-blue-500'}`} />
        <span className={`text-[13px] font-bold ${alert ? 'text-red-800' : 'text-blue-900'}`}>
          {card.kindLabelHe}
        </span>
        {card.link ? (
          <Link to={card.link} className="ms-auto text-[12px] text-blue-600 hover:underline">פתיחת הסיור ↗</Link>
        ) : null}
      </div>

      <div className="px-4 py-3">
        {/* The tour context lives on the group header — repeating it on every
            card was noise that buried the actual content. */}
        {card.summary ? (
          <p className={`rounded-lg px-2.5 py-1.5 text-[12.5px] ${alert ? 'bg-red-50 text-red-800' : 'bg-gray-50 text-gray-700'}`}>
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
