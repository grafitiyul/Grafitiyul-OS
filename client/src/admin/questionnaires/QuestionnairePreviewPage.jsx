import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import QuestionnaireRuntime from '../../questionnaire/QuestionnaireRuntime.jsx';
import { resolveLocalized } from '../../../../shared/questionnaire/localized.mjs';

// Builder preview — opens in a NEW WINDOW (product rule), renders the REAL
// fill runtime against the requested version (draft included) and never saves
// anything. Own top-level route (/q-preview/:versionId) so no admin shell
// chrome wraps the form.

export default function QuestionnairePreviewPage() {
  const { versionId } = useParams();
  const [runtime, setRuntime] = useState(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    api.questionnaires.getVersion(versionId).then(setRuntime).catch((e) => setError(e.message));
  }, [versionId]);

  if (error) {
    return <div className="p-10 text-center text-[14px] text-red-600" dir="rtl">{error}</div>;
  }
  if (!runtime) {
    return <div className="p-10 text-center text-[14px] text-gray-400" dir="rtl">טוען תצוגה מקדימה…</div>;
  }

  const lang = runtime.template.defaultLanguage;
  const title = resolveLocalized(runtime.template.title, lang, lang);
  const outro = resolveLocalized(runtime.version.outro, lang, lang);

  return (
    <div className="min-h-screen bg-gray-100" dir="rtl">
      <div className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="mb-4 text-xl font-bold text-gray-900">{title}</h1>
        {done ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-8 text-center">
            <div className="text-3xl">✅</div>
            <div className="mt-2 text-[15px] font-semibold text-emerald-800">
              {outro || 'תודה! (מסך הסיום)'}
            </div>
            <p className="mt-2 text-[12.5px] text-emerald-700">
              תצוגה מקדימה — שום תשובה לא נשמרה.
            </p>
            <button
              type="button"
              onClick={() => setDone(false)}
              className="mt-4 rounded-lg border border-emerald-300 px-4 py-1.5 text-[13px] text-emerald-800 hover:bg-emerald-100"
            >
              מילוי מחדש
            </button>
          </div>
        ) : (
          <QuestionnaireRuntime
            runtime={runtime}
            language={lang}
            previewBadge
            onSubmit={async () => setDone(true)}
            submitLabel="שליחה (תצוגה מקדימה)"
          />
        )}
      </div>
    </div>
  );
}
