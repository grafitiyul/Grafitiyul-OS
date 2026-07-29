import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../lib/api.js';
import Dialog from '../../common/Dialog.jsx';
import ConfirmDialog from '../../common/ConfirmDialog.jsx';
import WhatsAppLogo from '../../common/WhatsAppLogo.jsx';
import SearchSelect from '../../communication/SearchSelect.jsx';
import ChatComposer from '../../whatsapp/ChatComposer.jsx';

// Deal → "תבנית ווטסאפ". Pick an internal template + language, get the resolved
// wording as an ORDINARY editable draft, edit it, send.
//
// This screen deliberately owns NO sending logic. The body IS the real
// ChatComposer, mounted on the deal's real WhatsApp chat — so account selection,
// recipient resolution, formatting, validation, idempotency, the provider call,
// persistence, the inbox update and error handling are literally the same code
// path as a manually typed message. The only thing this modal contributes is the
// starting text (server-resolved through the canonical variable resolver).
//
// The template library is never mutated here: `resolved` returns a COPY, and the
// stored template keeps its {{customer_first_name}} chip.
//
// Layout: the dialog is a fixed-height flex column (most of the viewport). The
// selector row stays compact at the top and the composer takes ALL remaining
// height — a long imported template must be reviewable without scrolling inside
// a two-line box. The language toggle is deliberately AMBER, not green: green is
// reserved here for the WhatsApp send action and delivery/success states.

// Chats come from the same endpoint the Deal's WhatsAppDock uses, so "which
// conversation" is answered identically on both surfaces: the deal's PRIMARY
// contact, then its first chat.
function pickDefaultChat(data) {
  const chats = data?.chats || [];
  if (!chats.length) return null;
  return chats.find((c) => (c.contact?.id || c.contactId) === data?.primaryContactId) || chats[0];
}

const LANGS = [
  { key: 'he', label: 'עברית' },
  { key: 'en', label: 'English' },
];

export default function WhatsAppTemplateModal({ open, dealId, onClose, onSent }) {
  const [templates, setTemplates] = useState(null);
  const [chatData, setChatData] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const [templateId, setTemplateId] = useState('');
  const [lang, setLang] = useState('he');
  const [chatId, setChatId] = useState('');

  // The resolved copy currently seeded into the composer + the composer's live
  // text, so an edited draft can be told from an untouched one.
  const [seed, setSeed] = useState(null); // { text, nonce }
  const [liveText, setLiveText] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState(null);
  const [missingVars, setMissingVars] = useState([]);
  const [pendingSwitch, setPendingSwitch] = useState(null); // { templateId, lang }
  const nonceRef = useRef(0);

  // Load the catalog (active only — inactive templates must not be selectable
  // from a Deal) and the deal's chats.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadError(null);
    Promise.all([api.whatsappTemplates.list(true), api.whatsapp.contextChats('deal', dealId)])
      .then(([list, chats]) => {
        if (cancelled) return;
        setTemplates(list);
        setChatData(chats);
        setChatId((cur) => cur || pickDefaultChat(chats)?.id || '');
      })
      .catch((e) => !cancelled && setLoadError(e?.payload?.error || e.message));
    return () => {
      cancelled = true;
    };
  }, [open, dealId]);

  // Reset the draft state each time the modal opens — a template draft is a
  // one-shot composition, never a resumed one.
  useEffect(() => {
    if (open) return;
    setTemplateId('');
    setSeed(null);
    setLiveText('');
    setResolveError(null);
    setMissingVars([]);
    setPendingSwitch(null);
  }, [open]);

  const chats = chatData?.chats || [];
  const chat = chats.find((c) => c.id === chatId) || null;
  const selected = (templates || []).find((t) => t.id === templateId) || null;

  // Combobox options — the search runs locally over the already-loaded active
  // catalog (inactive templates are never fetched, so they can't appear).
  const searchTemplates = useCallback(
    async (q) => {
      const needle = q.trim();
      return (templates || [])
        .filter((t) => !needle || t.nameHe.includes(needle))
        .map((t) => ({
          id: t.id,
          label: t.nameHe,
          subtitle: !t.hasHe ? 'אנגלית בלבד' : !t.hasEn ? 'עברית בלבד' : 'עברית · English',
        }));
    },
    [templates],
  );

  const selectedOption = useMemo(
    () => (selected ? { id: selected.id, label: selected.nameHe } : null),
    [selected],
  );

  // An untouched draft is one the operator has not changed since it was seeded.
  const isDirty = !!seed && liveText.trim() !== (seed.text || '').trim();

  const resolve = useCallback(
    async (id, language) => {
      setResolving(true);
      setResolveError(null);
      setMissingVars([]);
      try {
        const r = await api.whatsappTemplates.resolved(id, dealId, language);
        nonceRef.current += 1;
        setSeed({ text: r.text || '', nonce: nonceRef.current });
        setLiveText(r.text || '');
        setMissingVars(r.missingVariables || []);
      } catch (e) {
        setSeed(null);
        setLiveText('');
        setResolveError(
          e?.payload?.error === 'language_unavailable'
            ? 'לתבנית הזו אין נוסח בשפה שנבחרה.'
            : 'טעינת הנוסח נכשלה — נסו שוב.',
        );
      } finally {
        setResolving(false);
      }
    },
    [dealId],
  );

  // Apply a template/language choice, warning first when it would throw away
  // edits the operator already made.
  function choose(nextTemplateId, nextLang) {
    if (isDirty) {
      setPendingSwitch({ templateId: nextTemplateId, lang: nextLang });
      return;
    }
    applyChoice(nextTemplateId, nextLang);
  }

  function applyChoice(nextTemplateId, nextLang) {
    const t = (templates || []).find((x) => x.id === nextTemplateId);
    // Default to Hebrew, but never silently substitute the other language: a
    // template with no Hebrew opens on the language it actually has.
    let language = nextLang;
    if (t) {
      if (language === 'he' && !t.hasHe && t.hasEn) language = 'en';
      if (language === 'en' && !t.hasEn && t.hasHe) language = 'he';
    }
    setTemplateId(nextTemplateId);
    setLang(language);
    if (nextTemplateId) resolve(nextTemplateId, language);
  }

  const langAvailable = (key) => (key === 'he' ? !!selected?.hasHe : !!selected?.hasEn);

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        size="xl"
        ariaLabel="שליחת תבנית ווטסאפ"
        title={
          <span className="flex items-center gap-2">
            <WhatsAppLogo size={18} />
            תבנית ווטסאפ
          </span>
        }
        // Fixed-height flex column: compact settings on top, composer fills the rest.
        panelClassName="h-[92vh]"
        contentClassName="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <div dir="rtl" className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3">
          {loadError ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
              טעינה נכשלה: <span dir="ltr" className="font-mono">{loadError}</span>
            </p>
          ) : !templates || !chatData ? (
            <p className="py-12 text-center text-sm text-gray-400">טוען…</p>
          ) : (
            <>
              {/* 1 — template + 2 — language. Compact, never grows. */}
              {/* Every pixel spent here is a pixel the editor doesn't get: the
                  controls are self-describing (placeholder + the שפה chip), so
                  they carry no separate field labels. */}
              <div className="grid shrink-0 gap-2.5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                {/* ~30% narrower than the column it sits in — the selector is a
                    toolbar control, not the star of the screen. */}
                <div className="w-full lg:max-w-[620px]">
                  {/* ONE searchable field — the shared GOS combobox (portal list,
                      type-to-filter, arrow/Enter/Escape, RTL). `compact` trims the
                      trigger height and the width cap trims it horizontally, so it
                      reads as a toolbar control rather than a form field; the
                      longest template name still fits on one line, and wrapLabel
                      wraps rather than truncates if one ever doesn't. */}
                  <SearchSelect
                    value={selectedOption}
                    onSelect={(item) => choose(item?.id || '', lang)}
                    search={searchTemplates}
                    placeholder="חיפוש או בחירת נוסח…"
                    wrapLabel
                    compact
                  />
                  {templates.length === 0 && (
                    <p className="mt-1.5 text-[12px] text-gray-500">
                      אין עדיין נוסחים פעילים. אפשר להוסיף בהגדרות CRM → נוסחים לתבניות ווטסאפ.
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[12.5px] font-semibold text-gray-600">שפה</span>
                  <div className="inline-flex rounded-xl border border-gray-300 bg-white p-0.5">
                    {LANGS.map((l) => {
                      const available = !selected || langAvailable(l.key);
                      const active = lang === l.key;
                      return (
                        <button
                          key={l.key}
                          type="button"
                          disabled={!available}
                          title={available ? undefined : 'אין נוסח בשפה הזו לתבנית שנבחרה'}
                          onClick={() => choose(templateId, l.key)}
                          // Amber, not green — green belongs to the send action
                          // and to delivery/success states in this modal.
                          className={`rounded-lg px-4 py-1.5 text-[13px] font-medium transition ${
                            active
                              ? 'bg-amber-500 text-white shadow-sm'
                              : available
                                ? 'text-gray-600 hover:bg-amber-50'
                                : 'cursor-not-allowed text-gray-300 line-through'
                          }`}
                        >
                          {l.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Which conversation this goes to — same resolution as the dock. */}
              {chats.length > 1 && (
                <div className="shrink-0">
                  <label className="mb-1.5 block text-[12.5px] font-semibold text-gray-700">שיחה</label>
                  <select
                    value={chatId}
                    onChange={(e) => setChatId(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-[13.5px] focus:border-emerald-500 focus:outline-none"
                  >
                    {chats.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.contact?.name || c.displayName || 'לא מזוהה'}
                        {c.account?.label ? ` · ${c.account.label}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {missingVars.includes('customer_first_name') && (
                <p className="shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
                  ללקוח אין שם פרטי שמור — הנוסח הותאם בלעדיו. אפשר להשלים ידנית לפני השליחה.
                </p>
              )}
              {resolveError && (
                <p className="shrink-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
                  {resolveError}
                </p>
              )}

              {/* 3 + 4 — the REAL composer, taking every remaining pixel. Its
                  שליחה button IS the send action (canonical path, untouched). */}
              {!chat ? (
                <div className="flex shrink-0 flex-col items-center gap-2 rounded-xl border border-dashed border-gray-300 px-6 py-10 text-center">
                  <WhatsAppLogo size={26} />
                  <p className="text-sm font-medium text-gray-700">אין עדיין שיחת WhatsApp בדיל הזה</p>
                  <p className="max-w-md text-[12.5px] leading-relaxed text-gray-500">
                    שיחות מתקשרות אוטומטית לפי מספר הטלפון של אנשי הקשר בדיל. אפשר לשלוח נוסח
                    ברגע שקיימת שיחה.
                  </p>
                </div>
              ) : (
                <div className="flex min-h-[240px] flex-1 flex-col overflow-hidden rounded-xl border border-gray-200">
                  <div className="flex shrink-0 items-center gap-2 bg-gray-50 px-3 py-1.5 text-[12px] text-gray-600">
                    <span className="font-medium text-gray-700">
                      {chat.contact?.name || chat.displayName || 'לא מזוהה'}
                    </span>
                    {chat.account?.label && <span>· {chat.account.label}</span>}
                    {resolving && <span className="mr-auto text-gray-400">מרכיב את הנוסח…</span>}
                  </div>
                  {!templateId ? (
                    <p className="flex flex-1 items-center justify-center px-4 py-10 text-center text-[13px] text-gray-400">
                      בחרו נוסח כדי לערוך ולשלוח.
                    </p>
                  ) : (
                    <ChatComposer
                      chat={chat}
                      dealId={dealId}
                      fill
                      // This is a message EDITOR, not a chat input: Enter inserts
                      // a newline and the שליחה button is the ONLY way to send.
                      // An accidental keystroke must never reach a customer.
                      enterSends={false}
                      persistDraft={false}
                      seed={seed}
                      onTextChange={setLiveText}
                      onSent={(msg) => {
                        onSent?.(msg);
                        onClose?.();
                      }}
                      onScheduled={() => {
                        onSent?.(null);
                        onClose?.();
                      }}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </Dialog>

      <ConfirmDialog
        open={!!pendingSwitch}
        title="להחליף את הנוסח?"
        body={'ערכתם את ההודעה. מעבר לנוסח או לשפה אחרת יחליף את מה שכתבתם.'}
        confirmLabel="החלף"
        cancelLabel="השאר כפי שהוא"
        danger
        onCancel={() => setPendingSwitch(null)}
        onConfirm={() => {
          const next = pendingSwitch;
          setPendingSwitch(null);
          applyChoice(next.templateId, next.lang);
        }}
      />
    </>
  );
}
