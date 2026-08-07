import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import RichText from '../../editor/RichText.jsx';
import { DELIVERY_LABEL_HE, DELIVERY_TONE, deliverySummaryHe } from '../../lib/emailDelivery.js';

// Internal archive view of a SENT confirmation email — the frozen snapshot
// (ConfirmationEmailSend), exactly what was handed to the queue. The
// QuoteSnapshotView convention: amber banner, read-only, customers never see
// this screen. Template edits after the send can never change what is shown.

// Delivery wording comes from THE canonical module — this screen no longer
// keeps its own status map (which spoke the DB's 'pending' vocabulary and
// could drift from every other surface).

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
        תצוגת ארכיון פנימית — צילום קפוא של מייל האישור כפי שנוצר עבור הלקוח. מצב השליחה בפועל מופיע למטה. לקוחות אינם רואים מסך זה.
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
            {/* The snapshot was CREATED at this moment — that is not the same
                as delivered, so it is labelled honestly and the delivery state
                is stated separately. */}
            <span className="text-gray-400">נוצר:</span>{' '}
            {new Date(snap.createdAt).toLocaleString('he-IL')}
            {d && (
              <>
                {' · '}
                <span className="text-gray-400">סטטוס:</span>{' '}
                <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ring-1 ${DELIVERY_TONE[d.state]}`}>
                  {DELIVERY_LABEL_HE[d.state]}
                </span>
                {d.sentAt && ` (${new Date(d.sentAt).toLocaleString('he-IL')})`}
              </>
            )}
          </div>
          {/* The ONE truthful sentence — never a bare code, and never silence
              when the customer did not get the email. */}
          {d && !d.delivered && (
            <div className={`rounded-lg px-3 py-2 text-[12.5px] ${d.state === 'failed' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800'}`}>
              {deliverySummaryHe(d)}
            </div>
          )}
          {(snap.fillersSnapshot || []).length > 0 && (
            <div>
              <span className="text-gray-400">פילרים:</span>{' '}
              {snap.fillersSnapshot.map((f) => f.kind).join(', ')}
            </div>
          )}
        </div>

        {/* "נוצר מתוך" — frozen generation metadata for internal debugging.
            Snapshotted at send (the live template mutates); never part of the
            customer email. Older sends predate the column and skip this box. */}
        {snap.generationMeta && (
          <div className="mb-4 rounded-xl border border-gray-200 bg-white px-5 py-4 text-[13px] text-gray-700">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="font-semibold text-gray-800">נוצר מתוך</span>
              <span className="text-[10.5px] rounded-full bg-gray-100 text-gray-500 px-2 py-0.5">דיבוג פנימי</span>
              {snap.generationMeta.test && (
                <span className="text-[10.5px] rounded-full bg-purple-50 text-purple-700 px-2 py-0.5 font-medium">מייל בדיקה</span>
              )}
            </div>
            <div className="space-y-1">
              <div>
                <span className="text-gray-400">תבנית:</span>{' '}
                <span className="font-medium">{snap.generationMeta.templateName}</span>
                {' · '}
                <span className="text-gray-400">שפה:</span>{' '}
                {snap.generationMeta.language === 'en' ? 'English' : 'עברית'}
              </div>
              <div>
                <span className="text-gray-400">בלוקים מספריית התוכן:</span>{' '}
                {(snap.generationMeta.blocks || []).length
                  ? snap.generationMeta.blocks.map((b) => b.internalName).join(' · ')
                  : '—'}
              </div>
              <div>
                <span className="text-gray-400">פילרים פעילים:</span>{' '}
                {(snap.generationMeta.fillers || []).length
                  ? snap.generationMeta.fillers.join(', ')
                  : '—'}
              </div>
            </div>
          </div>
        )}
        <article dir={en ? 'ltr' : 'rtl'} className="rounded-lg bg-white px-6 py-8 sm:px-10 shadow-sm">
          <RichText html={snap.bodyHtml} dir={en ? 'ltr' : 'rtl'} />
        </article>
      </div>
    </div>
  );
}
