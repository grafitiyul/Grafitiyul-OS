import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api.js';
import Dialog from '../../common/Dialog.jsx';
import RichEditor from '../../../editor/RichEditor.jsx';
import RichText from '../../../editor/RichText.jsx';
import { primaryAction, runPrimaryAction } from './previewFlow.js';

// שליחת מייל אישור — the large preview dialog (Quote-Preview philosophy).
//
// Shows ONLY the actual sending language (recipient's language → Hebrew) with
// an explicit header; hover ✎ per editable section; every edit chooses between
// "this send only" (temporary — client state, consumed by the send, never
// stored) and "save for this deal's future confirmation emails" (persistent —
// DealConfirmation.overrideState). Exact quote semantics, including: a section
// carrying a temporary edit re-opens UNCHECKED so temp text is never silently
// promoted to persistent.

const WARNING_TEXT = {
  missing_content: 'חסר תוכן בשפת השליחה',
  missing_subject: 'חסר נושא לשפת השליחה',
  no_recipient_email: 'לאיש הקשר אין כתובת מייל',
  no_tour: 'אין סיור משויך — נקודת המפגש חסרה',
  missing_policy: 'מדיניות הביטול שנבחרה אינה זמינה עוד',
  missing_variable: 'משתנה ללא ערך בעסקה זו',
  unknown_variable: 'משתנה לא מוכר',
  // label carries the location name; configured under הגדרות CRM → מיקומים.
  missing_meeting_image: 'תמונת נקודת מפגש חסרה (הגדרות CRM → מיקומים)',
};
const INPUT =
  'h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';
const LABEL = 'block text-[12px] font-medium text-gray-600 mb-1';

const cloneState = (s) => (s ? JSON.parse(JSON.stringify(s)) : null);
const mergeState = (base, key, patch) => {
  const sections = { ...(base?.sections || {}) };
  sections[key] = { ...sections[key], ...patch };
  return { sections };
};
const withoutKey = (base, key) => {
  const sections = { ...(base?.sections || {}) };
  delete sections[key];
  return Object.keys(sections).length ? { sections } : null;
};

export default function ConfirmationEmailModal({ deal, onClose, onSent }) {
  const [data, setData] = useState(null); // compose result
  const [persistent, setPersistent] = useState(null); // DealConfirmation.overrideState
  const [temps, setTemps] = useState(null); // one-shot overlay, consumed by send
  const [editing, setEditing] = useState(null); // section being edited
  const [subject, setSubject] = useState('');
  const [toEmail, setToEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // 'sections' = per-section editing; 'final' = the exact assembled email body.
  const [viewMode, setViewMode] = useState('sections');
  // Explicit language choice. null = follow the contact's preference; setting
  // it RECOMPOSES through the canonical composer (never a visual translation).
  const [langChoice, setLangChoice] = useState(null);
  const [mismatch, setMismatch] = useState(null); // pending 3-option decision
  const [contactLangUpdated, setContactLangUpdated] = useState(false);

  const recompose = useCallback(
    async (overlay, language) => {
      const d = await api.confirmationEmail.compose(deal.id, {
        overrideOverlay: overlay || null,
        ...(language ? { language } : {}),
      });
      setData(d);
      return d;
    },
    [deal.id],
  );

  // Switching language re-runs the WHOLE composer in that language: sections,
  // subject, warnings and emailHtml are all rebuilt from canonical sources.
  async function switchLanguage(next) {
    if (next === lang) return;
    setBusy(true);
    setError(null);
    try {
      const d = await recompose(temps, next);
      setLangChoice(next);
      setSubject(d.subject || '');
    } catch (e) {
      setError(e.payload?.error || e.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let on = true;
    Promise.all([api.confirmationEmail.compose(deal.id, {}), api.confirmationEmail.dealState(deal.id)])
      .then(([d, s]) => {
        if (!on) return;
        setData(d);
        setPersistent(s.overrideState || null);
        setSubject(d.subject || '');
        setToEmail(d.recipient?.email || '');
      })
      .catch((e) => on && setError(e.payload?.error || e.message));
    return () => {
      on = false;
    };
  }, [deal.id]);

  const lang = data?.language || 'he';
  const headerLabel = lang === 'en' ? 'Preview — English' : 'תצוגה מקדימה — עברית';
  const isTemp = (id) => !!temps?.sections?.[id];

  async function saveOverride(section, { html, title, applyFuture }) {
    if (applyFuture) {
      const next = mergeState(persistent, section.id, { html, ...(title ? { title } : {}) });
      await api.confirmationEmail.saveOverrides(deal.id, { overrideState: next });
      setPersistent(next);
      // A promoted edit must not stay shadowed by a temp copy (quote rule).
      const nextTemps = withoutKey(temps, section.id);
      setTemps(nextTemps);
      await recompose(nextTemps, langChoice);
    } else {
      const nextTemps = mergeState(temps, section.id, { html, ...(title ? { title } : {}) });
      setTemps(nextTemps);
      await recompose(nextTemps, langChoice);
    }
    setEditing(null);
  }

  async function resetOverride(section) {
    const nextTemps = withoutKey(temps, section.id);
    const nextPersistent = withoutKey(persistent, section.id);
    await api.confirmationEmail.saveOverrides(deal.id, { overrideState: nextPersistent });
    setPersistent(nextPersistent);
    setTemps(nextTemps);
    await recompose(nextTemps);
    setEditing(null);
  }

  // The customer's OWN preference, as stored on the contact.
  const contactLang = data?.recipient?.language === 'en' ? 'en' : 'he';
  const languageOverridden = !!langChoice && langChoice !== contactLang;
  // Primary action follows the deal status: not-WON ⇒ transition-then-send.
  const action = primaryAction(data?.dealStatus);

  // The canonical WON transition, through the SAME deal endpoint the Deal UI
  // uses (validation checklist, tour creation, changelog, effects). The flag
  // suppresses the automatic won-hook send: the operator is sending from this
  // preview, so the hook must not queue a second email.
  async function transitionToWon() {
    try {
      await api.deals.update(deal.id, { status: 'won', suppressConfirmationEmail: true });
      return { ok: true };
    } catch (e) {
      const missing = e.payload?.missing;
      if (Array.isArray(missing) && missing.length) {
        return { ok: false, error: `חסרים פרטים לסגירת העסקה: ${missing.map((m) => m.labelHe || m.field).join(', ')}` };
      }
      return { ok: false, error: e.payload?.error || e.message };
    }
  }

  async function doSendRequest({ contactLanguageUpdated = false } = {}) {
    try {
      const result = await api.confirmationEmail.send(deal.id, {
        overrideOverlay: temps || null,
        subject: subject.trim(),
        to: toEmail.trim(),
        ...(langChoice ? { language: langChoice } : {}),
        acknowledgeWarnings: true,
        languageOverridden,
        contactLanguageUpdated: contactLanguageUpdated || contactLangUpdated,
      });
      // The response carries the canonical delivery state — handed back so the
      // caller's toast never claims more than actually happened.
      return { ok: true, result };
    } catch (e) {
      const code = e.payload?.error;
      return {
        ok: false,
        error:
          code === 'duplicate_send'
            ? 'מייל אישור נשלח ממש עכשיו — המתינו רגע לפני שליחה חוזרת.'
            : code === 'no_connected_account'
              ? 'אין חשבון Gmail מחובר — חברו חשבון בהגדרות המייל.'
              : WARNING_TEXT[code] || 'שגיאה בשליחה: ' + (code || e.message),
      };
    }
  }

  // Primary action. For a deal that is not yet WON this transitions FIRST and
  // sends only on success (previewFlow.runPrimaryAction pins that order); a
  // failed transition leaves the operator in the preview with every edit
  // intact and nothing sent.
  async function doSend({ contactLanguageUpdated = false } = {}) {
    setBusy(true);
    setError(null);
    try {
      const out = await runPrimaryAction({
        dealStatus: data?.dealStatus,
        transition: transitionToWon,
        send: () => doSendRequest({ contactLanguageUpdated }),
      });
      if (out.sent) {
        onSent?.(out.result);
        onClose();
        return;
      }
      setError(
        out.transitioned
          ? out.error
          : `לא ניתן היה להפוך את העסקה ל-WON — ${out.error}. לא נשלח מייל.`,
      );
      // A successful transition changes the deal: recompose so the preview
      // reflects the new status (and the button becomes a plain send).
      if (out.transitioned) await recompose(temps, langChoice).catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  // Send gate: a language that differs from the contact's stored preference
  // must be an explicit decision, never a silent one-off. It is asked BEFORE
  // any WON transition, so closing the dialog changes nothing at all.
  function send() {
    if (languageOverridden) {
      setMismatch({ from: contactLang, to: langChoice });
      return;
    }
    doSend();
  }

  // "שנה את שפת ההתקשרות" — updates the CONTACT (canonical field, normal
  // contact audit history), then sends. Never the org/guide/deal language.
  async function changeContactLanguageAndSend() {
    const contactId = data?.recipient?.contactId;
    if (!contactId) {
      setError('אין איש קשר לעדכון שפה.');
      setMismatch(null);
      return;
    }
    setBusy(true);
    try {
      await api.contacts.update(contactId, { communicationLanguage: langChoice });
      setContactLangUpdated(true);
      setMismatch(null);
      await doSend({ contactLanguageUpdated: true });
    } catch (e) {
      setError('עדכון שפת ההתקשרות נכשל: ' + (e.payload?.error || e.message));
      setMismatch(null);
    } finally {
      setBusy(false);
    }
  }

  const footer = data && (
    <div className="flex w-full items-center gap-3" dir="rtl">
      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="block">
          <span className={LABEL}>נמען</span>
          <input value={toEmail} onChange={(e) => setToEmail(e.target.value)} dir="ltr" className={INPUT} />
        </label>
        <label className="block">
          <span className={LABEL}>נושא</span>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} dir={lang === 'en' ? 'ltr' : 'rtl'} className={INPUT} />
        </label>
      </div>
      {/* Primary action. A deal that is not yet WON gets the green
          transition-then-send button — there is no "send anyway" path. */}
      <button
        type="button"
        onClick={send}
        disabled={busy || !subject.trim() || !toEmail.trim()}
        className={`h-10 shrink-0 self-end rounded-lg px-6 text-sm font-medium text-white shadow-sm disabled:opacity-50 ${
          action.kind === 'won_and_send'
            ? 'bg-emerald-600 hover:bg-emerald-700'
            : 'bg-blue-600 hover:bg-blue-700'
        }`}
      >
        {busy ? 'שולח…' : action.labelHe}
      </button>
    </div>
  );

  return (
    <Dialog
      open
      onClose={editing ? () => setEditing(null) : onClose}
      title={`שליחת מייל אישור — ${headerLabel}`}
      size="2xl"
      footer={footer}
    >
      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>
      )}
      {!data ? (
        <div className="py-16 text-center text-sm text-gray-400">טוען תצוגה מקדימה…</div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2" dir="rtl">
            {/* The resolver's choice — always visible before sending. */}
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-900 px-3 py-1 text-[12px] font-medium text-white">
              תבנית: {data.template.internalName}
            </span>
            {/* Language switch — recomposes the WHOLE email through the
                canonical composer in that language. */}
            <span className="inline-flex overflow-hidden rounded-full border border-gray-200">
              {[{ v: 'he', label: 'עברית' }, { v: 'en', label: 'English' }].map((o) => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => switchLanguage(o.v)}
                  disabled={busy}
                  className={`px-3 py-1 text-[12px] font-medium transition ${
                    lang === o.v ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </span>
            {languageOverridden && (
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11.5px] text-amber-700 ring-1 ring-amber-200">
                שונה משפת ההתקשרות של הלקוח ({contactLang === 'en' ? 'English' : 'עברית'})
              </span>
            )}
            <div className="ms-auto flex items-center gap-1 rounded-lg bg-gray-100 p-0.5">
              <button
                type="button"
                onClick={() => setViewMode('sections')}
                className={`rounded-md px-2.5 py-1 text-[12px] font-medium ${viewMode === 'sections' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
              >
                עריכה
              </button>
              <button
                type="button"
                onClick={() => setViewMode('final')}
                title="הגוף המדויק שיישלח — אותו HTML אחד לאחד"
                className={`rounded-md px-2.5 py-1 text-[12px] font-medium ${viewMode === 'final' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
              >
                תצוגה סופית (כמו במייל)
              </button>
            </div>
          </div>

          {/* Specific, actionable warnings — each names its section. */}
          {data.warnings.length > 0 && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-[12.5px] text-amber-800" dir="rtl">
              {(() => {
                const missing = data.warnings.filter((w) => w.code === 'missing_content');
                const others = data.warnings.filter((w) => w.code !== 'missing_content');
                return (
                  <>
                    {missing.length > 0 && (
                      <div>
                        <span className="font-semibold">
                          ⚠ חסר תוכן ב{lang === 'en' ? 'אנגלית' : 'עברית'} (שפת השליחה):
                        </span>
                        <ul className="mt-1 list-disc pr-5 space-y-0.5">
                          {missing.map((w, i) => (
                            <li key={i}>
                              {w.label || w.sectionId}
                              {w.otherLanguageHasContent && (
                                <span className="text-amber-600"> — קיים תוכן בשפה השנייה</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {others.map((w, i) => (
                      <div key={`o${i}`} className={missing.length ? 'mt-1' : ''}>
                        ⚠ {WARNING_TEXT[w.code] || w.code}
                        {w.label && !['missing_subject', 'no_recipient_email'].includes(w.code) ? ` — ${w.label}` : ''}
                      </div>
                    ))}
                  </>
                );
              })()}
            </div>
          )}

          {viewMode === 'sections' && (
            <p className="mb-2 text-[11px] text-gray-400" dir="rtl">
              ריחוף על מקטע מציג ✎ עריכה — לעסקה זו בלבד, לא לתבנית.
            </p>
          )}

          <div className="rounded-xl bg-gray-100 p-2 sm:p-4">
            {viewMode === 'final' ? (
              /* The EXACT body the send mails (composer emailHtml, one string,
                 sanitized) — what Gmail receives, headings and images included. */
              <article
                dir={lang === 'en' ? 'ltr' : 'rtl'}
                className="rounded-lg bg-white px-6 py-10 lg:px-16 lg:py-12 shadow-sm ring-1 ring-gray-200/70"
              >
                <RichText html={data.emailHtml || ''} dir={lang === 'en' ? 'ltr' : 'rtl'} />
              </article>
            ) : (
            <article
              dir={lang === 'en' ? 'ltr' : 'rtl'}
              className="rounded-lg bg-white px-6 py-10 lg:px-16 lg:py-12 space-y-8 shadow-sm ring-1 ring-gray-200/70"
            >
              {data.sections.map((s) => (
                <section key={s.id} className="group relative">
                  {s.editable && (
                    <button
                      type="button"
                      onClick={() => setEditing(s)}
                      className="absolute -top-2 end-0 z-10 hidden group-hover:inline-flex items-center rounded-full bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white shadow [@media(hover:none)]:inline-flex"
                    >
                      ✎ עריכה
                    </button>
                  )}
                  <div className="absolute -top-2 start-0 flex gap-1">
                    {isTemp(s.id) && (
                      <span className="rounded-full bg-purple-100 text-purple-700 px-2 py-0.5 text-[10px] font-semibold" title="שינוי זמני — לשליחה הקרובה בלבד">
                        זמני
                      </span>
                    )}
                    {s.overridden && !isTemp(s.id) && (
                      <span className="rounded-full bg-teal-100 text-teal-700 px-2 py-0.5 text-[10px] font-semibold" title="מותאם לעסקה זו">
                        מותאם
                      </span>
                    )}
                  </div>
                  {/* INTERNAL provenance — office-only, never part of the
                      email. Answers "which wording is actually going out?"
                      before sending. */}
                  {s.sourceLabel && (
                    <div className="mb-1 flex items-center gap-1.5 text-[11px] text-gray-500">
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium">✓ {s.sourceLabel}</span>
                      <span className="text-gray-300">מידע פנימי — לא נשלח ללקוח</span>
                    </div>
                  )}
                  {/* special_terms carries one line per filler. */}
                  {s.key === 'special_terms' && (s.data?.items || []).some((i) => i.sourceLabel) && (
                    <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
                      {s.data.items.map((i, ix) => (
                        <span key={ix} className="rounded-full bg-gray-100 px-2 py-0.5 font-medium">
                          {i.labelHe}: ✓ {i.sourceLabel}
                        </span>
                      ))}
                      <span className="text-gray-300">מידע פנימי — לא נשלח ללקוח</span>
                    </div>
                  )}
                  {s.customerTitle && s.title && (
                    <h3 className="text-[15px] font-bold text-gray-900 mb-1.5">{s.title}</h3>
                  )}
                  {s.html ? (
                    <RichText html={s.html} dir={lang === 'en' ? 'ltr' : 'rtl'} />
                  ) : s.editable ? (
                    <button
                      type="button"
                      onClick={() => setEditing(s)}
                      className="w-full rounded-lg border-2 border-dashed border-gray-200 px-4 py-3 text-[12px] text-gray-400 hover:border-blue-300 hover:text-blue-500"
                    >
                      מקטע ריק בשפת השליחה — ✎ הוסיפו תוכן לשליחה זו
                    </button>
                  ) : null}
                </section>
              ))}
            </article>
            )}
          </div>

          {mismatch && (
            <LanguageMismatchDialog
              contactLang={mismatch.from}
              sendLang={mismatch.to}
              busy={busy}
              onOnce={() => { setMismatch(null); doSend(); }}
              onChangeContact={changeContactLanguageAndSend}
              onClose={() => setMismatch(null)}
            />
          )}

          {editing && (
            <OverrideEditor
              section={editing}
              hasTemp={isTemp(editing.id)}
              hasPersistent={!!persistent?.sections?.[editing.id]}
              onSave={(payload) => saveOverride(editing, payload)}
              onReset={() => resetOverride(editing)}
              onClose={() => setEditing(null)}
            />
          )}
        </>
      )}
    </Dialog>
  );
}

function OverrideEditor({ section, hasTemp, hasPersistent, onSave, onReset, onClose }) {
  const [html, setHtml] = useState(section.html || '');
  // A temp edit re-opens UNCHECKED — re-saving must never silently promote it.
  const [applyFuture, setApplyFuture] = useState(!hasTemp);
  const [busy, setBusy] = useState(false);

  const title = useMemo(
    () => `עריכה למייל של עסקה זו — ${section.title || 'מקטע'}`,
    [section],
  );

  async function save() {
    setBusy(true);
    try {
      await onSave({ html, applyFuture });
    } finally {
      setBusy(false);
    }
  }
  async function reset() {
    setBusy(true);
    try {
      await onReset();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      size="lg"
      footer={
        <div className="flex w-full items-center gap-2" dir="rtl">
          {(hasTemp || hasPersistent) && (
            <button
              type="button"
              onClick={reset}
              disabled={busy}
              title="מסיר את ההתאמה ומחזיר את המקטע לתוכן המקורי — גם במיילים עתידיים"
              className="text-[12px] text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md px-2 py-1"
            >
              ↺ שחזר טקסט ברירת מחדל
            </button>
          )}
          <div className="ms-auto flex gap-1.5">
            <button type="button" onClick={onClose} className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-600 hover:bg-gray-50">
              ביטול
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? 'שומר…' : 'שמור'}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-3" dir="rtl">
        <p className="rounded-lg bg-blue-50 px-3 py-2 text-[12px] text-blue-800">
          העריכה כאן שייכת לעסקה הזו בלבד — התבנית הגלובלית ומיילים שכבר נשלחו לעולם אינם משתנים.
        </p>
        {hasTemp && (
          <p className="rounded-lg bg-purple-50 px-3 py-2 text-[12px] text-purple-800">
            למקטע זה יש כרגע שינוי זמני — הוא יחול רק על השליחה הקרובה. סמנו את התיבה למטה כדי להפוך אותו לקבוע.
          </p>
        )}
        <div>
          <span className={LABEL}>תוכן</span>
          <RichEditor value={html} onChange={setHtml} ariaLabel="תוכן המקטע" minContentHeight={200} maxHeight="45vh" />
        </div>
        <label className="flex items-start gap-2 text-[13px] text-gray-800">
          <input type="checkbox" checked={applyFuture} onChange={(e) => setApplyFuture(e.target.checked)} className="mt-0.5" />
          <span>
            החל שינוי זה גם על מיילי אישור עתידיים של עסקה זו
            <span className="block text-[11px] text-gray-400">
              ללא סימון — השינוי חל רק על השליחה הקרובה; מיילים עתידיים יחזרו לנוסח הקבוע של העסקה.
            </span>
          </span>
        </label>
      </div>
    </Dialog>
  );
}

// Sending in a language the customer did not ask for is a decision, not a
// default. Three explicit outcomes (the WaiverDecisionDialog pattern: stacked
// option cards, no ambiguous OK/Cancel).
function LanguageMismatchDialog({ contactLang, sendLang, busy, onOnce, onChangeContact, onClose }) {
  const nameOf = (l) => (l === 'en' ? 'אנגלית' : 'עברית');
  return (
    <Dialog open onClose={onClose} title="שפת השליחה שונה משפת הלקוח" size="md-wide">
      <div className="space-y-3" dir="rtl">
        <p className="text-[13.5px] text-gray-700">
          שפת ההתקשרות של הלקוח היא <strong>{nameOf(contactLang)}</strong>, והמייל מוכן לשליחה ב
          <strong>{nameOf(sendLang)}</strong>.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={onOnce}
          className="block w-full rounded-lg border border-blue-300 bg-blue-50 px-3.5 py-2.5 text-right transition hover:bg-blue-100 disabled:opacity-50"
        >
          <span className="block text-[14px] font-semibold text-blue-900">
            שלח חד-פעמית ב{nameOf(sendLang)}
          </span>
          <span className="block text-[12px] text-blue-800/80">
            שפת ההתקשרות של הלקוח לא משתנה; מיילים עתידיים יישלחו ב{nameOf(contactLang)}.
          </span>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onChangeContact}
          className="block w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-right transition hover:bg-gray-50 disabled:opacity-50"
        >
          <span className="block text-[14px] font-semibold text-gray-900">
            שנה את שפת ההתקשרות של הלקוח ל{nameOf(sendLang)}
          </span>
          <span className="block text-[12px] text-gray-500">
            מעדכן את איש הקשר (עם רישום בהיסטוריה) ואז שולח. גם תקשורת עתידית תהיה ב{nameOf(sendLang)}.
          </span>
        </button>
        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-10 rounded-lg border border-gray-300 bg-white px-4 text-sm text-gray-600 hover:bg-gray-50"
          >
            סגור
          </button>
        </div>
      </div>
    </Dialog>
  );
}
