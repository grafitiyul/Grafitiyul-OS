import Dialog from '../../common/Dialog.jsx';
import { quoteStatusOf, fmtQuoteDate } from './DealQuoteCard.jsx';

// "היסטוריית הצעות" — ADMIN-only popup (customers never see this screen).
// Every generated version, chronological (newest first), grouped by offer when
// parallel offers exist. Each row: version / status / date / language + the
// server-computed diff vs the previous version of the same offer ("שונה:
// מחיר, שאלות נפוצות…"). Every historical proposal opens at its permanent URL —
// generated documents are immutable snapshots forever, so old links are always
// safe to open.

function VersionRow({ doc }) {
  const status = quoteStatusOf(doc);
  // The ADMIN archive view — a superseded version's public URL shows the
  // customer replacement screen, so history opens the internal snapshot viewer.
  const url = `/admin/quote-view/${doc.id}`;
  const changes = Array.isArray(doc.changes) ? doc.changes : null;
  return (
    <li className="rounded-xl border border-gray-200 bg-white px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold text-gray-800">גרסה {doc.versionNo ?? 1}</span>
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1 ${status.cls}`}>
          {status.text}
        </span>
        <span className="text-[12px] text-gray-500">{fmtQuoteDate(doc.producedAt)}</span>
        <span className="text-[12px] text-gray-400">·</span>
        <span className="text-[12px] text-gray-500">{doc.language === 'en' ? 'English' : 'עברית'}</span>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="ms-auto shrink-0 text-[12px] font-medium text-blue-700 hover:underline"
        >
          פתח ↗
        </a>
      </div>
      {changes && changes.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span className="text-[11px] text-gray-400">שונה:</span>
          {changes.map((c) => (
            <span key={c} className="rounded-full bg-gray-100 px-2 py-0.5 text-[10.5px] text-gray-600">{c}</span>
          ))}
        </div>
      )}
      {changes && changes.length === 0 && (
        <div className="mt-1.5 text-[11px] text-gray-400">ללא שינויי תוכן מהגרסה הקודמת</div>
      )}
    </li>
  );
}

export default function QuoteHistoryDialog({ open, onClose, offers }) {
  const withDocs = (offers || []).filter((o) => o.documents.length > 0);
  const multi = withDocs.length > 1;
  return (
    <Dialog open={open} onClose={onClose} title="היסטוריית הצעות" size="md-wide">
      <div dir="rtl" className="space-y-4">
        {withDocs.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-10 text-center text-sm text-gray-400">
            עדיין לא הופקו הצעות.
          </div>
        )}
        {withDocs.map((offer) => (
          <div key={offer.id}>
            {multi && (
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-[12px] font-semibold text-gray-600">הצעה {offer.offerNo}</span>
                {offer.isPrimary && !offer.archivedAt && (
                  <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[9.5px] font-bold text-amber-700 ring-1 ring-amber-200">ראשית</span>
                )}
                {offer.archivedAt && (
                  <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[9.5px] font-bold text-gray-500 ring-1 ring-gray-200">בארכיון</span>
                )}
              </div>
            )}
            <ul className="space-y-2">
              {offer.documents.map((doc) => (
                <VersionRow key={doc.id} doc={doc} />
              ))}
            </ul>
          </div>
        ))}
        <p className="text-[11px] leading-relaxed text-gray-400">
          כל גרסה שהופקה היא צילום קפוא לתמיד — פתיחת גרסה ישנה כאן מציגה בדיוק את מה שהלקוח קיבל.
          גרסאות חדשות של אותה הצעה מחליפות ישנות עבור הלקוח; הצעות מקבילות אינן מחליפות זו את זו.
        </p>
      </div>
    </Dialog>
  );
}
