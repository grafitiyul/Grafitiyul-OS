import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api.js';
import GenerateQuoteModal from './GenerateQuoteModal.jsx';

// The Deal's Quote card body (right panel). Two states:
//   • No generated quote yet → the "הפק הצעת מחיר" entry (opens the generation
//     modal) + a small link to the content editor.
//   • Generated → a management card for the PRIMARY offer's latest version:
//     status, generated date, language, the permanent public URL + copy.
// Every generated quote is an immutable snapshot; the URL never changes and
// never re-points. History / parallel offers / primary switching come next
// (Slices 2B/2C) — the data shape (offers[]) already carries them.

const STATUS_LABELS = {
  produced: { text: 'הופקה', cls: 'bg-blue-50 text-blue-700 ring-blue-200' },
  accepted: { text: 'נחתמה', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  rejected: { text: 'נדחתה', cls: 'bg-red-50 text-red-600 ring-red-200' },
  expired: { text: 'פג תוקף', cls: 'bg-gray-100 text-gray-500 ring-gray-200' },
};

function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function DealQuoteCard({ deal }) {
  const [offers, setOffers] = useState(null); // null = loading
  const [modalOpen, setModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.deals.quoteDocuments(deal.id);
      setOffers(r.offers || []);
    } catch {
      setOffers([]);
    }
  }, [deal.id]);

  useEffect(() => { load(); }, [load]);

  // The card fronts the PRIMARY offer's newest version.
  const latest = useMemo(() => {
    const list = offers || [];
    const primary = list.find((o) => o.isPrimary) || list[0] || null;
    return primary?.documents?.[0] || null;
  }, [offers]);

  const url = latest ? `${window.location.origin}/quote/${latest.publicToken}` : null;
  const status = latest ? (latest.signedAt ? STATUS_LABELS.accepted : STATUS_LABELS[latest.status] || STATUS_LABELS.produced) : null;

  async function copyUrl() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* URL stays selectable in the field */ }
  }

  return (
    <div>
      {!latest ? (
        <>
          <p className="mb-3 text-[12px] text-gray-500">הפקת מסמך הצעת מחיר ללקוח — תצוגה מקדימה, הפקה ושליחה.</p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              📄 הפק הצעת מחיר
            </button>
            <Link to={`/admin/quote/${deal.id}`} className="text-[12px] text-blue-700 hover:underline">
              עריכת תוכן ↗
            </Link>
          </div>
        </>
      ) : (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${status.cls}`}>
              {status.text}
            </span>
            <span className="text-[12px] text-gray-500">גרסה {latest.versionNo ?? 1}</span>
            <span className="text-[12px] text-gray-400">·</span>
            <span className="text-[12px] text-gray-500">הופקה {fmtDate(latest.producedAt)}</span>
            <span className="text-[12px] text-gray-400">·</span>
            <span className="text-[12px] text-gray-500">{latest.language === 'en' ? 'English' : 'עברית'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              readOnly
              dir="ltr"
              value={url}
              onFocus={(e) => e.target.select()}
              className="w-full min-w-0 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-[12px] text-gray-600 focus:outline-none"
            />
            <button
              type="button"
              onClick={copyUrl}
              title="העתק קישור"
              className="shrink-0 rounded-lg border border-gray-300 px-2.5 py-1.5 text-[12px] text-gray-700 hover:bg-gray-50"
            >
              {copied ? '✓' : '⧉ העתק'}
            </button>
          </div>
          <div className="flex items-center gap-3 pt-0.5">
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50"
            >
              הפק גרסה חדשה
            </button>
            <a href={url} target="_blank" rel="noopener noreferrer" className="text-[12px] text-blue-700 hover:underline">
              צפייה ↗
            </a>
            <Link to={`/admin/quote/${deal.id}`} className="text-[12px] text-blue-700 hover:underline">
              עריכת תוכן ↗
            </Link>
          </div>
        </div>
      )}

      {modalOpen && (
        <GenerateQuoteModal
          open
          onClose={() => setModalOpen(false)}
          deal={deal}
          onGenerated={() => load()}
        />
      )}
    </div>
  );
}
