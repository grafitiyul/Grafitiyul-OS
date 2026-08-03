import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api.js';
import Dialog from '../../common/Dialog.jsx';
import RichEditor from '../../../editor/RichEditor.jsx';
import RichText from '../../../editor/RichText.jsx';

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

  const recompose = useCallback(
    async (overlay) => {
      const d = await api.confirmationEmail.compose(deal.id, { overrideOverlay: overlay || null });
      setData(d);
      return d;
    },
    [deal.id],
  );

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
      await recompose(nextTemps);
    } else {
      const nextTemps = mergeState(temps, section.id, { html, ...(title ? { title } : {}) });
      setTemps(nextTemps);
      await recompose(nextTemps);
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

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await api.confirmationEmail.send(deal.id, {
        overrideOverlay: temps || null,
        subject: subject.trim(),
        to: toEmail.trim(),
        acknowledgeWarnings: true,
      });
      onSent?.();
      onClose();
    } catch (e) {
      const code = e.payload?.error;
      setError(
        code === 'duplicate_send'
          ? 'מייל אישור נשלח ממש עכשיו — המתינו רגע לפני שליחה חוזרת.'
          : code === 'no_connected_account'
            ? 'אין חשבון Gmail מחובר — חברו חשבון בהגדרות המייל.'
            : WARNING_TEXT[code] || 'שגיאה בשליחה: ' + (code || e.message),
      );
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
      <button
        type="button"
        onClick={send}
        disabled={busy || !subject.trim() || !toEmail.trim()}
        className="h-10 shrink-0 self-end rounded-lg bg-blue-600 px-6 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
      >
        {busy ? 'שולח…' : 'שלח מייל אישור'}
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
            <span className="text-[12px] text-gray-500">
              תבנית: <span className="font-medium text-gray-700">{data.template.internalName}</span>
            </span>
            {data.warnings.length > 0 && (
              <span className="text-[12px] rounded-full bg-amber-50 text-amber-700 px-2.5 py-0.5 ring-1 ring-amber-200">
                ⚠ {data.warnings.map((w) => WARNING_TEXT[w.code] || w.code).join(' · ')}
              </span>
            )}
            <span className="text-[11px] text-gray-400 ms-auto">
              ריחוף על מקטע מציג ✎ עריכה — לעסקה זו בלבד, לא לתבנית.
            </span>
          </div>

          <div className="rounded-xl bg-gray-100 p-2 sm:p-4">
            <article
              dir={lang === 'en' ? 'ltr' : 'rtl'}
              className="mx-auto max-w-2xl rounded-lg bg-white px-6 py-8 sm:px-10 space-y-5 shadow-sm"
            >
              {data.sections.map((s) => (
                <section key={s.id} className="group relative">
                  {s.editable && (
                    <button
                      type="button"
                      onClick={() => setEditing(s)}
                      className="absolute -top-2 end-0 z-10 hidden group-hover:inline-flex items-center rounded-full bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white shadow"
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
          </div>

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
