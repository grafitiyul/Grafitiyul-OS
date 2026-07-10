import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import QuestionnaireRuntime from './QuestionnaireRuntime.jsx';
import LanguageSwitcher from './LanguageSwitcher.jsx';
import { resolveLocalized, isRtl } from '../../../shared/questionnaire/localized.mjs';

// PUBLIC customer form page — /form/:token. No login: the high-entropy link
// token is the whole capability (same philosophy as the public quote page).
// Mobile-first, calm, single column. Draft answers autosave so the customer
// can leave and come back on the same link; once submitted the link shows the
// frozen thank-you/read-only state — history never changes.

const AUTOSAVE_MS = 900;

export default function PublicFormPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [serverErrors, setServerErrors] = useState(null);
  const [done, setDone] = useState(false);
  // Manual language override — initial value comes from the link/subject
  // resolution chain; the customer may switch among supportedLanguages.
  const [langOverride, setLangOverride] = useState(null);
  const answersRef = useRef({});
  const saveTimer = useRef(null);

  const load = useCallback(async () => {
    try {
      const payload = await api.questionnaires.publicForm.get(token);
      setData(payload);
      answersRef.current = { ...(payload.prefill || {}), ...(payload.answers || {}) };
      if (payload.status !== 'draft') setDone(true);
    } catch {
      setNotFound(true);
    }
  }, [token]);

  useEffect(() => {
    load();
    return () => clearTimeout(saveTimer.current);
  }, [load]);

  const scheduleAutosave = (answers) => {
    answersRef.current = answers;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api.questionnaires.publicForm.saveAnswers(token, answers).catch(() => {
        /* best-effort — submit re-sends everything */
      });
    }, AUTOSAVE_MS);
  };

  const submit = async (answers) => {
    clearTimeout(saveTimer.current);
    setServerErrors(null);
    try {
      const langNow = langOverride || data?.language || null;
      await api.questionnaires.publicForm.submit(token, answers, langNow);
      setDone(true);
      window.scrollTo({ top: 0 });
    } catch (e) {
      if (e.status === 422 && e.payload?.problems) setServerErrors(e.payload.problems);
      else setNotFound(true);
    }
  };

  if (notFound) {
    return (
      <div dir="rtl" className="flex min-h-screen items-center justify-center bg-gray-100 px-6">
        <div className="max-w-sm rounded-2xl border border-gray-200 bg-white px-6 py-10 text-center shadow-sm">
          <div className="text-4xl">🔗</div>
          <h1 className="mt-3 text-[16px] font-bold text-gray-900">הקישור אינו זמין</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-gray-500">
            ייתכן שהקישור הוחלף או שהטופס אינו פעיל. אנא פנו אלינו לקבלת קישור מעודכן.
          </p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div dir="rtl" className="flex min-h-screen items-center justify-center bg-gray-100 text-[14px] text-gray-400">
        טוען…
      </div>
    );
  }

  const defLang = data.runtime.template.defaultLanguage;
  const lang = langOverride || data.language || defLang;
  const dir = isRtl(lang) ? 'rtl' : 'ltr';
  const title = resolveLocalized(data.runtime.template.title, lang, defLang);
  const outro = resolveLocalized(data.runtime.version.outro, lang, defLang);

  return (
    <div dir={dir} className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-xl px-4 py-8 sm:py-12">
        <header className="mb-5">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-xl font-bold tracking-tight text-gray-900">{title}</h1>
            <LanguageSwitcher
              languages={data.runtime.template.supportedLanguages}
              value={lang}
              onChange={setLangOverride}
            />
          </div>
          {data.subject?.title ? (
            <p className="mt-1 text-[13.5px] text-gray-500">
              {data.subject.title}
              {data.subject.subtitle ? ` · ${data.subject.subtitle}` : ''}
            </p>
          ) : null}
        </header>

        {done ? (
          <div className="rounded-2xl border border-emerald-200 bg-white px-6 py-12 text-center shadow-sm">
            <div className="text-5xl">✅</div>
            <h2 className="mt-4 text-[17px] font-bold text-gray-900">
              {outro || (isRtl(lang) ? 'תודה! הפרטים נקלטו בהצלחה.' : 'Thank you! Your details were received.')}
            </h2>
            <p className="mt-2 text-[13px] text-gray-500">
              {isRtl(lang) ? 'ניתן לסגור את העמוד.' : 'You may close this page.'}
            </p>
          </div>
        ) : (
          <QuestionnaireRuntime
            runtime={data.runtime}
            language={lang}
            initialAnswers={answersRef.current}
            serverErrors={serverErrors}
            onChange={scheduleAutosave}
            onSubmit={submit}
          />
        )}
      </div>
    </div>
  );
}
