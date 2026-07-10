import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import Dialog from '../common/Dialog.jsx';
import QuestionnaireFillDialog from '../../questionnaire/QuestionnaireFillDialog.jsx';

// "טופס שיחת תיאום" — the per-Booking coordination form action inside the
// tour modal's customer card. Every Booking gets its OWN independent form
// (group tours included). All flows ride the generic engine:
//   • status chip from the booking's active coordination submission
//   • copy/open the customer's public token link (sending stays MANUAL — GOS
//     never auto-sends customer communication)
//   • fill internally (operator on the phone with the customer) via the same
//     staff fill dialog Tour Summary uses

export default function CoordinationFormAction({ bookingId }) {
  const [status, setStatus] = useState(null); // null | draft | submitted | reviewed
  const [open, setOpen] = useState(false);
  const [fillOpen, setFillOpen] = useState(false);
  const [link, setLink] = useState(null); // { url, token } | null
  const [linkError, setLinkError] = useState(null);
  const [copied, setCopied] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      const list = await api.questionnaires.listSubmissions({
        subjectType: 'booking',
        subjectId: bookingId,
        purpose: 'coordination',
      });
      const active = list.find((s) => ['draft', 'submitted', 'reviewed'].includes(s.status));
      setStatus(active?.status || null);
    } catch {
      setStatus(null);
    }
  }, [bookingId]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const openActions = async () => {
    setOpen(true);
    setLinkError(null);
    setCopied(false);
    try {
      const l = await api.questionnaires.getOrCreateLink({
        purpose: 'coordination',
        subjectType: 'booking',
        subjectId: bookingId,
      });
      setLink(l);
    } catch (e) {
      const code = e.payload?.error;
      const messages = {
        purpose_not_configured: 'לא נבחרה תבנית לשיחת תיאום — בחרו בהגדרות → סיורים.',
        no_published_version: 'לתבנית שיחת התיאום אין גרסה מפורסמת — פרסמו אותה בבילדר.',
        template_not_active: 'תבנית שיחת התיאום אינה פעילה.',
        template_not_public: 'תבנית שיחת התיאום מוגדרת לצוות בלבד — שנו את קהל היעד שלה.',
      };
      setLinkError(messages[code] || e.message);
      setLink(null);
    }
  };

  const copy = async () => {
    if (!link?.url) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the URL is visible for manual copy */
    }
  };

  const chip =
    status === 'submitted' || status === 'reviewed'
      ? { text: '· הוגש', cls: 'text-emerald-600' }
      : status === 'draft'
        ? { text: '· בתהליך', cls: 'text-amber-600' }
        : null;

  return (
    <>
      <button
        type="button"
        onClick={openActions}
        className="flex w-full items-center gap-2 text-[13px] text-gray-700 hover:text-gray-900"
      >
        <span aria-hidden>📋</span>
        טופס שיחת תיאום
        {chip ? <span className={`text-[11.5px] font-semibold ${chip.cls}`}>{chip.text}</span> : null}
      </button>

      <Dialog open={open} onClose={() => setOpen(false)} title="טופס שיחת תיאום" size="md">
        <div dir="rtl" className="space-y-4 p-1">
          {chip ? (
            <div className={`rounded-lg border px-3 py-2 text-[13px] ${
              status === 'draft'
                ? 'border-amber-200 bg-amber-50 text-amber-800'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800'
            }`}
            >
              {status === 'draft' ? '✏️ הלקוח התחיל למלא — הטופס בתהליך.' : '✅ הטופס הוגש.'}
            </div>
          ) : (
            <p className="text-[13px] text-gray-600">
              לכל הזמנה טופס תיאום עצמאי. שלחו ללקוח את הקישור, או מלאו יחד איתו בשיחה.
            </p>
          )}

          {linkError ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
              ⚠️ {linkError}
            </div>
          ) : link ? (
            <div className="space-y-2">
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <div className="text-[11.5px] font-medium text-gray-500">קישור ללקוח (ללא צורך בהתחברות)</div>
                <div dir="ltr" className="mt-0.5 truncate font-mono text-[12px] text-gray-700">{link.url}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={copy}
                  className="rounded-lg bg-blue-600 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-blue-700"
                >
                  {copied ? '✓ הועתק' : '📄 העתקת קישור'}
                </button>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="rounded-lg border border-gray-300 px-3.5 py-2 text-[13px] text-gray-700 hover:bg-gray-50"
                >
                  פתיחה בטאב חדש
                </a>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setFillOpen(true);
                  }}
                  className="rounded-lg border border-gray-300 px-3.5 py-2 text-[13px] text-gray-700 hover:bg-gray-50"
                >
                  {status === 'submitted' || status === 'reviewed' ? 'צפייה בתשובות' : 'מילוי פנימי (בשיחה)'}
                </button>
              </div>
            </div>
          ) : !linkError ? (
            <div className="py-3 text-[13px] text-gray-400">מכין קישור…</div>
          ) : null}

          {linkError ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setFillOpen(true);
              }}
              className="rounded-lg border border-gray-300 px-3.5 py-2 text-[13px] text-gray-700 hover:bg-gray-50"
            >
              {status ? 'פתיחת הטופס' : 'ניסיון מילוי פנימי'}
            </button>
          ) : null}
        </div>
      </Dialog>

      <QuestionnaireFillDialog
        open={fillOpen}
        onClose={() => {
          setFillOpen(false);
          refreshStatus();
        }}
        purpose="coordination"
        subjectType="booking"
        subjectId={bookingId}
        title="טופס שיחת תיאום"
        onStatusChange={() => refreshStatus()}
      />
    </>
  );
}
