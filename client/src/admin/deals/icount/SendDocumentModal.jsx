import { useEffect, useMemo, useState } from 'react';
import Dialog from '../../common/Dialog.jsx';
import { api } from '../../../lib/api.js';
import { openWhatsappComposer } from '../../whatsapp/composerEvents.js';

// "שלח ללקוח" — send an already-issued iCount document to the customer, reusing
// existing infrastructure only:
//   • Email    → iCount's own document email flow (api.deals.sendIcountDocument).
//                PRODUCT RULE: no email text is ever sent automatically — when
//                iCount fails, the server returns a Gmail PROPOSAL (sender/
//                subject/body/link) that the operator reviews and can edit
//                here; only the explicit approval button sends it (via
//                api.deals.sendIcountDocumentGmail).
//   • WhatsApp → the EXISTING composer: we seed a draft ("הנה החשבונית: <link>")
//                and open the dock on the chosen chat (openWhatsappComposer).
// A single obvious recipient/number is auto-selected; the operator only chooses
// when there are several. No parallel document-sharing system is built here.

const FIELD = 'w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-400 focus:outline-none';

function contactDisplayName(c) {
  return (
    [c.firstNameHe || c.firstNameEn, c.lastNameHe || c.lastNameEn].filter(Boolean).join(' ').trim() ||
    'איש קשר'
  );
}

export default function SendDocumentModal({ open, onClose, deal, entry }) {
  const d = entry?.data || {};
  const docLabel = d.doctypeLabel || d.doctype || 'מסמך';
  const docUrl = d.docUrl || null;

  const [channel, setChannel] = useState('email');
  const [emailSel, setEmailSel] = useState('');
  const [chats, setChats] = useState([]);
  const [chatSel, setChatSel] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);
  // Gmail-fallback approval state: the server's proposal (never auto-sent) +
  // the operator-editable subject/body.
  const [fallback, setFallback] = useState(null); // { reason, from, docUrl }
  const [fbSubject, setFbSubject] = useState('');
  const [fbBody, setFbBody] = useState('');

  // Email recipients — the deal's contacts that actually have an email.
  const emailRecipients = useMemo(() => {
    return (deal?.contacts || [])
      .map((dc) => dc.contact)
      .filter(Boolean)
      .map((c) => ({
        id: c.id,
        name: contactDisplayName(c),
        email: c.emails?.find((e) => e.isPrimary)?.value || c.emails?.[0]?.value || null,
      }))
      .filter((r) => r.email);
  }, [deal]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSent(false);
    setCopied(false);
    setFallback(null);
    setChannel('email');
    setText(docUrl ? `הנה החשבונית:\n${docUrl}` : 'הנה החשבונית:');
    // Auto-select the single obvious email recipient.
    setEmailSel(emailRecipients.length === 1 ? emailRecipients[0].email : '');
    // Load WhatsApp chats for number/contact selection (auto-select single).
    let cancelled = false;
    (async () => {
      try {
        const { chats: list } = await api.whatsapp.contextChats('deal', deal.id);
        if (cancelled) return;
        const withChat = (list || []).filter((c) => c.id);
        setChats(withChat);
        setChatSel(withChat.length === 1 ? withChat[0].id : '');
      } catch {
        if (!cancelled) setChats([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, deal?.id, docUrl, emailRecipients]);

  async function sendEmail() {
    if (!emailSel || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.deals.sendIcountDocument(deal.id, {
        doctype: d.doctype,
        docnum: d.docnum,
        email: emailSel,
        docUrl: docUrl || undefined,
        contactId: emailRecipients.find((r) => r.email === emailSel)?.id || undefined,
      });
      setSent('icount');
    } catch (e) {
      const code = e?.payload?.error || e?.code || '';
      const g = e?.payload?.gmail;
      if (g?.available) {
        // iCount failed but a Gmail proposal is ready — switch to the approval
        // view. NOTHING was sent yet.
        setFallback({ reason: e?.payload?.reason || code, from: g.from, docUrl: g.docUrl });
        setFbSubject(g.subject || '');
        setFbBody(g.bodyText || '');
        setBusy(false);
        return;
      }
      const unavailableNote =
        g?.reason === 'no_doc_url'
          ? ' שליחה חלופית דרך Gmail לא אפשרית (אין קישור למסמך).'
          : g?.reason === 'gmail_unavailable'
            ? ' שליחה חלופית דרך Gmail אינה זמינה (אין חשבון מייל מחובר).'
            : '';
      setError(
        code === 'icount_request_failed'
          ? `שליחת המייל דרך iCount נכשלה${e?.payload?.reason ? ` (${e.payload.reason})` : ''}.${unavailableNote} ניתן לשלוח בוואטסאפ במקום.`
          : e?.payload?.reason || code || 'שליחת המייל נכשלה.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function approveGmailSend() {
    if (busy || !fbSubject.trim() || !fbBody.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.deals.sendIcountDocumentGmail(deal.id, {
        doctype: d.doctype,
        docnum: d.docnum,
        email: emailSel,
        subject: fbSubject,
        bodyText: fbBody,
        contactId: emailRecipients.find((r) => r.email === emailSel)?.id || undefined,
      });
      setSent('gmail');
      setFallback(null);
    } catch {
      setError('השליחה דרך Gmail נכשלה. ניתן לנסות שוב או לשלוח בוואטסאפ.');
    } finally {
      setBusy(false);
    }
  }

  function openInWhatsapp() {
    const chat = chats.find((c) => c.id === chatSel) || null;
    openWhatsappComposer({ subjectId: deal.id, chat, draftText: text });
    onClose();
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — text is visible for manual copy */
    }
  }

  const TabBtn = ({ value, children }) => (
    <button type="button" onClick={() => { setChannel(value); setError(null); setSent(false); setFallback(null); }}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium ${channel === value ? 'bg-blue-600 text-white' : 'border border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
      {children}
    </button>
  );

  return (
    <Dialog open={open} onClose={busy ? null : onClose} title={`שליחת ${docLabel}${d.docnum ? ` מס׳ ${d.docnum}` : ''} ללקוח`} size="md-wide"
      footer={
        <button type="button" onClick={onClose} disabled={busy}
          className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50">
          סגירה
        </button>
      }
    >
      <div className="space-y-3 py-1">
        <div className="flex items-center gap-2">
          <TabBtn value="email">אימייל</TabBtn>
          <TabBtn value="whatsapp">וואטסאפ</TabBtn>
        </div>

        {channel === 'email' ? (
          fallback && !sent ? (
            /* Gmail-fallback APPROVAL view — iCount failed; nothing was sent.
               The operator reviews/edits the exact email and explicitly approves. */
            <div className="space-y-3">
              <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
                שליחת המסמך דרך iCount נכשלה{fallback.reason ? ` (${fallback.reason})` : ''}. במקום זאת ניתן לשלוח
                את הקישור למסמך מחשבון המייל של המערכת — בדקו את תוכן המייל ואשרו את השליחה. שום דבר לא נשלח עדיין.
              </p>
              <div className="space-y-0.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[12.5px] text-gray-700">
                <p>מאת: <span dir="ltr" className="font-medium">{fallback.from}</span></p>
                <p>אל: <span dir="ltr" className="font-medium">{emailSel}</span></p>
                <p className="truncate">
                  קישור למסמך:{' '}
                  <a href={fallback.docUrl} target="_blank" rel="noopener noreferrer" dir="ltr" className="text-blue-700 underline">
                    {fallback.docUrl}
                  </a>
                </p>
              </div>
              <label className="block text-[12px] text-gray-600">
                נושא
                <input value={fbSubject} onChange={(e) => setFbSubject(e.target.value)} dir="auto" className={`mt-1 ${FIELD}`} />
              </label>
              <label className="block text-[12px] text-gray-600">
                תוכן ההודעה
                <textarea value={fbBody} onChange={(e) => setFbBody(e.target.value)} rows={6} dir="auto" className={`mt-1 ${FIELD} resize-none`} />
              </label>
              {error && <p className="text-[13px] text-red-600">{error}</p>}
              <div className="flex items-center gap-2">
                <button type="button" onClick={approveGmailSend} disabled={busy || !fbSubject.trim() || !fbBody.trim()}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                  {busy ? 'שולח…' : 'אישור ושליחה דרך Gmail'}
                </button>
                <button type="button" onClick={() => { setFallback(null); setError(null); }} disabled={busy}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                  ביטול
                </button>
              </div>
            </div>
          ) : (
          <div className="space-y-3">
            {emailRecipients.length === 0 ? (
              <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
                אין כתובת אימייל לאנשי הקשר של העסקה. הוסיפו אימייל לאיש קשר, או שלחו בוואטסאפ.
              </p>
            ) : (
              <label className="block text-[12px] text-gray-600">
                נמען
                <select value={emailSel} onChange={(e) => setEmailSel(e.target.value)} className={`mt-1 ${FIELD}`}>
                  <option value="">בחרו נמען…</option>
                  {emailRecipients.map((r) => (
                    <option key={r.id} value={r.email}>{r.name} — {r.email}</option>
                  ))}
                </select>
              </label>
            )}
            <p className="text-[12px] text-gray-500">
              המסמך יישלח ישירות דרך iCount לכתובת שנבחרה. אם iCount לא זמין, תוצג אפשרות לשליחה מחשבון המייל של המערכת — באישור מראש בלבד.
            </p>
            {sent && (
              <p className="text-[13px] font-semibold text-emerald-700">
                ✓ המסמך נשלח לאימייל{sent === 'gmail' ? ' (קישור למסמך, אושר ונשלח דרך Gmail)' : ''}
              </p>
            )}
            {error && <p className="text-[13px] text-red-600">{error}</p>}
            {!sent && (
              <button type="button" onClick={sendEmail} disabled={!emailSel || busy}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                {busy ? 'שולח…' : 'שליחה באימייל'}
              </button>
            )}
          </div>
          )
        ) : (
          <div className="space-y-3">
            {chats.length > 1 && (
              <label className="block text-[12px] text-gray-600">
                שיחה / מספר לשליחה
                <select value={chatSel} onChange={(e) => setChatSel(e.target.value)} className={`mt-1 ${FIELD}`}>
                  <option value="">בחרו שיחה…</option>
                  {chats.map((c) => (
                    <option key={c.id} value={c.id}>
                      {(c.contact?.name || c.displayName || c.phoneNumber)}{c.account?.label ? ` · ${c.account.label}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {chats.length === 0 && (
              <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[12.5px] text-gray-600">
                אין עדיין שיחת WhatsApp עם איש קשר של העסקה. פִתחו שיחה בצ'אט, או העתיקו את ההודעה ושלחו ידנית.
              </p>
            )}
            <label className="block text-[12px] text-gray-600">
              טקסט ההודעה (ניתן לעריכה)
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} dir="auto" className={`mt-1 ${FIELD} resize-none`} />
            </label>
            <div className="flex items-center gap-2">
              <button type="button" onClick={openInWhatsapp} disabled={chats.length === 0}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                פתיחה בצ'אט ושליחה
              </button>
              <button type="button" onClick={copyText}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                {copied ? '✓ הועתק' : 'העתקת הודעה'}
              </button>
            </div>
            <p className="text-[12px] text-gray-500">
              "פתיחה בצ'אט" יטען את ההודעה בצ'אט הוואטסאפ הקיים — משם השליחה, בחירת המספר וההיסטוריה מתנהלים כרגיל.
            </p>
          </div>
        )}
      </div>
    </Dialog>
  );
}
