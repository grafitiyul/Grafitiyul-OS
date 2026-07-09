import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import QuoteDocumentRenderer from '../../quote/QuoteBlockRenderer.jsx';

// ADMIN-only viewer for a generated QuoteDocument's frozen snapshot — exactly
// what the customer received, forever. Used by the quote-history popup: the
// PUBLIC URL of a superseded version deliberately shows the "newer proposal"
// replacement screen, so admins need this internal window into old versions.
export default function QuoteSnapshotView() {
  const { docId } = useParams();
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    api.quoteDocuments.get(docId)
      .then((r) => { if (alive) setDoc(r.quoteDocument); })
      .catch(() => { if (alive) setError('not_found'); });
    return () => { alive = false; };
  }, [docId]);

  if (error) return <div className="p-16 text-center text-gray-400" dir="rtl">ההצעה לא נמצאה.</div>;
  if (!doc) return <div className="p-16 text-center text-gray-400" dir="rtl">טוען…</div>;
  if (!doc.renderModelSnapshot) {
    return <div className="p-16 text-center text-gray-400" dir="rtl">למסמך זה אין צילום קפוא (טיוטה או מסמך ישן).</div>;
  }

  return (
    <div className="min-h-screen bg-gray-100" dir="rtl">
      <div className="sticky top-0 z-20 border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-[12.5px] text-amber-800">
        תצוגת ארכיון פנימית — גרסה {doc.versionNo ?? ''} ({doc.language === 'en' ? 'English' : 'עברית'}) · צילום קפוא של מה שהלקוח קיבל. לקוחות אינם רואים מסך זה.
      </div>
      <div className="mx-auto w-full max-w-[1280px] px-3 py-6">
        <div className="overflow-hidden rounded-2xl shadow-sm ring-1 ring-gray-200/70">
          <QuoteDocumentRenderer model={doc.renderModelSnapshot} />
        </div>
      </div>
    </div>
  );
}
