import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import RichText from '../../editor/RichText.jsx';

// Internal archive view of a SENT confirmation email — the frozen snapshot
// (ConfirmationEmailSend), exactly what was handed to the queue. The
// QuoteSnapshotView convention: amber banner, read-only, customers never see
// this screen. Template edits after the send can never change what is shown.

const STATUS_HE = {
  pending: 'בתור השליחה',
  sending: 'נשלח כעת…',
  sent: 'נשלח',
  failed: 'נכשל',
  cancelled: 'בוטל',
};

export default function ConfirmationSnapshotView() {
  const { sendId } = useParams();
  const [snap, setSnap] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let on = true;
    api.confirmationEmail
      .getSend(sendId)
      .then((s) => on && setSnap(s))
      .catch((e) => on && setError(e.payload?.error || e.message));
    return () => {
      on = false;
    };
  }, [sendId]);

  if (error) {
    return (
      <div className="p-10 text-center text-sm text-red-600" dir="rtl">
        שגיאה בטעינת המייל: <span dir="ltr" className="font-mono">{error}</span>
      </div>
    );
  }
  if (!snap) return <div className="p-10 text-center text-sm text-gray-400" dir="rtl">טוען…</div>;

  const en = snap.language === 'en';
  const d = snap.delivery;
  return (
    <div className="min-h-screen bg-gray-100 pb-16" dir="rtl">
      <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-center text-[13px] text-amber-800">
        תצוגת ארכיון פנימית — צילום קפוא של מייל האישור כפי שנשלח ללקוח. לקוחות אינם רואים מסך זה.
      </div>
      <div className="mx-auto max-w-3xl px-4 pt-8">
        <div className="mb-4 rounded-xl border border-gray-200 bg-white px-5 py-4 text-[13px] text-gray-700 space-y-1">
          <div>
            <span className="text-gray-400">נמען:</span>{' '}
            <span className="font-medium">{snap.recipientSnapshot?.name || ''}</span>{' '}
            <span dir="ltr" className="font-mono text-[12px]">{snap.recipientSnapshot?.email}</span>
          </div>
          <div>
            <span className="text-gray-400">נושא:</span> <span className="font-medium">{snap.subject}</span>
            {' · '}
            <span className="text-gray-400">שפה:</span> {en ? 'English' : 'עברית'}
            {' · '}
            <span className="text-gray-400">תבנית:</span> {snap.templateName}
          </div>
          <div>
            <span className="text-gray-400">נשלח:</span>{' '}
            {new Date(snap.createdAt).toLocaleString('he-IL')}
            {d && (
              <>
                {' · '}
                <span className="text-gray-400">סטטוס:</span>{' '}
                <span className={d.status === 'sent' ? 'text-emerald-700 font-medium' : d.status === 'failed' ? 'text-red-600 font-medium' : 'text-gray-700'}>
                  {STATUS_HE[d.status] || d.status}
                </span>
                {d.sentAt && ` (${new Date(d.sentAt).toLocaleString('he-IL')})`}
                {d.status !== 'sent' && (d.failureReason || d.waitReason) && (
                  <span className="text-gray-500"> — {d.failureReason || d.waitReason}</span>
                )}
              </>
            )}
          </div>
          {(snap.fillersSnapshot || []).length > 0 && (
            <div>
              <span className="text-gray-400">פילרים:</span>{' '}
              {snap.fillersSnapshot.map((f) => f.kind).join(', ')}
            </div>
          )}
        </div>
        <article dir={en ? 'ltr' : 'rtl'} className="rounded-lg bg-white px-6 py-8 sm:px-10 shadow-sm">
          <RichText html={snap.bodyHtml} dir={en ? 'ltr' : 'rtl'} />
        </article>
      </div>
    </div>
  );
}
