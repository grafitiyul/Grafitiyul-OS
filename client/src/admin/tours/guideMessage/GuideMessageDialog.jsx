import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../lib/api.js';
import Dialog from '../../common/Dialog.jsx';
import ConfirmDialog from '../../common/ConfirmDialog.jsx';
import WhatsAppLogo from '../../common/WhatsAppLogo.jsx';
import SearchSelect from '../../communication/SearchSelect.jsx';
import AnchoredMenu from '../../common/AnchoredMenu.jsx';
import EmojiPickerPanel from '../../../lib/EmojiPickerPanel.jsx';
import { WhatsAppPreviewBubble } from '../../whatsapp/waPreview.jsx';
import { formatPhoneDisplay } from '../../../lib/phone.js';
import GuideTemplatesDialog from './GuideTemplatesDialog.jsx';

// "הודעה למדריך" — review a tour summary, answer the guide, in one place.
//
// A real composer, not a confirmation box: pick a wording, edit it, clear it,
// or write something entirely your own. Selecting a template POPULATES the
// editor; it never locks it.
//
// What this screen deliberately does NOT own:
//   who may receive  — the server resolves it from the tour's canonical guide
//                      assignments (tours/guides.js). Never from text, never
//                      the deal owner, never the reviewer.
//   what it says     — the server resolves the template through the canonical
//                      variable registry, including the natural tour date.
//   the preview      — WhatsAppPreviewBubble, the ONE WhatsApp renderer.
//   sending          — the canonical WhatsApp queue. This posts the exact
//                      string the preview is rendering; there is no second
//                      transform between them.
//
// Layout: two columns on desktop — write on the leading (right) side, see the
// message as it will arrive on the other. The preview is the point of the
// screen, so it gets real space rather than a two-line strip.

const LANGS = [
  { key: 'he', label: 'עברית' },
  { key: 'en', label: 'English' },
];

const RECIPIENT_PROBLEM = {
  missing_phone: 'אין מספר טלפון שמור',
  invalid_phone: 'מספר הטלפון לא תקין',
  no_person: 'המדריך לא מקושר לכרטיס צוות במערכת',
};

const SEND_ERROR = {
  recipient_required: 'צריך לבחור מדריך.',
  recipient_not_on_tour: 'המדריך שנבחר כבר לא משויך לסיור הזה.',
  account_required: 'צריך לבחור מספר שליחה.',
  unknown_account: 'מספר השליחה שנבחר אינו זמין.',
  content_required: 'אין תוכן לשליחה.',
  missing_phone: 'למדריך אין מספר טלפון שמור — אי אפשר לשלוח.',
  invalid_phone: 'מספר הטלפון של המדריך לא תקין.',
  no_person: 'המדריך לא מקושר לכרטיס צוות, ולכן אין לאן לשלוח.',
};

const roleLabel = (r) => (r.isLead ? 'מדריך ראשי' : r.role === 'guide' ? 'מדריך' : null);

export default function GuideMessageDialog({ open, tourEventId = null, reviewItemId = null, onClose, onSent }) {
  const [subject, setSubject] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [templates, setTemplates] = useState(null);

  const [personRefId, setPersonRefId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [lang, setLang] = useState('he');
  const [templateId, setTemplateId] = useState('');

  const [text, setText] = useState('');
  const [seedText, setSeedText] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState(null);
  const [missingVars, setMissingVars] = useState([]);
  const [pendingSwitch, setPendingSwitch] = useState(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const textareaRef = useRef(null);
  const emojiAnchorRef = useRef(null);
  // ONE idempotency key per composition. A double click, a slow network or a
  // retry after a timeout all carry the same key, so the queue replays the
  // first outcome instead of messaging the guide twice. It is only rerolled
  // when a NEW composition starts (the dialog reopens).
  const opIdRef = useRef(null);

  const loadTemplates = useCallback(() => {
    api.whatsappTemplates
      .list(true, 'guide')
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoadError(null);
    setSubject(null);
    opIdRef.current = `guide-msg-${(crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`)}`;
    api.guideMessage
      .subject({ tourEventId, reviewItemId })
      .then((s) => {
        if (cancelled) return;
        setSubject(s);
        setPersonRefId(s.defaultPersonRefId || '');
        setAccountId(s.defaultAccountId || '');
        setLang(s.defaultLanguage || 'he');
      })
      .catch((e) => !cancelled && setLoadError(e?.payload?.error || e.message));
    loadTemplates();
    return () => { cancelled = true; };
  }, [open, tourEventId, reviewItemId, loadTemplates]);

  // A composition is one-shot: reopening starts clean rather than resuming a
  // draft addressed to a guide the operator may no longer be looking at.
  useEffect(() => {
    if (open) return;
    setTemplateId('');
    setText('');
    setSeedText('');
    setMissingVars([]);
    setResolveError(null);
    setSendError(null);
    setOutcome(null);
    setPendingSwitch(null);
    setEmojiOpen(false);
  }, [open]);

  const recipient = useMemo(
    () => (subject?.recipients || []).find((r) => r.personRefId === personRefId) || null,
    [subject, personRefId],
  );

  // Switching guide changes who the variables resolve for, so the language
  // follows their own recorded preference — unless the operator already chose.
  const langTouched = useRef(false);
  useEffect(() => {
    if (!recipient || langTouched.current) return;
    setLang(recipient.language || 'he');
  }, [recipient]);

  const selected = (templates || []).find((t) => t.id === templateId) || null;
  const isDirty = text.trim() !== seedText.trim();

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

  const resolve = useCallback(
    async (id, language, person) => {
      if (!id) return;
      setResolving(true);
      setResolveError(null);
      setMissingVars([]);
      try {
        const r = await api.guideMessage.resolve({
          tourEventId, reviewItemId, personRefId: person, templateId: id, lang: language,
        });
        setText(r.text || '');
        setSeedText(r.text || '');
        setMissingVars(r.missingVariables || []);
      } catch (e) {
        setResolveError(
          e?.payload?.error === 'language_unavailable'
            ? 'לנוסח הזה אין תוכן בשפה שנבחרה. אפשר לבחור נוסח אחר, להחליף שפה, או פשוט לכתוב הודעה חופשית.'
            : 'טעינת הנוסח נכשלה — נסו שוב.',
        );
      } finally {
        setResolving(false);
      }
    },
    [tourEventId, reviewItemId],
  );

  // Applying a template/language choice throws away edits, so it asks first.
  function choose(nextTemplateId, nextLang) {
    if (isDirty && text.trim()) {
      setPendingSwitch({ templateId: nextTemplateId, lang: nextLang });
      return;
    }
    applyChoice(nextTemplateId, nextLang);
  }

  function applyChoice(nextTemplateId, nextLang) {
    setTemplateId(nextTemplateId);
    setLang(nextLang);
    setOutcome(null);
    setSendError(null);
    if (nextTemplateId) resolve(nextTemplateId, nextLang, personRefId);
    else {
      // "no template" is a legitimate choice: an empty editor to write in.
      setText('');
      setSeedText('');
      setMissingVars([]);
      setResolveError(null);
    }
  }

  function insertEmoji(emoji) {
    const el = textareaRef.current;
    if (!el) return setText((t) => t + emoji);
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + emoji.length, start + emoji.length);
    });
    return undefined;
  }

  const canSend = !!recipient?.canSend && !!accountId && !!text.trim() && !sending;

  async function send() {
    if (!canSend) return;
    setSending(true);
    setSendError(null);
    setOutcome(null);
    try {
      const r = await api.guideMessage.send({
        tourEventId,
        reviewItemId,
        personRefId,
        accountId,
        lang,
        text,
        idempotencyKey: opIdRef.current,
      });
      setOutcome(r);
      // Only a real terminal success closes the dialog. Anything else keeps the
      // wording on screen so the operator can act on what actually happened.
      if (r.status === 'sent') {
        onSent?.(r);
        onClose?.();
      } else if (r.status === 'failed' || r.status === 'skipped') {
        setSendError(r.failureReason || 'השליחה נכשלה.');
      }
    } catch (e) {
      const code = e?.payload?.error;
      setSendError(
        SEND_ERROR[code]
          || (code === 'unknown_tokens'
            ? `יש בהודעה משתנה שהמערכת לא מכירה: ${(e.payload.tokens || []).join(', ')}`
            : 'השליחה נכשלה — נסו שוב.'),
      );
    } finally {
      setSending(false);
    }
  }

  const tour = subject?.tour || null;
  const when = tour ? [tour.date, tour.startTime].filter(Boolean).join(' · ') : '';
  const langAvailable = (key) => (key === 'he' ? !!selected?.hasHe : !!selected?.hasEn);

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        size="2xl"
        ariaLabel="הודעה למדריך"
        title={
          <span className="flex items-center gap-2">
            <WhatsAppLogo size={18} />
            הודעה למדריך
            {tour ? (
              <span className="text-[12.5px] font-normal text-gray-500">
                {[tour.productName, when].filter(Boolean).join(' · ')}
              </span>
            ) : null}
          </span>
        }
        footer={
          <>
            {/* Template management lives in the corner as quiet secondary text:
                it is a settings action, not part of sending this message. */}
            <button
              type="button"
              onClick={() => setTemplatesOpen(true)}
              className="mr-0 ml-auto rounded-lg px-2 py-1.5 text-[12px] text-gray-500 underline-offset-2 hover:text-gray-800 hover:underline"
            >
              עריכת תבניות
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
            >
              ביטול
            </button>
            <button
              type="button"
              onClick={send}
              disabled={!canSend}
              className="rounded-lg bg-emerald-600 px-5 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              {sending ? 'שולח…' : 'שליחה'}
            </button>
          </>
        }
      >
        <div dir="rtl" className="space-y-3">
          {loadError ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
              טעינה נכשלה: <span dir="ltr" className="font-mono">{loadError}</span>
            </p>
          ) : !subject ? (
            <p className="py-14 text-center text-sm text-gray-400">טוען…</p>
          ) : subject.recipients.length === 0 ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
              לסיור הזה לא משויך מדריך, ולכן אין למי לשלוח. שייכו מדריך בכרטיס הסיור.
            </p>
          ) : (
            <>
              {/* Row 1 — WHO and FROM WHERE. Both are facts about the delivery,
                  so they sit together above the wording controls. */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-gray-200 bg-gray-50/70 px-3 py-2">
                <label className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 text-[12px] font-semibold text-gray-600">אל</span>
                  {subject.recipients.length > 1 ? (
                    <select
                      value={personRefId}
                      onChange={(e) => { setPersonRefId(e.target.value); langTouched.current = false; }}
                      className="min-w-0 rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-[13px] focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="">בחרו מדריך…</option>
                      {subject.recipients.map((r) => (
                        <option key={r.personRefId} value={r.personRefId} disabled={!r.canSend}>
                          {r.name}
                          {roleLabel(r) ? ` · ${roleLabel(r)}` : ''}
                          {r.submittedSummary ? ' · הגיש את הסיכום' : ''}
                          {r.canSend ? '' : ` — ${RECIPIENT_PROBLEM[r.state] || 'לא ניתן לשלוח'}`}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="truncate text-[13px] font-medium text-gray-800">
                      {subject.recipients[0].name}
                    </span>
                  )}
                  {recipient?.phone ? (
                    <span className="shrink-0 text-[11.5px] text-gray-500" dir="ltr">
                      {formatPhoneDisplay(recipient.phone)}
                    </span>
                  ) : null}
                </label>

                <label className="flex items-center gap-2">
                  <span className="shrink-0 text-[12px] font-semibold text-gray-600">מהמספר</span>
                  <select
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-[13px] focus:border-emerald-500 focus:outline-none"
                  >
                    {(subject.accounts || []).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                        {a.connected ? '' : ' (מנותק)'}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {recipient && !recipient.canSend ? (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
                  {RECIPIENT_PROBLEM[recipient.state] || 'לא ניתן לשלוח למדריך הזה'} — השלימו את הפרטים
                  בכרטיס הצוות כדי לשלוח.
                </p>
              ) : null}
              {!personRefId && subject.recipients.length > 1 ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
                  לסיור משויך יותר ממדריך אחד ואין מדריך ראשי — בחרו למי ההודעה נשלחת.
                  ההודעה נשלחת למדריך אחד בכל פעם.
                </p>
              ) : null}

              {/* Row 2 — the wording controls. */}
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <SearchSelect
                    value={selectedOption}
                    onSelect={(item) => choose(item?.id || '', lang)}
                    placeholder="בחירת תבנית (אפשר גם בלי)"
                    search={searchTemplates}
                    wrapLabel
                    compact
                  />
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-[12.5px] font-semibold text-gray-600">שפה</span>
                  <div className="inline-flex rounded-xl border border-gray-300 bg-white p-0.5">
                    {LANGS.map((l) => {
                      const available = !selected || langAvailable(l.key);
                      return (
                        <button
                          key={l.key}
                          type="button"
                          disabled={!available}
                          title={available ? undefined : 'אין נוסח בשפה הזו לתבנית שנבחרה'}
                          onClick={() => { langTouched.current = true; choose(templateId, l.key); }}
                          // Amber, not green — green is the send action here.
                          className={`rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition ${
                            lang === l.key
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

              {templates && templates.length === 0 ? (
                <p className="text-[12px] text-gray-500">
                  אין עדיין תבניות למדריכים. אפשר לכתוב הודעה חופשית, או להוסיף תבנית ב״עריכת תבניות״.
                </p>
              ) : null}
              {resolveError ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
                  {resolveError}
                </p>
              ) : null}
              {missingVars.length ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
                  חלק מהפרטים בנוסח לא קיימים במערכת ולכן נשארו ריקים
                  ({missingVars.join(', ')}). אפשר להשלים ידנית לפני השליחה.
                </p>
              ) : null}

              {/* Write on the leading side, see it exactly as it will arrive on
                  the other. Same string on both — no second transform. */}
              <div className="grid gap-3 md:grid-cols-2">
                <div className="flex flex-col">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-[12px] font-semibold text-gray-600">ההודעה</span>
                    {resolving ? <span className="text-[11.5px] text-gray-400">מרכיב את הנוסח…</span> : null}
                    <button
                      ref={emojiAnchorRef}
                      type="button"
                      onClick={() => setEmojiOpen((v) => !v)}
                      aria-label="הוספת אימוג׳י"
                      className="mr-auto rounded-lg px-1.5 py-0.5 text-[15px] leading-none text-gray-500 hover:bg-gray-100"
                    >
                      🙂
                    </button>
                  </div>
                  <textarea
                    ref={textareaRef}
                    dir="auto"
                    value={text}
                    onChange={(e) => { setText(e.target.value); setOutcome(null); }}
                    placeholder="כתבו כאן, או בחרו תבנית ואז ערכו."
                    // No keystroke sends: this is a message EDITOR and the
                    // שליחה button is the only send path.
                    className="h-[300px] max-h-[46vh] w-full resize-none rounded-xl border border-gray-300 px-3 py-2.5 text-[14px] leading-relaxed focus:border-emerald-500 focus:outline-none"
                  />
                  {/* Through the shared floating layer — the dialog body
                      scrolls, so an in-flow absolute panel would be clipped by
                      it and no z-index could fix that. */}
                  <AnchoredMenu
                    anchorRef={emojiAnchorRef}
                    open={emojiOpen}
                    onClose={() => setEmojiOpen(false)}
                    width={312}
                    align="start"
                    panelClassName="rounded-xl p-1"
                  >
                    <EmojiPickerPanel
                      onPick={(e) => { insertEmoji(e); setEmojiOpen(false); }}
                      width={300}
                      height={280}
                    />
                  </AnchoredMenu>
                  <p className="mt-1 text-[11px] text-gray-400">
                    עיצוב וואטסאפ נתמך: *מודגש*, _נטוי_, ~קו חוצה~.
                  </p>
                </div>

                <div className="flex flex-col">
                  <span className="mb-1 text-[12px] font-semibold text-gray-600">כפי שיתקבל אצל המדריך</span>
                  <WhatsAppPreviewBubble
                    markup={text}
                    className="h-[300px] max-h-[46vh] overflow-y-auto"
                    emptyText="ההודעה תוצג כאן…"
                  />
                </div>
              </div>

              {/* Outcome — the queue's own word, never a claim this screen made. */}
              {outcome && outcome.status !== 'sent' && !sendError ? (
                <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[12.5px] text-blue-800">
                  ההודעה בתור השליחה
                  {outcome.waitReason ? ` — ${outcome.waitReason}` : ''}
                  {outcome.effectiveAt
                    ? ` (תצא ב-${new Date(outcome.effectiveAt).toLocaleString('he-IL', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })})`
                    : ''}
                  . אפשר לסגור — היא תישלח מעצמה.
                </p>
              ) : null}
              {sendError ? (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
                  {sendError}
                </p>
              ) : null}
            </>
          )}
        </div>
      </Dialog>

      <ConfirmDialog
        open={!!pendingSwitch}
        title="להחליף את הנוסח?"
        body="ערכתם את ההודעה. מעבר לתבנית או לשפה אחרת יחליף את מה שכתבתם."
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

      <GuideTemplatesDialog
        open={templatesOpen}
        onClose={() => { setTemplatesOpen(false); loadTemplates(); }}
      />
    </>
  );
}
