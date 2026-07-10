import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import Dialog from '../common/Dialog.jsx';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import QuestionnaireRuntime from '../../questionnaire/QuestionnaireRuntime.jsx';
import { purposeLabel, SUBMISSION_STATUS_LABELS } from '../../questionnaire/constants.js';

// Admin submissions list — every response across the engine, filterable by
// purpose / subject type / status / template. Rows open the frozen read-only
// view (rendered from the version + answer snapshots — never mutable).
// "ביטול הגשה" (void) frees the subject's singleton slot; the row stays.

const STATUS_TONES = {
  draft: 'bg-amber-50 text-amber-700 border-amber-200',
  submitted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  reviewed: 'bg-blue-50 text-blue-700 border-blue-200',
  void: 'bg-gray-100 text-gray-400 border-gray-200',
};

const SUBJECT_TYPE_LABELS = { tour_event: 'סיור', booking: 'הזמנה' };

export default function QuestionnaireSubmissionsView() {
  const [rows, setRows] = useState(null);
  const [purposes, setPurposes] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [filters, setFilters] = useState({ purpose: '', subjectType: '', status: '', templateId: '' });
  const [viewing, setViewing] = useState(null); // submission id
  const [voiding, setVoiding] = useState(null); // submission row
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [list, meta, tpls] = await Promise.all([
        api.questionnaires.listSubmissions(Object.fromEntries(Object.entries(filters).filter(([, v]) => v))),
        api.questionnaires.purposes(),
        api.questionnaires.list(),
      ]);
      setRows(list);
      setPurposes(meta.purposes || []);
      setTemplates(tpls);
    } catch (e) {
      setError(e.message);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  const voidNow = async () => {
    try {
      await api.questionnaires.voidSubmission(voiding.id);
      setVoiding(null);
      await load();
    } catch (e) {
      setVoiding(null);
      setError(e.message);
    }
  };

  const sel = (key, options, placeholder) => (
    <select
      className="h-9 rounded-lg border border-gray-300 bg-white px-2 text-[12.5px]"
      value={filters[key]}
      onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.value }))}
    >
      <option value="">{placeholder}</option>
      {options.map(([v, label]) => (
        <option key={v} value={v}>{label}</option>
      ))}
    </select>
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {sel('purpose', purposes.map((p) => [p.key, p.labelHe || purposeLabel(p.key)]), 'כל הייעודים')}
        {sel('subjectType', Object.entries(SUBJECT_TYPE_LABELS), 'כל סוגי הישויות')}
        {sel('status', Object.entries(SUBMISSION_STATUS_LABELS), 'כל הסטטוסים')}
        {sel('templateId', templates.map((t) => [t.id, t.internalName]), 'כל התבניות')}
      </div>

      {error ? (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</div>
      ) : null}

      <section className="bg-white border border-gray-200 rounded-2xl shadow-sm divide-y divide-gray-100">
        {rows === null ? (
          <div className="px-4 py-10 text-center text-[13.5px] text-gray-400">טוען…</div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-12 text-center text-[13.5px] text-gray-400">אין הגשות תואמות.</div>
        ) : (
          rows.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50">
              <button type="button" onClick={() => setViewing(s.id)} className="min-w-0 flex-1 text-right">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13.5px] font-medium text-gray-900">
                    {s.subjectSnapshot?.title || s.template?.internalName || '—'}
                  </span>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${STATUS_TONES[s.status] || ''}`}>
                    {SUBMISSION_STATUS_LABELS[s.status] || s.status}
                  </span>
                </div>
                <div className="mt-0.5 text-[12px] text-gray-500">
                  {purposeLabel(s.purpose)}
                  {s.subjectType ? ` · ${SUBJECT_TYPE_LABELS[s.subjectType] || s.subjectType}` : ' · ללא ישות'}
                  {` · ${s.template?.internalName || ''} v${s.version?.versionNo ?? '?'}`}
                  {s.submittedByName ? ` · ${s.submittedByName}` : s.submittedByType === 'public' ? ' · לקוח' : ''}
                  {s.submittedAt
                    ? ` · הוגש ${new Date(s.submittedAt).toLocaleDateString('he-IL')}`
                    : ` · נפתח ${new Date(s.createdAt).toLocaleDateString('he-IL')}`}
                </div>
              </button>
              {s.status !== 'void' ? (
                <button
                  type="button"
                  onClick={() => setVoiding(s)}
                  title="ביטול ההגשה (משחרר את הטופס למילוי מחדש; השורה נשמרת)"
                  className="shrink-0 rounded p-1.5 text-gray-300 hover:bg-amber-50 hover:text-amber-600"
                >
                  ↩
                </button>
              ) : null}
            </div>
          ))
        )}
      </section>

      <SubmissionViewDialog id={viewing} onClose={() => setViewing(null)} />

      <ConfirmDialog
        open={!!voiding}
        title="ביטול הגשה"
        body="לבטל את ההגשה? השורה נשמרת בהיסטוריה, והטופס משתחרר למילוי מחדש עבור אותה ישות."
        confirmLabel="ביטול הגשה"
        danger
        onCancel={() => setVoiding(null)}
        onConfirm={voidNow}
      />
    </div>
  );
}

function SubmissionViewDialog({ id, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    setError('');
    if (id) api.questionnaires.getSubmission(id).then(setData).catch((e) => setError(e.message));
  }, [id]);

  if (!id) return null;
  return (
    <Dialog open onClose={onClose} title="צפייה בהגשה" size="lg">
      <div dir="rtl">
        {error ? <p className="text-[13px] text-red-600">{error}</p> : null}
        {!data && !error ? <div className="py-10 text-center text-[13px] text-gray-400">טוען…</div> : null}
        {data ? (
          <>
            {data.submission.subjectSnapshot?.title ? (
              <div className="mb-3 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-[12.5px] text-gray-600">
                {data.submission.subjectSnapshot.title}
              </div>
            ) : null}
            <QuestionnaireRuntime
              runtime={data.runtime}
              language={data.submission.language}
              readOnly
              initialAnswers={Object.fromEntries((data.submission.answers || []).map((a) => [a.questionKey, a.value]))}
            />
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
