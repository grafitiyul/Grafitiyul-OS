import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';

// Settings card that binds a business PURPOSE (סיכום סיור / שיחת תיאום /
// future) to the questionnaire TEMPLATE that serves it — the ONE generic
// surface both Tours settings cards use (no duplicate questionnaire logic).
//
// States it renders honestly:
//   • no template selected      → "לא נבחרה תבנית", picker + create button
//   • selected, no published    → amber warning ("לא ניתן למלא עדיין")
//   • selected + published      → green "מוכן" + version number
// Never hardcodes questionnaire content — the admin authors it in the builder.

export default function QuestionnairePurposeCard({ purpose, title, description }) {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [meta, list] = await Promise.all([
        api.questionnaires.purposes(),
        api.questionnaires.list({ purpose }),
      ]);
      const entry = (meta.purposes || []).find((p) => p.key === purpose);
      const cfgTemplate = entry?.config?.template || null;
      setTemplates(list);
      setSelectedId(cfgTemplate?.id || '');
      setSelected(cfgTemplate);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [purpose]);

  useEffect(() => {
    load();
  }, [load]);

  const select = async (templateId) => {
    setSaving(true);
    setError('');
    try {
      const cfg = await api.questionnaires.setPurposeConfig(purpose, templateId || null);
      setSelectedId(cfg.template?.id || '');
      setSelected(cfg.template || null);
    } catch (e) {
      setError(e.payload?.error === 'template_purpose_mismatch' ? 'התבנית שנבחרה שייכת לייעוד אחר' : e.message);
    } finally {
      setSaving(false);
    }
  };

  const createTemplate = async () => {
    setSaving(true);
    setError('');
    try {
      const t = await api.questionnaires.create({ internalName: title, purpose });
      await api.questionnaires.setPurposeConfig(purpose, t.id);
      navigate(`/admin/questionnaires/${t.id}`);
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  };

  const published = selected?.currentVersion || null;

  return (
    <section className="bg-white border border-gray-200 rounded-2xl shadow-sm">
      <div className="px-5 pt-4 pb-3 border-b border-gray-100 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-gray-900">📋 {title}</h2>
          <p className="text-[12.5px] text-gray-500 mt-0.5">{description}</p>
        </div>
        {!loading && selected ? (
          published ? (
            <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11.5px] font-medium text-emerald-700">
              ✓ מוכן · v{published.versionNo}
            </span>
          ) : (
            <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11.5px] font-medium text-amber-700">
              אין גרסה מפורסמת
            </span>
          )
        ) : null}
      </div>

      <div className="px-5 py-4">
        {loading ? (
          <div className="text-[13px] text-gray-400">טוען…</div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="h-10 min-w-[220px] flex-1 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                value={selectedId}
                disabled={saving}
                onChange={(e) => select(e.target.value)}
              >
                <option value="">— לא נבחרה תבנית —</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.internalName}</option>
                ))}
              </select>
              {selected ? (
                <button
                  type="button"
                  onClick={() => navigate(`/admin/questionnaires/${selected.id}`)}
                  className="rounded-lg border border-gray-300 px-3.5 py-2 text-[13px] font-medium text-gray-700 hover:bg-gray-50"
                >
                  ✎ עריכת התבנית
                </button>
              ) : null}
              <button
                type="button"
                disabled={saving}
                onClick={createTemplate}
                className="rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2 text-[13px] font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
              >
                + תבנית חדשה
              </button>
            </div>

            {!selected ? (
              <p className="text-[12.5px] text-gray-500">
                לא נבחרה תבנית — הטופס לא זמין למילוי עד שתיבחר תבנית עם גרסה מפורסמת.
              </p>
            ) : !published ? (
              <p className="text-[12.5px] text-amber-700">
                ⚠️ לתבנית אין גרסה מפורסמת — פתחו את הבילדר, בנו את השאלות ולחצו ״פרסום גרסה״.
                עד אז לא ניתן למלא את הטופס.
              </p>
            ) : null}
            {error ? <p className="text-[12.5px] text-red-600">{error}</p> : null}
          </div>
        )}
      </div>
    </section>
  );
}
