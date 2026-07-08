import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Dialog from '../../common/Dialog.jsx';
import { api } from '../../../lib/api.js';
import { openWhatsappComposer } from '../../whatsapp/composerEvents.js';
import QuoteDocumentRenderer from '../../../quote/QuoteBlockRenderer.jsx';

// "הפק הצעת מחיר" — the quote GENERATION modal (the operator's main flow).
//
// Top row (compact): language (defaults to the primary contact's communication
// language — resolved server-side when the draft is created) + action
// (generate only / send by email / send by WhatsApp). Body: the ACTUAL customer
// proposal preview (same shared renderer as the public page), scrolling
// internally — this surface is the foundation for per-quote editing (Slice 3).
//
// Generating FREEZES: the server clones the draft into a new immutable
// QuoteDocument (own permanent URL + snapshot, versioned within the offer).
// Sending follows the house product rule — nothing leaves without operator
// review: email opens an editable subject/body step; WhatsApp seeds a draft in
// the existing composer.

const FIELD = 'w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-400 focus:outline-none';

function contactDisplayName(c) {
  return (
    [c.firstNameHe || c.firstNameEn, c.lastNameHe || c.lastNameEn].filter(Boolean).join(' ').trim() ||
    'איש קשר'
  );
}

const ACTIONS = [
  { key: 'none', label: 'הפקה בלבד' },
  { key: 'email', label: 'שליחה במייל' },
  { key: 'whatsapp', label: 'שליחה בוואטסאפ' },
];

function publicQuoteUrl(token) {
  return `${window.location.origin}/quote/${token}`;
}

function emailDefaults({ lang, url, productName, firstName }) {
  if (lang === 'en') {
    return {
      subject: `Price proposal${productName ? ` — ${productName}` : ''}`,
      body: `Hello${firstName ? ` ${firstName}` : ''},\n\nHere is our price proposal:\n${url}\n\nWe're happy to answer any question.\n`,
    };
  }
  return {
    subject: `הצעת מחיר${productName ? ` — ${productName}` : ''}`,
    body: `שלום${firstName ? ` ${firstName}` : ''},\n\nמצורפת הצעת המחיר שלנו:\n${url}\n\nנשמח לעמוד לרשותכם בכל שאלה.\n`,
  };
}

export default function GenerateQuoteModal({ open, onClose, deal, onGenerated }) {
  const [doc, setDoc] = useState(null); // the working draft
  const [model, setModel] = useState(null); // composed preview
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [action, setAction] = useState('none');
  // phase: 'preview' → (produce) → 'email' (review step) | 'done'
  const [phase, setPhase] = useState('preview');
  const [produced, setProduced] = useState(null); // the frozen document
  const [sentNote, setSentNote] = useState(null);
  const [copied, setCopied] = useState(false);
  const [to, setTo] = useState('');
  const [contactId, setContactId] = useState(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  // The deal's contacts that actually have an email; quote recipients first.
  const emailRecipients = useMemo(() => {
    const list = (deal?.contacts || [])
      .map((dc) => ({
        dc,
        contact: dc.contact,
        email: dc.contact?.emails?.find((e) => e.isPrimary)?.value || dc.contact?.emails?.[0]?.value || null,
      }))
      .filter((r) => r.contact && r.email);
    list.sort((a, b) => (b.dc.receiveQuotes === true) - (a.dc.receiveQuotes === true) || (b.dc.isPrimary === true) - (a.dc.isPrimary === true));
    return list.map((r) => ({ contactId: r.contact.id, name: contactDisplayName(r.contact), email: r.email }));
  }, [deal]);

  useEffect(() => {
    if (!open || !deal?.id) return;
    let alive = true;
    setLoading(true); setError(null); setPhase('preview'); setProduced(null);
    setSentNote(null); setCopied(false); setAction('none');
    (async () => {
      try {
        const ens = await api.deals.quoteDocument(deal.id);
        if (!alive) return;
        setDoc(ens.quoteDocument);
        const m = await api.quoteDocuments.composePreview(ens.quoteDocument.id);
        if (!alive) return;
        setModel(m);
      } catch (e) {
        if (alive) setError(e?.payload?.error || e?.message || 'load_failed');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [open, deal?.id]);

  async function setLanguage(lang) {
    if (!doc || busy || doc.language === lang) return;
    setBusy(true); setError(null);
    try {
      const r = await api.quoteDocuments.update(doc.id, { language: lang });
      setDoc(r.quoteDocument);
      setModel(await api.quoteDocuments.composePreview(doc.id));
    } catch (e) {
      setError(e?.payload?.error || e?.message || 'save_failed');
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    if (!doc || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await api.quoteDocuments.produce(doc.id);
      const frozen = r.quoteDocument;
      setProduced(frozen);
      onGenerated?.(frozen);
      const url = publicQuoteUrl(frozen.publicToken);
      if (action === 'email') {
        const first = emailRecipients[0] || null;
        setTo(first?.email || '');
        setContactId(first?.contactId || null);
        const d = emailDefaults({
          lang: frozen.language,
          url,
          productName: frozen.displayProductName || deal?.product?.nameHe || '',
          firstName: first?.name?.split(' ')[0] || '',
        });
        setSubject(d.subject);
        setBody(d.body);
        setPhase('email');
      } else if (action === 'whatsapp') {
        const d = emailDefaults({ lang: frozen.language, url, productName: frozen.displayProductName || deal?.product?.nameHe || '', firstName: '' });
        try {
          const { chats } = await api.whatsapp.contextChats('deal', deal.id);
          const chat = (chats || []).find((c) => c.id) || null;
          openWhatsappComposer({ subjectId: deal.id, chat, draftText: d.body });
          setSentNote(chat ? 'טיוטת הודעה נפתחה בוואטסאפ — עברו עליה ושלחו.' : 'וואטסאפ נפתח — אין צ׳אט מקושר לעסקה, העתיקו את הקישור.');
        } catch {
          setSentNote('לא ניתן לפתוח את הוואטסאפ — העתיקו את הקישור ושלחו ידנית.');
        }
        setPhase('done');
      } else {
        setPhase('done');
      }
    } catch (e) {
      const code = e?.payload?.error || e?.message;
      setError(code === 'not_draft' ? 'ההצעה כבר הופקה — רעננו את העמוד.' : code || 'produce_failed');
    } finally {
      setBusy(false);
    }
  }

  async function sendEmail() {
    if (!produced || busy) return;
    setBusy(true); setError(null);
    try {
      await api.deals.sendQuoteEmail(deal.id, {
        quoteDocumentId: produced.id,
        to,
        subject,
        body,
        contactId,
      });
      setSentNote(`נשלח במייל אל ${to}.`);
      setPhase('done');
    } catch (e) {
      setError(e?.payload?.message || e?.payload?.error || e?.message || 'send_failed');
    } finally {
      setBusy(false);
    }
  }

  async function copyUrl() {
    if (!produced) return;
    try {
      await navigator.clipboard.writeText(publicQuoteUrl(produced.publicToken));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard unavailable — the URL is selectable text */ }
  }

  const lang = doc?.language || 'he';
  const footer = phase === 'preview' ? (
    <>
      <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">ביטול</button>
      <button
        type="button"
        onClick={generate}
        disabled={busy || loading || !doc}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {busy ? 'מפיק…' : action === 'email' ? 'הפק ושלח במייל' : action === 'whatsapp' ? 'הפק ושלח בוואטסאפ' : 'הפק הצעת מחיר'}
      </button>
    </>
  ) : phase === 'email' ? (
    <>
      <button type="button" onClick={() => setPhase('done')} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">דלג על השליחה</button>
      <button
        type="button"
        onClick={sendEmail}
        disabled={busy || !to.trim() || !subject.trim() || !body.trim()}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {busy ? 'שולח…' : 'שלח מייל'}
      </button>
    </>
  ) : (
    <button type="button" onClick={onClose} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black">סגור</button>
  );

  return (
    <Dialog open={open} onClose={onClose} title="הפקת הצעת מחיר" size="2xl" footer={footer}>
      {phase === 'preview' && (
        <div className="flex min-h-0 flex-col" dir="rtl">
          {/* compact single-row toolbar */}
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-medium text-gray-500">שפה</span>
              <div className="inline-flex overflow-hidden rounded-full border border-gray-200">
                {[['he', 'עברית'], ['en', 'EN']].map(([code, label]) => (
                  <button
                    key={code}
                    type="button"
                    disabled={busy || loading}
                    onClick={() => setLanguage(code)}
                    className={`px-3 py-1 text-[12px] font-medium transition disabled:opacity-50 ${lang === code ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-medium text-gray-500">פעולה</span>
              <div className="inline-flex overflow-hidden rounded-full border border-gray-200">
                {ACTIONS.map((a) => (
                  <button
                    key={a.key}
                    type="button"
                    onClick={() => setAction(a.key)}
                    className={`px-3 py-1 text-[12px] font-medium transition ${action === a.key ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
            <Link
              to={`/admin/quote/${deal?.id}`}
              className="ms-auto text-[12px] text-blue-700 hover:underline"
              onClick={onClose}
            >
              עריכת תוכן ההצעה ↗
            </Link>
          </div>

          {/* the actual customer proposal — internal scroll via the Dialog body */}
          {loading ? (
            <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 py-24 text-center text-sm text-gray-400">טוען תצוגה מקדימה…</div>
          ) : error && !model ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">שגיאה: {error}</div>
          ) : model ? (
            <div className="rounded-xl bg-gray-100 p-2 sm:p-4">
              <div className="overflow-hidden rounded-lg shadow-sm ring-1 ring-gray-200/70">
                <QuoteDocumentRenderer model={model} />
              </div>
            </div>
          ) : null}
          {error && model && <div className="mt-2 text-sm text-red-600">{error}</div>}
        </div>
      )}

      {phase === 'email' && produced && (
        <div className="space-y-3" dir="rtl">
          <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200">
            ✓ ההצעה הופקה (גרסה {produced.versionNo}). עברו על המייל לפני השליחה — דבר לא נשלח אוטומטית.
          </div>
          <div>
            <label className="mb-1 block text-[12px] text-gray-500">אל</label>
            {emailRecipients.length > 1 ? (
              <select
                className={FIELD}
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setContactId(emailRecipients.find((r) => r.email === e.target.value)?.contactId || null);
                }}
              >
                {emailRecipients.map((r) => (
                  <option key={r.contactId} value={r.email}>{r.name} · {r.email}</option>
                ))}
              </select>
            ) : (
              <input className={FIELD} dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} placeholder="email@example.com" />
            )}
          </div>
          <div>
            <label className="mb-1 block text-[12px] text-gray-500">נושא</label>
            <input className={FIELD} value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-[12px] text-gray-500">תוכן</label>
            <textarea className={`${FIELD} min-h-[160px]`} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          {error && <div className="text-sm text-red-600">{error}</div>}
        </div>
      )}

      {phase === 'done' && produced && (
        <div className="space-y-3 py-2" dir="rtl">
          <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200">
            ✓ הצעת המחיר הופקה — גרסה {produced.versionNo}. הקישור קבוע ולא ישתנה.
          </div>
          {sentNote && <div className="text-sm text-gray-600">{sentNote}</div>}
          <div className="flex items-center gap-2">
            <input readOnly dir="ltr" className={`${FIELD} bg-gray-50 text-gray-600`} value={publicQuoteUrl(produced.publicToken)} onFocus={(e) => e.target.select()} />
            <button type="button" onClick={copyUrl} className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
              {copied ? '✓ הועתק' : 'העתק'}
            </button>
            <a
              href={publicQuoteUrl(produced.publicToken)}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              פתח ↗
            </a>
          </div>
        </div>
      )}
    </Dialog>
  );
}
