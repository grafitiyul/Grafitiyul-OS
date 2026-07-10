import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import Dialog from '../common/Dialog.jsx';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import { purposeLabel, TEMPLATE_STATUS_LABELS } from '../../questionnaire/constants.js';

// Questionnaire templates — list + create. Each row opens the builder. This
// is the generic engine surface: purposes (tour summary / coordination /
// general) are just metadata here; consumer screens wire themselves via the
// purpose-config cards in Settings (Slices 2–3).

function StatusChip({ status }) {
  const tones = {
    draft: 'bg-amber-50 text-amber-700 border-amber-200',
    active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    archived: 'bg-gray-100 text-gray-500 border-gray-200',
  };
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-[11.5px] ${tones[status] || tones.draft}`}>
      {TEMPLATE_STATUS_LABELS[status] || status}
    </span>
  );
}

export default function QuestionnairesPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState(null);
  const [purposes, setPurposes] = useState([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [error, setError] = useState('');

  const load = async () => {
    const [list, meta] = await Promise.all([api.questionnaires.list(), api.questionnaires.purposes()]);
    setTemplates(list);
    setPurposes(meta.purposes || []);
  };

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  const remove = async () => {
    try {
      await api.questionnaires.remove(deleting.id);
      setDeleting(null);
      await load();
    } catch (e) {
      setDeleting(null);
      setError(e.payload?.error === 'template_has_submissions'
        ? 'לא ניתן למחוק שאלון שכבר יש לו הגשות — ניתן להעביר לארכיון'
        : e.message);
    }
  };

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-4xl mx-auto" dir="rtl">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">שאלונים</h1>
          <p className="text-[14px] text-gray-500 mt-1">
            מנוע שאלונים גנרי — תבניות, גרסאות והגשות. סיכומי סיור ושיחות תיאום מחוברים דרך הגדרות → סיורים.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-[13.5px] font-medium text-white hover:bg-blue-700"
        >
          + שאלון חדש
        </button>
      </header>

      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
          {error}
        </div>
      ) : null}

      <section className="bg-white border border-gray-200 rounded-2xl shadow-sm divide-y divide-gray-100">
        {templates === null ? (
          <div className="px-4 py-10 text-center text-[13.5px] text-gray-400">טוען…</div>
        ) : templates.length === 0 ? (
          <div className="px-4 py-12 text-center text-[13.5px] text-gray-400">
            אין שאלונים עדיין — צרו את הראשון עם ״+ שאלון חדש״.
          </div>
        ) : (
          templates.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => navigate(`/admin/questionnaires/${t.id}`)}
              className="flex w-full items-center gap-3 px-4 py-3 text-right hover:bg-gray-50"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[14.5px] font-medium text-gray-900">{t.internalName}</span>
                  <StatusChip status={t.status} />
                </div>
                <div className="mt-0.5 text-[12.5px] text-gray-500">
                  {purposeLabel(t.purpose)}
                  {t.currentVersion
                    ? ` · גרסה מפורסמת v${t.currentVersion.versionNo}`
                    : ' · אין גרסה מפורסמת'}
                  {t.versions?.some((v) => v.status === 'draft') ? ' · טיוטה בעריכה' : ''}
                  {` · ${t._count?.submissions ?? 0} הגשות`}
                </div>
              </div>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleting(t);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.stopPropagation();
                    setDeleting(t);
                  }
                }}
                className="shrink-0 rounded p-1.5 text-gray-300 hover:bg-red-50 hover:text-red-500"
                title="מחיקה"
              >
                🗑️
              </span>
            </button>
          ))
        )}
      </section>

      <CreateTemplateDialog
        open={createOpen}
        purposes={purposes}
        onClose={() => setCreateOpen(false)}
        onCreated={(t) => {
          setCreateOpen(false);
          navigate(`/admin/questionnaires/${t.id}`);
        }}
      />

      <ConfirmDialog
        open={!!deleting}
        title="מחיקת שאלון"
        body={`למחוק את "${deleting?.internalName}"? פעולה זו אפשרית רק כשאין הגשות.`}
        confirmLabel="מחיקה"
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={remove}
      />
    </div>
  );
}

function CreateTemplateDialog({ open, purposes, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('general');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setName('');
      setPurpose('general');
      setError('');
    }
  }, [open]);

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const t = await api.questionnaires.create({ internalName: name.trim(), purpose });
      onCreated(t);
    } catch (e) {
      setError(e.payload?.error === 'invalid_purpose' ? 'ייעוד לא תקין' : e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="שאלון חדש" size="sm">
      <div className="space-y-4 p-1">
        <div>
          <label className="mb-1 block text-[13px] font-medium text-gray-700">שם פנימי</label>
          <input
            autoFocus
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-[14px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            placeholder="למשל: שיחת תיאום — סיור פרטי"
          />
        </div>
        <div>
          <label className="mb-1 block text-[13px] font-medium text-gray-700">ייעוד</label>
          <select
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-[14px] bg-white"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
          >
            {purposes.map((p) => (
              <option key={p.key} value={p.key}>{p.labelHe || purposeLabel(p.key)}</option>
            ))}
          </select>
          <p className="mt-1 text-[11.5px] text-gray-500">
            הייעוד קובע לאיזה סוג ישות השאלון נקשר (סיור / הזמנה / כללי) — לא ניתן לשינוי אחרי היצירה.
          </p>
        </div>
        {error ? <p className="text-[12.5px] text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-[13.5px] text-gray-700 hover:bg-gray-50">
            ביטול
          </button>
          <button
            type="button"
            disabled={!name.trim() || busy}
            onClick={create}
            className="rounded-lg bg-blue-600 px-4 py-2 text-[13.5px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'יוצר…' : 'יצירה'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
