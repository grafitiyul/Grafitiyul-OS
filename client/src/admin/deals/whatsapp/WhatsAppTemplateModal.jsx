import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../lib/api.js';
import Dialog from '../../common/Dialog.jsx';
import ConfirmDialog from '../../common/ConfirmDialog.jsx';
import WhatsAppLogo from '../../common/WhatsAppLogo.jsx';
import SearchSelect from '../../communication/SearchSelect.jsx';
import ChatComposer from '../../whatsapp/ChatComposer.jsx';
import AccountBubbles from '../../whatsapp/AccountBubbles.jsx';
import { useSubjectChats } from '../../whatsapp/useSubjectChats.js';

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

// "Which conversation" is answered by useSubjectChats — the SAME selection
// model the Deal's WhatsAppDock uses (contact × our number), so the two
// surfaces can never disagree about who this goes to or which of our numbers
// it leaves from. Picking a number here is also the global sending mode, so
// the dock follows, and vice versa.

const LANGS = [
  { key: 'he', label: 'עברית' },
  { key: 'en', label: 'English' },
];

export default function WhatsAppTemplateModal({ open, dealId, onClose, onSent }) {
  const [templates, setTemplates] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const [templateId, setTemplateId] = useState('');
  const [lang, setLang] = useState('he');

  const {
    loading: chatsLoading,
    contacts,
    primaryContactId,
    activeContact,
    accounts,
    activeAccountId,
    activeChat: chat,
    chatByAccount,
    unreadByAccount,
    selectContact,
    selectAccount,
    adoptChat,
  } = useSubjectChats('deal', dealId, { enabled: open });

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
  // from a Deal). The conversation itself comes from the shared hook above.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadError(null);
    api.whatsappTemplates
      .list(true)
      .then((list) => !cancelled && setTemplates(list))
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
        // A compact, centred application dialog — NOT a workspace. Width comes
        // from Dialog's existing maxWidthPx prop (no new size, no change to the
        // shared component); height is content-driven and capped by Dialog's own
        // 90vh, so the panel is only as tall as it needs to be.
        maxWidthPx={640}
        ariaLabel="שליחת תבנית ווטסאפ"
        title={
          <span className="flex items-center gap-2">
            <WhatsAppLogo size={18} />
            תבנית ווטסאפ
          </span>
        }
        contentClassName="flex flex-col overflow-y-auto"
      >
        <div dir="rtl" className="flex flex-col gap-2.5 px-4 pb-4 pt-3">
          {loadError ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
              טעינה נכשלה: <span dir="ltr" className="font-mono">{loadError}</span>
            </p>
          ) : !templates || chatsLoading ? (
            <p className="py-12 text-center text-sm text-gray-400">טוען…</p>
          ) : (
            <>
              {/* Row 1 — WHO this goes to and FROM WHICH of our numbers. The
                  same two axes as the Deal's WhatsApp panel, in the same order,
                  through the same shared control. */}
              <div className="flex min-h-[26px] flex-wrap items-center gap-x-3 gap-y-1.5">
                {contacts.length > 1 ? (
                  <select
                    value={activeContact?.id || ''}
                    onChange={(e) => selectContact(e.target.value)}
                    aria-label="בחירת איש הקשר"
                    className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-[12.5px] focus:border-emerald-500 focus:outline-none"
                  >
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.id === primaryContactId ? ' ★' : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  activeContact && (
                    <span className="truncate text-[12.5px] font-medium text-gray-700">{activeContact.name}</span>
                  )
                )}
                <AccountBubbles
                  accounts={accounts}
                  activeId={activeAccountId}
                  chatByAccount={chatByAccount}
                  unreadByAccount={unreadByAccount}
                  onSelect={selectAccount}
                />
                {resolving && <span className="shrink-0 text-[12px] text-gray-400">מרכיב את הנוסח…</span>}
              </div>

              {/* Row 2 — search + language. The search takes ALL the space the
                  language control doesn't: no dead gap beside it. */}
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  {/* ONE searchable field — the shared GOS combobox (portal list,
                      type-to-filter, arrow/Enter/Escape, RTL). `compact` trims
                      padding only; the type size is unchanged, and wrapLabel keeps
                      even the longest template name fully readable. */}
                  <SearchSelect
                    value={selectedOption}
                    onSelect={(item) => choose(item?.id || '', lang)}
                    search={searchTemplates}
                    placeholder="חיפוש תבנית"
                    wrapLabel
                    compact
                  />
                </div>

                <div className="flex shrink-0 items-center gap-2">
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

              {templates.length === 0 && (
                <p className="shrink-0 text-[12px] text-gray-500">
                  אין עדיין נוסחים פעילים. אפשר להוסיף בהגדרות CRM → נוסחים לתבניות ווטסאפ.
                </p>
              )}

              {/* Language-aware, because with strict resolution this appears
                  whenever the name exists in the OTHER language — saying
                  "no first name saved" there would be untrue. */}
              {missingVars.includes('customer_first_name') && (
                <p className="shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
                  {lang === 'en'
                    ? 'לאיש הקשר אין שם פרטי באנגלית, ולכן הפנייה נפתחה בלי שם. בכוונה לא משתמשים בשם העברי בהודעה באנגלית — אפשר להשלים ידנית לפני השליחה.'
                    : 'לאיש הקשר אין שם פרטי בעברית, ולכן הפנייה נפתחה בלי שם. אפשר להשלים ידנית לפני השליחה.'}
                </p>
              )}
              {resolveError && (
                <p className="shrink-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
                  {resolveError}
                </p>
              )}

              {/* The REAL composer — its שליחה button IS the send action
                  (canonical path, untouched). The box has a DEFINITE height so
                  the dialog stays content-sized rather than stretching to the
                  viewport; max-h keeps it sane on short screens. */}
              {/* No conversation yet is NOT a blocked state: the composer is
                  mounted on a draft target and the template simply becomes the
                  first outgoing message, which creates the conversation. The
                  only genuine absences are having nobody to write to, or no
                  connected number to write from. */}
              {!chat ? (
                <div className="flex shrink-0 flex-col items-center gap-2 rounded-xl border border-dashed border-gray-300 px-6 py-10 text-center">
                  <WhatsAppLogo size={26} />
                  {!activeContact ? (
                    <>
                      <p className="text-sm font-medium text-gray-700">אין אנשי קשר בדיל הזה</p>
                      <p className="max-w-md text-[12.5px] leading-relaxed text-gray-500">
                        הוסיפו איש קשר לדיל כדי לשלוח לו נוסח.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-gray-700">אין מספר WhatsApp מחובר</p>
                      <p className="max-w-md text-[12.5px] leading-relaxed text-gray-500">
                        חברו מספר בהגדרות → תקשורת כדי לשלוח נוסחים.
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <div className="flex h-[500px] max-h-[58vh] shrink-0 flex-col overflow-hidden rounded-xl border border-gray-200">
                  {!templateId ? (
                    <p className="flex flex-1 items-center justify-center px-4 py-10 text-center text-[13px] text-gray-400">
                      בחרו נוסח כדי לערוך ולשלוח.
                    </p>
                  ) : (
                    <ChatComposer
                      // Deliberately NOT keyed on the conversation: switching the
                      // sending number must keep the wording the operator already
                      // edited, not reset it to the template.
                      chat={chat}
                      dealId={dealId}
                      onMaterialized={adoptChat}
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
