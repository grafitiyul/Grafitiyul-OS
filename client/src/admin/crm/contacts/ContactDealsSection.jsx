import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api.js';
import { formatMinor } from '../../../lib/money.js';
import {
  ACTIVITY_TYPE_LABELS,
  DEAL_STATUS_LABELS,
  DEAL_STATUS_STYLES,
  dealPath,
} from '../../deals/config.js';
import {
  EMPTY_STATE_TEXT,
  INITIAL_ROWS,
  dealRowTone,
  visibleDeals,
} from './contactDealsPanel.js';

function fmtDate(value) {
  if (!value) return null;
  try {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('he-IL');
  } catch {
    return null;
  }
}

// "דילים קודמים" — every deal linked to the contact through the canonical
// DealContact relation (server: dealsForContact — the SAME source the
// WhatsApp/Email resolution flows use; never name/phone matching). Each deal
// is a full clickable row → the deal page; status is a soft row background
// PLUS the canonical text badge. The header carries a compact second entry
// point into the SAME create-deal flow as the page's main button.
export default function ContactDealsSection({ contact, onCreateDeal }) {
  const [deals, setDeals] = useState(null); // null = loading
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let live = true;
    api.contacts
      .deals(contact.id)
      .then((rows) => { if (live) setDeals(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (live) setDeals([]); });
    return () => { live = false; };
  }, [contact.id]);

  const list = deals || [];
  const shown = visibleDeals(list, showAll);

  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-[14px] font-semibold text-gray-900">
          דילים קודמים{list.length > 0 ? ` (${list.length})` : ''}
        </h2>
        <button
          onClick={onCreateDeal}
          className="shrink-0 rounded-md bg-blue-600 px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-blue-700"
        >
          + פתיחת דיל חדש
        </button>
      </div>

      {deals === null ? (
        <div className="text-sm text-gray-400">טוען…</div>
      ) : list.length === 0 ? (
        <div className="text-sm text-gray-400">{EMPTY_STATE_TEXT}</div>
      ) : (
        <>
          <ul className="space-y-2">
            {shown.map((d) => (
              <DealRow key={d.id} deal={d} />
            ))}
          </ul>
          {list.length > INITIAL_ROWS && (
            <button
              onClick={() => setShowAll((s) => !s)}
              className="mt-2 text-[12px] font-medium text-blue-700 hover:underline"
            >
              {showAll ? 'הצג פחות' : `הצג הכל (${list.length})`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function DealRow({ deal: d }) {
  // product first; a product-less deal falls back to its activity type label.
  const productOrActivity =
    d.productName || (d.activityType ? ACTIVITY_TYPE_LABELS[d.activityType] : null);
  const date = fmtDate(d.tourDate || d.createdAt);
  const meta = [productOrActivity, d.organizationName, date].filter(Boolean).join(' · ');
  return (
    <li>
      <Link
        to={dealPath(d)}
        className={`block rounded-lg border px-3 py-2 transition-colors ${dealRowTone(d.status)}`}
      >
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[12px] text-gray-500 tabular-nums" dir="ltr">
            #{d.orderNo}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">
            {d.title}
          </span>
          <span
            className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              DEAL_STATUS_STYLES[d.status] || 'bg-gray-50 text-gray-600 ring-1 ring-inset ring-gray-200'
            }`}
          >
            {DEAL_STATUS_LABELS[d.status] || d.status}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-[12px] text-gray-600">{meta || '—'}</span>
          {d.valueMinor > 0 && (
            <span className="shrink-0 text-[12px] font-semibold text-gray-800 tabular-nums" dir="ltr">
              {formatMinor(d.valueMinor, d.currency)}
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}
