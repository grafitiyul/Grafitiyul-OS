import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import QuestionnaireRuntime from './QuestionnaireRuntime.jsx';
import LanguageSwitcher from './LanguageSwitcher.jsx';
import { resolveLocalized, isRtl } from '../../../shared/questionnaire/localized.mjs';
import RichText from '../editor/RichText.jsx';

// STAFF form page — /f/:token.
//
// The landing page for the scoped links in operational messages. It is a
// sibling of PublicFormPage rather than a branch inside it, for the same reason
// the server has two entry points: a staff capability and a customer capability
// have different rules, and sharing one component would mean one `if` away from
// serving an internal form on the customer surface.
//
// What a guide can reach from here: this form. There is no navigation, no tour
// list, no profile, no menu — not because they are hidden, but because this page
// never receives them.

const AUTOSAVE_MS = 900;

/** The read-only context block: what the guide needs for the call, never editable. */
function ContextBlock({ fields, dir }) {
  if (!fields?.length) return null;
  return (
    <section
      className="mb-5 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm"
      aria-label="פרטי הסיור"
    >
      <dl className="divide-y divide-gray-100">
        {fields.map((f) => (
          <div key={f.key} className="flex flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:gap-4">
            <dt className="shrink-0 text-[12.5px] font-medium text-gray-500 sm:w-40">{f.label}</dt>
            <dd className="min-w-0 flex-1 text-[14px] leading-relaxed text-gray-900">
              {f.rich
                ? <RichText html={f.value} dir={dir} />
                : <span className="break-words">{f.value}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default function StaffFormPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [serverErrors, setServerErrors] = useState(null);
  const [done, setDone] = useState(false);
  const [langOverride, setLangOverride] = useState(null);
  const answersRef = useRef({});
  const saveTimer = useRef(null);

  const load = useCallback(async () => {
    try {
      const payload = await api.questionnaires.staffForm.get(token);
      setData(payload);
      answersRef.current = { ...(payload.answers || {}) };
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
      api.questionnaires.staffForm.saveAnswers(token, answers).catch(() => {
        /* best-effort — submit re-sends everything */
      });
    }, AUTOSAVE_MS);
  };

  const submit = async (answers) => {
    clearTimeout(saveTimer.current);
    setServerErrors(null);
    try {
      await api.questionnaires.staffForm.submit(token, answers, langOverride || data?.language || null);
      setDone(true);
      window.scrollTo({ top: 0 });
    } catch (e) {
      if (e.status === 422 && e.payload?.problems) setServerErrors(e.payload.problems);
      else setNotFound(true);
    }
  };

  // Every rejection is the same generic message: a revoked link, a wrong token
  // and a token for another guide's form must be indistinguishable from here.
  if (notFound) {
    return (
      <div dir="rtl" className="flex min-h-screen items-center justify-center bg-gray-100 px-6">
        <div className="max-w-sm rounded-2xl border border-gray-200 bg-white px-6 py-10 text-center shadow-sm">
          <div className="text-4xl">🔗</div>
          <h1 className="mt-3 text-[16px] font-bold text-gray-900">הקישור אינו זמין</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-gray-500">
            ייתכן שהקישור הוחלף או שהטופס כבר אינו פעיל. אפשר לפנות למשרד לקבלת קישור מעודכן.
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

        {/* A submitted form shows the context that was FROZEN at submit; a live
            one shows current data. Same component, different source. */}
        <ContextBlock fields={data.context} dir={dir} />

        {done ? (
          <div className="rounded-2xl border border-emerald-200 bg-white px-6 py-12 text-center shadow-sm">
            <div className="text-5xl">✅</div>
            {outro ? (
              <RichText html={outro} dir={dir} className="mt-4" />
            ) : (
              <h2 className="mt-4 text-[17px] font-bold text-gray-900">
                {isRtl(lang) ? 'התקבל, תודה!' : 'Received, thank you!'}
              </h2>
            )}
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
            hints={data.hints}
            uploader={(file) => api.questionnaires.staffForm.upload(token, file)}
          />
        )}
      </div>
    </div>
  );
}
