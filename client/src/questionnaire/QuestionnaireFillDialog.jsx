import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import Dialog from '../admin/common/Dialog.jsx';
import QuestionnaireRuntime from './QuestionnaireRuntime.jsx';
import { resolveLocalized, isRtl } from '../../../shared/questionnaire/localized.mjs';
import RichText from '../editor/RichText.jsx';
import { SUBMISSION_STATUS_LABELS } from './constants.js';

// Staff-side questionnaire fill dialog — the ONE component every internal
// consumer opens (tour modal "טופס סיכום סיור"; the Guide Portal summary the
// same way). It owns the whole submission lifecycle against the generic
// engine:
//   start/resume (purpose+subject) → draft autosave → submit (422 errors
//   inline) → completed read-only view (+ מילוי מחדש via void).
// Not-configured / not-published states render honest empty states with a
// link to the builder — never a broken form.
//
// `transport` swaps the HTTP layer WITHOUT duplicating the flow: the default
// is the admin-session API; the Guide Portal passes portal-token endpoints.
// Shape: { load(), saveAnswers(id, answers), submit(id, answers),
//          voidSubmission(id), uploadAnswerFile(file) }.
// `adminLinks=false` hides the settings deep-links (guides can't open them).

const AUTOSAVE_MS = 800;

function adminTransport({ purpose, subjectType, subjectId }) {
  return {
    load: async () => {
      const started = await api.questionnaires.startSubmission({ purpose, subjectType, subjectId });
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
  title,
  onStatusChange, // notify host screen (chip refresh) on submit/void
  transport = null,
  adminLinks = true,
}) {
  const [phase, setPhase] = useState('loading'); // loading | error | fill | done | view
  const [errorInfo, setErrorInfo] = useState(null); // { code, message }
  const [data, setData] = useState(null); // { submission, runtime, prefill, rendered }
  const [serverErrors, setServerErrors] = useState(null);
  const [savedAt, setSavedAt] = useState(null);
  const answersRef = useRef({});
  const saveTimer = useRef(null);
  // Keep a stable transport for the dialog's lifetime — the default admin
  // transport is rebuilt from props on each load call.
  const t = transport || adminTransport({ purpose, subjectType, subjectId });
  const tRef = useRef(t);
  tRef.current = t;

  const load = useCallback(async () => {
    setPhase('loading');
    setServerErrors(null);
    setErrorInfo(null);
    try {
      const full = await tRef.current.load();
      setData(full);
      const draftAnswers = Object.fromEntries((full.submission.answers || []).map((a) => [a.questionKey, a.value]));
      // Prefill fills only what the draft hasn't answered yet.
      answersRef.current = { ...(full.prefill || {}), ...draftAnswers };
      setPhase(full.submission.status === 'draft' ? 'fill' : 'view');
    } catch (e) {
      const code = e.payload?.error;
      const messages = {
        purpose_not_configured: 'עדיין לא נבחרה תבנית שאלון לייעוד הזה.',
        no_published_version: 'לתבנית שנבחרה אין גרסה מפורסמת — יש לפרסם אותה בבילדר.',
        template_not_active: 'תבנית השאלון אינה פעילה.',
        subject_not_found: 'הישות שהטופס נקשר אליה לא נמצאה.',
        tour_cancelled: 'הסיור בוטל — לא נפתח טופס סיכום חדש.',
      };
      setErrorInfo({ code, message: messages[code] || e.message });
      setPhase('error');
    }
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

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title || (data ? resolveLocalized(data.runtime.template.title, lang, defLang) : 'שאלון')}
      size="lg"
    >
      <div dir="rtl" className="min-h-[200px]">
        {subjectTitle ? (
          <div className="mb-3 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-[12.5px] text-gray-600">
            {subjectTitle}
          </div>
        ) : null}

        {phase === 'loading' ? (
          <div className="py-14 text-center text-[13.5px] text-gray-400">טוען שאלון…</div>
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
                להגדרות סיורים
              </Link>
            ) : null}
          </div>
        ) : null}

        {phase === 'fill' && data ? (
          <>
            <QuestionnaireRuntime
              runtime={data.runtime}
              language={lang}
              initialAnswers={answersRef.current}
              serverErrors={serverErrors}
              onChange={scheduleAutosave}
              onSubmit={submit}
              submitLabel="הגשת הטופס"
              busyLabel="מגיש…"
              uploader={(file) => tRef.current.uploadAnswerFile(file)}
            />
            <div className="mt-1.5 text-[11.5px] text-gray-400">
              {savedAt ? `טיוטה נשמרה ${savedAt.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })} ✓` : 'טיוטה נשמרת אוטומטית תוך כדי מילוי'}
            </div>
          </>
        ) : null}

        {phase === 'done' ? (
          <div className="py-10 text-center">
            <div className="text-4xl">✅</div>
            {outro ? (
              <RichText html={outro} dir={isRtl(lang) ? 'rtl' : 'ltr'} className="mt-3" />
            ) : (
              <p className="mt-3 text-[15px] font-semibold text-gray-800">הטופס הוגש בהצלחה</p>
            )}
            <button
              type="button"
              onClick={onClose}
              className="mt-4 rounded-lg bg-gray-900 px-5 py-2 text-[13.5px] text-white hover:bg-gray-800"
            >
              סגירה
            </button>
          </div>
        ) : null}

        {phase === 'view' && data ? (
          <>
            <div className="mb-3 flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
              <span className="text-[13px] text-emerald-800">
                ✅ {SUBMISSION_STATUS_LABELS[data.submission.status] || data.submission.status}
                {data.submission.submittedAt
                  ? ` · ${new Date(data.submission.submittedAt).toLocaleDateString('he-IL')}`
                  : ''}
                {data.submission.submittedByName ? ` · ${data.submission.submittedByName}` : ''}
              </span>
              <button
                type="button"
                onClick={redo}
                className="rounded-lg border border-emerald-300 px-2.5 py-1 text-[12px] text-emerald-800 hover:bg-emerald-100"
                title="ביטול ההגשה הקיימת ופתיחת טופס חדש (ההיסטוריה נשמרת)"
              >
                מילוי מחדש
              </button>
            </div>
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
