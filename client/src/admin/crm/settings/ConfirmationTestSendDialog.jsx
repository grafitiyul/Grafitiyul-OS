import { useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';
import Dialog from '../../common/Dialog.jsx';
import SearchSelect from '../../communication/SearchSelect.jsx';

// "שלח מייל בדיקה" — QA send from the Confirmation Email settings screen.
// Picks a REAL deal, runs the REAL resolver+composer, and hands the email to
// the REAL queue (send endpoint with test:true) — nothing mocked, nothing
// bypassed; the only differences are the recipient, a '[בדיקה]' subject
// prefix, and no deal timeline/thread linkage (a QA probe is not customer
// communication).

const LABEL = 'block text-[12px] font-medium text-gray-600 mb-1';
const INPUT =
  'h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';
const EMAIL_PREF_KEY = 'gos.confirmation.testEmail';

const STATUS_HE = { open: 'פתוח', won: 'WON', lost: 'LOST' };

export default function ConfirmationTestSendDialog({ onClose }) {
  const [deal, setDeal] = useState(null); // SearchSelect value
  const [preview, setPreview] = useState(null); // compose result for the picked deal
  const [previewErr, setPreviewErr] = useState(null);
  const [email, setEmail] = useState(() => localStorage.getItem(EMAIL_PREF_KEY) || '');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  // The picked deal's REAL resolution — template, language, specific warnings —
  // shown before sending so QA knows exactly what will go out.
  useEffect(() => {
    if (!deal) {
      setPreview(null);
      setPreviewErr(null);
      return;
    }
    let on = true;
    setPreview(null);
    setPreviewErr(null);
    api.confirmationEmail
      .compose(deal.id, {})
      .then((d) => on && setPreview(d))
      .catch((e) => {
        if (!on) return;
        const code = e.payload?.error;
        setPreviewErr(
          code === 'ambiguous_confirmation_template'
            ? 'תבניות חופפות — הרזולבר מסרב לבחור. תקנו את החפיפה למעלה.'
            : code === 'no_confirmation_template'
              ? 'אף תבנית לא מתאימה לעסקה הזו.'
              : code || e.message,
        );
      });
    return () => {
      on = false;
    };
  }, [deal]);

  async function searchDeals(q) {
    const res = await api.deals.list({ search: q, page: 1, pageSize: 10 });
    return (res.rows || []).map((d) => ({
      id: d.id,
      label: `#${d.orderNo ?? ''} · ${d.title}`,
      subtitle: STATUS_HE[d.status] || d.status,
    }));
  }

  async function sendTest() {
    setBusy(true);
    setError(null);
    try {
      localStorage.setItem(EMAIL_PREF_KEY, email.trim());
      await api.confirmationEmail.send(deal.id, {
        to: email.trim(),
        test: true,
        acknowledgeWarnings: true,
      });
      setDone(true);
    } catch (e) {
      const code = e.payload?.error;
      setError(
        code === 'duplicate_send'
          ? 'נשלח ממש עכשיו — המתינו רגע ונסו שוב.'
          : code === 'no_connected_account'
            ? 'אין חשבון Gmail מחובר.'
            : code === 'missing_subject'
              ? 'לתבנית אין נושא בשפת השליחה — הוסיפו נושא ונסו שוב.'
              : code === 'empty_body'
                ? 'המייל ריק בשפת השליחה — אין מה לשלוח.'
                : 'שגיאה: ' + (code || e.message),
      );
    } finally {
      setBusy(false);
    }
  }

  const missing = preview?.warnings?.filter((w) => w.code === 'missing_content') || [];

  return (
    <Dialog
      open
      onClose={onClose}
      title="שלח מייל בדיקה"
      size="md-wide"
      footer={
        done ? (
          <button type="button" onClick={onClose} className="h-10 rounded-lg bg-gray-900 px-5 text-sm font-medium text-white">
            סגור
          </button>
        ) : (
          <button
            type="button"
            onClick={sendTest}
            disabled={busy || !deal || !preview || !email.trim()}
            className="h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'שולח…' : 'שלח בדיקה'}
          </button>
        )
      }
    >
      <div className="space-y-4" dir="rtl">
        {done ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            מייל הבדיקה נכנס לתור השליחה ✓ — יישלח אל <span dir="ltr" className="font-mono">{email}</span> תוך
            כדקה (הנושא יסומן [בדיקה]).
          </div>
        ) : (
          <>
            <p className="text-[13px] text-gray-500">
              נשלח דרך הצינור האמיתי — אותה תבנית, אותו קומפוזר, אותו תור שליחה.
              ההבדל היחיד: הנמען הוא אתם.
            </p>
            <div>
              <span className={LABEL}>עסקה</span>
              <SearchSelect
                value={deal}
                onSelect={setDeal}
                search={searchDeals}
                placeholder="חפשו עסקה לפי שם, ארגון או מספר…"
                emptySearch="לא נמצאו עסקאות"
              />
            </div>

            {previewErr && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{previewErr}</div>
            )}
            {preview && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-[12.5px] text-gray-700 space-y-1">
                <div>
                  <span className="text-gray-400">תבנית שנבחרה:</span>{' '}
                  <span className="font-medium">{preview.template.internalName}</span>
                  {' · '}
                  <span className="text-gray-400">שפה:</span> {preview.language === 'en' ? 'English' : 'עברית'}
                  {preview.hasFillers && (
                    <>
                      {' · '}
                      <span className="text-gray-400">פילרים:</span> {preview.fillers.map((f) => f.kind).join(', ')}
                    </>
                  )}
                </div>
                {missing.length > 0 && (
                  <div className="text-amber-700">
                    ⚠ חסר תוכן בשפת השליחה: {missing.map((w) => w.label || w.sectionId).join(' · ')}
                  </div>
                )}
              </div>
            )}

            <div>
              <span className={LABEL}>שליחה אל (הכתובת שלכם)</span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                dir="ltr"
                placeholder="you@example.com"
                className={INPUT}
              />
            </div>
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{error}</div>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
