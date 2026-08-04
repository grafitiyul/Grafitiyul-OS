import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import Dialog from '../admin/common/Dialog.jsx';
import QuestionnaireRuntime from './QuestionnaireRuntime.jsx';
import { resolveLocalized, isRtl } from '../../../shared/questionnaire/localized.mjs';
import RichText from '../editor/RichText.jsx';
import { SUBMISSION_STATUS_LABELS } from './constants.js';

// Staff-side questionnaire fill dialog — the ONE component every internal
// consumer opens (tour modal "טופס סיכום סיור" + "טופס שיחת תיאום"; the Guide
// Portal opens both the same way). It owns the whole submission lifecycle
// against the generic engine, driven by the server-computed `lifecycle`:
//   start/resume → autosave while working → "שלח" (422 errors inline) →
//   still editable after submit (tour-operational purposes) → frozen
//   read-only once the tour closes (historical record).
// Classic purposes (no lifecycle.editableAfterSubmit) keep the old
// submit-once behavior with מילוי מחדש via void.
// Not-configured / not-published states render honest empty states with a
// link to the builder — never a broken form.
//
// `transport` swaps the HTTP layer WITHOUT duplicating the flow: the default
// is the admin-session API; the Guide Portal passes portal-token endpoints.
// Shape: { load(), saveAnswers(id, answers), submit(id, answers),
//          voidSubmission(id), uploadAnswerFile(file) }.
// `adminLinks=false` hides the settings deep-links (guides can't open them).

const AUTOSAVE_MS = 800;

// LANGUAGE. Two independent things decide what this dialog shows:
//   * the SUBMISSION language (server-resolved: the customer's language for a
//     public form, the FILLING STAFF MEMBER's language for an internal one) —
//     it drives the admin-authored content and the text direction;
//   * this `strings` prop — the dialog's own chrome. Defaults below keep every
//     admin caller byte-identical; the Guide Portal passes its registry entry.
// Direction now follows the submission language instead of being pinned to
// RTL, so an English form no longer renders right-aligned.
const DEFAULT_STRINGS = {
  dialogFallbackTitle: 'שאלון',
  loading: 'טוען שאלון…',
  submittedBanner: 'הטופס הוגש',
  stillEditable: '— אפשר להמשיך לעדכן תשובות.',
  tourEndedEditable: 'הסיור הסתיים — אפשר עדיין לעדכן את התשובות',
  until: 'עד',
  autosaveIdle: 'התשובות נשמרות אוטומטית תוך כדי מילוי',
  autosaveAt: (time) => `נשמר אוטומטית ${time} ✓`,
  doneTitle: 'הטופס נשלח בהצלחה',
  close: 'סגירה',
  backToEdit: 'חזרה לעריכה',
  frozen: 'הסיור הסתיים — הטופס נשמר כתיעוד היסטורי ואינו ניתן לעריכה.',
  submittedAt: 'הוגש ב-',
  redo: 'מילוי מחדש',
  redoTitle: 'ביטול ההגשה הקיימת ופתיחת טופס חדש (ההיסטוריה נשמרת)',
  submit: 'שלח',
  submitting: 'שולח…',
  adminSettings: 'להגדרות סיורים',
  statuses: SUBMISSION_STATUS_LABELS,
  errors: {
    purpose_not_configured: 'עדיין לא נבחרה תבנית שאלון לייעוד הזה.',
    no_published_version: 'לתבנית שנבחרה אין גרסה מפורסמת — יש לפרסם אותה בבילדר.',
    template_not_active: 'תבנית השאלון אינה פעילה.',
    subject_not_found: 'הישות שהטופס נקשר אליה לא נמצאה.',
    tour_cancelled: 'הסיור בוטל — לא נפתח טופס סיכום חדש.',
    subject_closed: 'הסיור הסתיים — לא נפתח טופס חדש.',
    submission_frozen: 'הסיור הסתיים — הטופס נעול כתיעוד היסטורי.',
  },
};

/** BCP-47 tag for the dates this dialog prints, from the submission language. */
function localeFor(lang) {
  return lang === 'en' ? 'en-GB' : 'he-IL';
}

function adminTransport({ purpose, subjectType, subjectId, actorScope }) {
  return {
    load: async () => {
      const started = await api.questionnaires.startSubmission({ purpose, subjectType, subjectId, actorScope });
      return api.questionnaires.getSubmission(started.id);
    },
    saveAnswers: (id, answers) => api.questionnaires.saveAnswers(id, answers),
    submit: (id, answers) => api.questionnaires.submit(id, answers),
    voidSubmission: (id) => api.questionnaires.voidSubmission(id),
    uploadAnswerFile: (file) => api.questionnaires.uploadAnswerFile(file),
  };
}

export default function QuestionnaireFillDialog({
  open,
  onClose,
  purpose,
  subjectType,
  subjectId,
  actorScope = null, // perActor purposes (tour_summary): WHOSE submission
  title,
  onStatusChange, // notify host screen (chip refresh) on submit/void
  transport = null,
  adminLinks = true,
  strings = DEFAULT_STRINGS,
}) {
  const s = strings;
  const [phase, setPhase] = useState('loading'); // loading | error | fill | done | view
  const [errorInfo, setErrorInfo] = useState(null); // { code, message }
  const [data, setData] = useState(null); // { submission, runtime, prefill, rendered }
  const [serverErrors, setServerErrors] = useState(null);
  const [savedAt, setSavedAt] = useState(null);
  const answersRef = useRef({});
  const saveTimer = useRef(null);
  // Keep a stable transport for the dialog's lifetime — the default admin
  // transport is rebuilt from props on each load call.
  const t = transport || adminTransport({ purpose, subjectType, subjectId, actorScope });
  const tRef = useRef(t);
  tRef.current = t;
  const errorsRef = useRef(s.errors);
  errorsRef.current = s.errors;

  const load = useCallback(async () => {
    setPhase('loading');
    setServerErrors(null);
    setErrorInfo(null);
    try {
      const full = await tRef.current.load();
      setData(full);
      const savedAnswers = Object.fromEntries((full.submission.answers || []).map((a) => [a.questionKey, a.value]));
      // Prefill fills only what hasn't been answered yet.
      answersRef.current = { ...(full.prefill || {}), ...savedAnswers };
      // Server-computed lifecycle decides editability (submitted stays
      // editable for tour-operational purposes). Legacy payloads without a
      // lifecycle keep the classic draft-only rule.
      const editable = full.lifecycle ? full.lifecycle.editable : full.submission.status === 'draft';
      setPhase(editable ? 'fill' : 'view');
    } catch (e) {
      const code = e.payload?.error;
      setErrorInfo({ code, message: errorsRef.current[code] || e.message });
      setPhase('error');
    }
    // errorsRef keeps `load` stable while still reading the CURRENT wording —
    // adding `strings` to the dependency list would re-run the whole load on
    // every render of the host screen.
  }, [purpose, subjectType, subjectId]);

  useEffect(() => {
    if (open) load();
    return () => clearTimeout(saveTimer.current);
  }, [open, load]);

  const scheduleAutosave = (answers) => {
    answersRef.current = answers;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await tRef.current.saveAnswers(data.submission.id, answers);
        setSavedAt(new Date());
      } catch {
        /* autosave is best-effort; submit re-sends everything */
      }
    }, AUTOSAVE_MS);
  };

  const submit = async (answers) => {
    clearTimeout(saveTimer.current);
    setServerErrors(null);
    try {
      await tRef.current.submit(data.submission.id, answers);
      setPhase('done');
      onStatusChange?.('submitted');
    } catch (e) {
      if (e.status === 422 && e.payload?.problems) {
        setServerErrors(e.payload.problems);
      } else {
        setErrorInfo({ code: e.payload?.error, message: e.message });
        setPhase('error');
      }
    }
  };

  const redo = async () => {
    await tRef.current.voidSubmission(data.submission.id);
    onStatusChange?.('draft');
    await load();
  };

  if (!open) return null;

  const lang = data?.submission?.language || data?.runtime?.template?.defaultLanguage || 'he';
  const defLang = data?.runtime?.template?.defaultLanguage || 'he';
  const outro = data ? resolveLocalized(data.runtime.version.outro, lang, defLang) : '';
  const subjectTitle = data?.submission?.subjectSnapshot?.title || null;
  // Direction and date locale follow the SUBMISSION language, so an English
  // form reads left-to-right with English dates and a Hebrew one is unchanged.
  const dir = isRtl(lang) ? 'rtl' : 'ltr';
  const locale = localeFor(lang);
  const shortDate = (v) => new Date(v).toLocaleDateString(locale);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title || (data ? resolveLocalized(data.runtime.template.title, lang, defLang) : s.dialogFallbackTitle)}
      size="lg"
      dir={dir}
      closeAriaLabel={s.close}
      dialogAriaFallback={s.dialogFallbackTitle}
    >
      <div dir={dir} className="min-h-[200px]">
        {subjectTitle ? (
          <div className="mb-3 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-[12.5px] text-gray-600">
            {subjectTitle}
          </div>
        ) : null}

        {phase === 'loading' ? (
          <div className="py-14 text-center text-[13.5px] text-gray-400">{s.loading}</div>
        ) : null}

        {phase === 'error' ? (
          <div className="py-10 text-center">
            <div className="text-3xl">📋</div>
            <p className="mt-2 text-[14px] text-gray-700">{errorInfo?.message}</p>
            {adminLinks &&
            ['purpose_not_configured', 'no_published_version', 'template_not_active'].includes(errorInfo?.code) ? (
              <Link
                // Tours settings are category pages now — deep-link straight to
                // the category that configures THIS purpose.
                to={
                  purpose === 'tour_summary'
                    ? '/admin/settings/tours/summary'
                    : purpose === 'coordination'
                      ? '/admin/settings/tours/coordination'
                      : '/admin/settings/tours'
                }
                className="mt-3 inline-block rounded-lg border border-gray-300 px-4 py-1.5 text-[13px] text-gray-700 hover:bg-gray-50"
              >
                {s.adminSettings}
              </Link>
            ) : null}
          </div>
        ) : null}

        {phase === 'fill' && data ? (
          <>
            {data.submission.status !== 'draft' ? (
              <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800">
                ✅ {s.submittedBanner}
                {data.submission.submittedAt ? ` · ${shortDate(data.submission.submittedAt)}` : ''}
                {data.submission.submittedByName ? ` · ${data.submission.submittedByName}` : ''}
                {` ${s.stillEditable}`}
              </div>
            ) : null}
            {data.lifecycle?.structureFrozen && !data.lifecycle?.answersLocked ? (
              // The tour completed: definition is pinned, answers stay open
              // through the purpose's post-completion window (summary: 48h).
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
                ⏳ {s.tourEndedEditable}
                {data.lifecycle.lockAt
                  ? ` ${s.until} ${new Date(data.lifecycle.lockAt).toLocaleString(locale, {
                      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                    })}`
                  : ''}
                .
              </div>
            ) : null}
            <QuestionnaireRuntime
              runtime={data.runtime}
              language={lang}
              initialAnswers={answersRef.current}
              serverErrors={serverErrors}
              onChange={scheduleAutosave}
              onSubmit={submit}
              submitLabel={data.lifecycle?.submitLabel || s.submit}
              busyLabel={s.submitting}
              uploader={(file) => tRef.current.uploadAnswerFile(file)}
            />
            <div className="mt-1.5 text-[11.5px] text-gray-400">
              {savedAt
                ? s.autosaveAt(
                    savedAt.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
                  )
                : s.autosaveIdle}
            </div>
          </>
        ) : null}

        {phase === 'done' ? (
          <div className="py-10 text-center">
            <div className="text-4xl">✅</div>
            {outro ? (
              <RichText html={outro} dir={dir} className="mt-3" />
            ) : (
              <p className="mt-3 text-[15px] font-semibold text-gray-800">{s.doneTitle}</p>
            )}
            <div className="mt-4 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg bg-gray-900 px-5 py-2 text-[13.5px] text-white hover:bg-gray-800"
              >
                {s.close}
              </button>
              {data?.lifecycle?.editableAfterSubmit ? (
                <button
                  type="button"
                  onClick={load}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-[13.5px] text-gray-700 hover:bg-gray-50"
                >
                  {s.backToEdit}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {phase === 'view' && data ? (
          <>
            {data.lifecycle?.liveVersion && data.lifecycle?.answersLocked ? (
              <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] text-gray-600">
                📁 {s.frozen}
                {data.submission.submittedAt ? ` ${s.submittedAt}${shortDate(data.submission.submittedAt)}` : ''}
                {data.submission.submittedByName ? ` · ${data.submission.submittedByName}` : ''}
              </div>
            ) : (
              <div className="mb-3 flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                <span className="text-[13px] text-emerald-800">
                  ✅ {s.statuses[data.submission.status] || data.submission.status}
                  {data.submission.submittedAt ? ` · ${shortDate(data.submission.submittedAt)}` : ''}
                  {data.submission.submittedByName ? ` · ${data.submission.submittedByName}` : ''}
                </span>
                <button
                  type="button"
                  onClick={redo}
                  className="rounded-lg border border-emerald-300 px-2.5 py-1 text-[12px] text-emerald-800 hover:bg-emerald-100"
                  title={s.redoTitle}
                >
                  {s.redo}
                </button>
              </div>
            )}
            <QuestionnaireRuntime
              runtime={data.runtime}
              language={lang}
              readOnly
              initialAnswers={Object.fromEntries((data.submission.answers || []).map((a) => [a.questionKey, a.value]))}
            />
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
