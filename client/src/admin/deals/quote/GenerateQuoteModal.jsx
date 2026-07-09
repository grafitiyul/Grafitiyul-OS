import { useEffect, useMemo, useState } from 'react';
import Dialog from '../../common/Dialog.jsx';
import { api } from '../../../lib/api.js';
import { openWhatsappComposer } from '../../whatsapp/composerEvents.js';
import { QuoteBlock, blockHasContent, TEAL } from '../../../quote/QuoteBlockRenderer.jsx';
import RichEditor from '../../../editor/RichEditor.jsx';

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

// Text sections the operator can customize PER DEAL (rich-text popup). Pricing,
// hero, technical details and media stay structured — they are edited at their
// sources. The override writes to the Deal's working draft (or a one-shot
// layer), NEVER to the global template.
const EDITABLE_TYPES = new Set([
  'program', 'product_marketing', 'why_us', 'city_content',
  'faq', 'cancellation', 'participant_policy',
]);

// Field-level merge of override layers (mirror of the server's mergeOverrideState).
function mergeOverrides(base, overlay) {
  if (!overlay?.blocks) return base ?? null;
  const bb = base?.blocks || {};
  const blocks = {};
  for (const k of new Set([...Object.keys(bb), ...Object.keys(overlay.blocks)])) {
    blocks[k] = { ...(bb[k] || {}), ...(overlay.blocks[k] || {}) };
  }
  return { blocks };
}

// Remove one block's entry from an override layer; null when nothing remains.
function withoutOverrideKey(state, key) {
  if (!state?.blocks || !(key in state.blocks)) return state ?? null;
  const { [key]: _drop, ...rest } = state.blocks;
  return Object.keys(rest).length ? { blocks: rest } : null;
}

// The block's CURRENT effective body as editable HTML (the composed model
// already reflects persisted + temporary overrides).
function blockHtmlOf(block) {
  const d = block?.data || {};
  if (typeof d.customHtml === 'string') return d.customHtml;
  if (typeof d.html === 'string') return d.html;
  if (Array.isArray(d.items)) return d.items.map((it) => it.html || '').join('\n');
  return '';
}

// Rich-text popup for one section. The checkbox decides persistence:
// checked → the override becomes part of the Deal (all future versions inherit
// it); unchecked → one-shot, applies only to the version generated now, then
// disappears. The checkbox INITIALIZES from the section's CURRENT layer —
// a temp-edited section opens unchecked, so casually re-saving it can never
// silently promote the temporary text into the Deal's persistent state.
function OverrideEditor({ block, hasTemp, hasPersistent, busy, onSave, onReset, onClose }) {
  const [title, setTitle] = useState(block.data?.title || '');
  const [html, setHtml] = useState(blockHtmlOf(block));
  const [applyFuture, setApplyFuture] = useState(!hasTemp);
  return (
    <Dialog
      open
      onClose={onClose}
      title={`עריכה להצעה של עסקה זו — ${block.data?.title || ''}`}
      size="lg"
      footer={(
        <>
          {(hasTemp || hasPersistent) && (
            <button
              type="button"
              disabled={busy}
              onClick={onReset}
              title="מסיר את ההתאמה של העסקה ומחזיר את המקטע לטקסט המקור — גם בגרסאות עתידיות"
              className="me-auto rounded-lg px-3 py-2 text-[12.5px] text-gray-500 hover:bg-gray-50 hover:text-gray-700 disabled:opacity-50"
            >
              ↺ שחזר טקסט ברירת מחדל
            </button>
          )}
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">ביטול</button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onSave({ title: title.trim(), html, applyFuture })}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'שומר…' : 'שמור'}
          </button>
        </>
      )}
    >
      <div dir="rtl" className="space-y-3">
        <p className="rounded-lg bg-gray-50 px-3 py-2 text-[12px] leading-relaxed text-gray-500 ring-1 ring-gray-200">
          העריכה כאן שייכת לעסקה הזו בלבד — התבנית הגלובלית והצעות שכבר הופקו לעולם אינן משתנות.
        </p>
        {hasTemp && (
          <p className="rounded-lg bg-purple-50 px-3 py-2 text-[12px] leading-relaxed text-purple-700 ring-1 ring-purple-200">
            למקטע זה יש כרגע שינוי זמני — הוא יחול רק על הגרסה שתופק עכשיו. סמנו את התיבה למטה כדי להפוך אותו לקבוע.
          </p>
        )}
        <div>
          <label className="mb-1 block text-[12px] text-gray-500">כותרת המקטע</label>
          <input className={FIELD} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-[12px] text-gray-500">תוכן</label>
          <RichEditor value={html} onChange={setHtml} ariaLabel="תוכן המקטע" minContentHeight={220} maxHeight="45vh" />
        </div>
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-200 px-3 py-2">
          <input
            type="checkbox"
            checked={applyFuture}
            onChange={(e) => setApplyFuture(e.target.checked)}
            className="mt-0.5"
          />
          <span className="text-[13px] text-gray-700">
            החל שינוי זה גם על גרסאות עתידיות של עסקה זו
            <span className="block text-[11.5px] leading-relaxed text-gray-400">
              ללא סימון — השינוי חל רק על הגרסה שתופק עכשיו; גרסאות עתידיות יחזרו לנוסח הקבוע של העסקה.
            </span>
          </span>
        </label>
      </div>
    </Dialog>
  );
}

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
  // Per-deal overrides: `editing` = the block open in the popup; tempOverrides =
  // the one-shot layer (unchecked "apply to future") for THIS generation only.
  const [editing, setEditing] = useState(null);
  const [tempOverrides, setTempOverrides] = useState(null);

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

  // Re-compose the preview, applying the one-shot layer when present.
  async function reloadPreview(docId, temps = tempOverrides) {
    const id = docId || doc?.id;
    if (!id) return;
    const m = temps?.blocks && Object.keys(temps.blocks).length
      ? await api.quoteDocuments.composePreviewWith(id, { overrideOverlay: temps })
      : await api.quoteDocuments.composePreview(id);
    setModel(m);
  }

  async function setLanguage(lang) {
    if (!doc || busy || doc.language === lang) return;
    setBusy(true); setError(null);
    try {
      const r = await api.quoteDocuments.update(doc.id, { language: lang });
      setDoc(r.quoteDocument);
      await reloadPreview(doc.id);
    } catch (e) {
      setError(e?.payload?.error || e?.message || 'save_failed');
    } finally {
      setBusy(false);
    }
  }

  // Save from the override popup. Persistent → PUT overrideState on the Deal's
  // working draft (all future versions inherit) AND drop the section's temp
  // entry — the temp layer must never keep shadowing (or later get mistaken
  // for) the persistent text. Temporary → local one-shot layer only.
  async function saveOverride(block, { title, html, applyFuture }) {
    const patch = { html };
    if (title && title !== (block.data?.title || '')) patch.title = title;
    setBusy(true); setError(null);
    try {
      if (applyFuture) {
        const next = mergeOverrides(doc.overrideState, { blocks: { [block.key]: patch } });
        const r = await api.quoteDocuments.update(doc.id, { overrideState: next });
        setDoc(r.quoteDocument);
        const temps = withoutOverrideKey(tempOverrides, block.key);
        setTempOverrides(temps);
        await reloadPreview(doc.id, temps);
      } else {
        const next = mergeOverrides(tempOverrides, { blocks: { [block.key]: patch } });
        setTempOverrides(next);
        await reloadPreview(doc.id, next);
      }
      setEditing(null);
    } catch (e) {
      setError(e?.payload?.error || e?.message || 'save_failed');
    } finally {
      setBusy(false);
    }
  }

  // "שחזר טקסט ברירת מחדל" — remove the section's override from BOTH layers so
  // it composes from source again, for this and every future version. Already-
  // generated documents are immutable and unaffected.
  async function resetOverride(block) {
    setBusy(true); setError(null);
    try {
      const temps = withoutOverrideKey(tempOverrides, block.key);
      setTempOverrides(temps);
      if (doc.overrideState?.blocks?.[block.key]) {
        const next = withoutOverrideKey(doc.overrideState, block.key);
        const r = await api.quoteDocuments.update(doc.id, { overrideState: next });
        setDoc(r.quoteDocument);
      }
      await reloadPreview(doc.id, temps);
      setEditing(null);
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
      const r = await api.quoteDocuments.produce(
        doc.id,
        tempOverrides?.blocks && Object.keys(tempOverrides.blocks).length
          ? { temporaryOverrideState: tempOverrides }
          : {},
      );
      const frozen = r.quoteDocument;
      setProduced(frozen);
      setTempOverrides(null); // one-shot layer is consumed by this generation
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
    // While the override editor is open, Esc/backdrop on the parent close ONLY
    // the editor (both dialogs listen on document; the parent's handler runs
    // first, so it must delegate).
    <Dialog open={open} onClose={editing ? () => setEditing(null) : onClose} title="הפקת הצעת מחיר" size="2xl" footer={footer}>
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
            {(model?.warnings?.length || 0) > 0 && (
              <span
                className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[12px] text-amber-700"
                title="מקטעים ללא תוכן בשפת ההצעה — מסומנים בגוף התצוגה"
              >
                ⚠ {model.warnings.length} חסרי תוכן בשפת ההצעה
              </span>
            )}
            <span className="ms-auto text-[11.5px] text-gray-400">
              ריחוף על מקטע טקסט מציג ✎ עריכה — לעסקה זו בלבד, לא לתבנית הגלובלית.
            </span>
          </div>

          {/* the actual customer proposal — internal scroll via the Dialog body.
              Editable text sections get a hover ✎ that opens the override popup. */}
          {loading ? (
            <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 py-24 text-center text-sm text-gray-400">טוען תצוגה מקדימה…</div>
          ) : error && !model ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">שגיאה: {error}</div>
          ) : model ? (
            <div className="rounded-xl bg-gray-100 p-2 sm:p-4">
              <article dir={lang === 'en' ? 'ltr' : 'rtl'} className="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-gray-200/70">
                {(() => {
                  // Editable text sections stay in the WORKSPACE even when empty
                  // (dashed placeholder + edit action) — resetting an override on
                  // an empty-source section must never make it unreachable. The
                  // customer page still hides empty sections; only produced
                  // content reaches them.
                  const visible = (model.blocks || []).filter(
                    (b) => !b.hidden && (blockHasContent(b) || EDITABLE_TYPES.has(b.type)),
                  );
                  const heroBlock = visible.find((b) => b.type === 'hero' && blockHasContent(b));
                  const bodyBlocks = visible.filter((b) => b.type !== 'hero');
                  const tempKeys = new Set(Object.keys(tempOverrides?.blocks || {}));
                  return (
                    <>
                      {heroBlock && <QuoteBlock block={heroBlock} lang={lang} />}
                      <div className="space-y-16 px-6 py-12 lg:px-16 lg:py-14">
                        {bodyBlocks.map((b) => (
                          <section key={b.key} className="group relative">
                            {EDITABLE_TYPES.has(b.type) && blockHasContent(b) && (
                              <div className="absolute -top-3 start-0 z-10 flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                                <button
                                  type="button"
                                  onClick={() => setEditing(b)}
                                  className="rounded-md border border-gray-200 bg-white/95 px-2 py-1 text-[12px] text-gray-700 shadow-sm backdrop-blur hover:bg-gray-50"
                                >
                                  ✎ עריכה להצעה זו
                                </button>
                              </div>
                            )}
                            {(b.overridden || tempKeys.has(b.key)) && (
                              <span
                                className="absolute -top-3 end-0 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
                                style={{ background: tempKeys.has(b.key) ? '#9333ea' : TEAL }}
                                title={tempKeys.has(b.key) ? 'שינוי זמני — לגרסה הקרובה בלבד' : 'מותאם לעסקה זו'}
                              >
                                {tempKeys.has(b.key) ? 'זמני' : 'מותאם'}
                              </span>
                            )}
                            {blockHasContent(b) ? (
                              <QuoteBlock block={b} lang={lang} />
                            ) : (
                              // Empty section — say exactly WHY. A language gap
                              // (source filled only in the other language) is the
                              // common case after resetting an override; the
                              // strict no-cross-language-fallback rule is by
                              // design, so the operator gets the precise cause +
                              // every way out (switch language / fill source /
                              // per-deal override).
                              <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50/60 px-5 py-6 text-start">
                                <div className="text-[15px] font-semibold text-gray-500">{b.data?.title || b.key}</div>
                                <p className="mt-1 text-[12.5px] leading-relaxed text-gray-400">
                                  {(model.warnings || []).some((w) => w.blockKey === b.key && w.otherLanguageHasContent)
                                    ? `התוכן קיים במקור ${lang === 'en' ? 'בעברית' : 'באנגלית'} — אבל ההצעה ${lang === 'en' ? 'באנגלית' : 'בעברית'}, ואין במקור תוכן בשפה זו, ולכן המקטע לא יוצג ללקוח. אפשר להחליף את שפת ההצעה למעלה, למלא את התרגום במקור, או להוסיף התאמה לעסקה זו.`
                                    : 'אין תוכן במקטע זה במקור — הוא לא יוצג ללקוח. אפשר למלא תוכן במקור, או להוסיף התאמה לעסקה זו.'}
                                  {b.source ? ` (מקור: ${b.source})` : ''}
                                </p>
                                <button
                                  type="button"
                                  onClick={() => setEditing(b)}
                                  className="mt-2 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-[12px] text-gray-700 hover:bg-gray-50"
                                >
                                  ✎ הוסף תוכן להצעה זו
                                </button>
                              </div>
                            )}
                          </section>
                        ))}
                      </div>
                    </>
                  );
                })()}
              </article>
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

      {editing && (
        <OverrideEditor
          block={editing}
          hasTemp={!!tempOverrides?.blocks?.[editing.key]}
          hasPersistent={!!doc?.overrideState?.blocks?.[editing.key]}
          busy={busy}
          onSave={(v) => saveOverride(editing, v)}
          onReset={() => resetOverride(editing)}
          onClose={() => setEditing(null)}
        />
      )}
    </Dialog>
  );
}
