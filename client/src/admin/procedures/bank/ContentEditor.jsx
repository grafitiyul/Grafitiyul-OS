import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { api } from '../../../lib/api.js';
import { ITEM_KIND_LABELS, ITEM_KINDS } from './config.js';
import EditorTopBar from './EditorTopBar.jsx';
import RichEditor from '../../../editor/RichEditor.jsx';

const EMPTY = { title: '', body: '', internalNote: '' };

export default function ContentEditor({ mode }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { refresh } = useOutletContext();

  const [form, setForm] = useState(mode === 'new' ? EMPTY : null);
  const [original, setOriginal] = useState(mode === 'new' ? EMPTY : null);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);

  // Load existing item when editing.
  useEffect(() => {
    if (mode !== 'edit') return;
    let cancelled = false;
    setForm(null);
    setOriginal(null);
    setLoadError(null);
    (async () => {
      try {
        const item = await api.contentItems.get(id);
        if (cancelled) return;
        const data = {
          title: item.title || '',
          body: item.body || '',
          internalNote: item.internalNote || '',
        };
        setForm(data);
        setOriginal(data);
      } catch (e) {
        if (!cancelled) setLoadError(e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, mode]);

  // Reset on mode switch from edit -> new (fresh form).
  useEffect(() => {
    if (mode === 'new') {
      setForm(EMPTY);
      setOriginal(EMPTY);
      setLoadError(null);
    }
  }, [mode]);

  const dirty = form && original && JSON.stringify(form) !== JSON.stringify(original);
  const canSave = !!form && form.title.trim().length > 0 && (mode === 'new' || dirty);

  async function onSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        body: form.body,
        internalNote: form.internalNote.trim() || null,
      };
      if (mode === 'new') {
        const created = await api.contentItems.create(payload);
        await refresh();
        navigate(`/admin/procedures/bank/content/${created.id}`, { replace: true });
      } else {
        await api.contentItems.update(id, payload);
        setOriginal(form);
        await refresh();
      }
    } catch (e) {
      alert(`שמירה נכשלה: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (mode !== 'edit') return;
    if (!confirm('למחוק את הפריט?')) return;
    try {
      await api.contentItems.remove(id);
      await refresh();
      navigate('/admin/procedures/bank', { replace: true });
    } catch (e) {
      alert(e.message);
    }
  }

  if (loadError) {
    return <LoadError error={loadError} />;
  }
  if (!form) {
    return <div className="p-6 text-sm text-gray-500">טוען…</div>;
  }

  return (
    <div className="h-full w-full flex flex-col">
      <EditorTopBar
        kindLabel={ITEM_KIND_LABELS[ITEM_KINDS.CONTENT]}
        title={form.title}
        dirty={dirty}
        saving={saving}
        canSave={canSave}
        canDelete={mode === 'edit'}
        onSave={onSave}
        onDelete={onDelete}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-4 lg:p-8 space-y-6">
          <Section title="תצוגה לעובד">
            <Field label="כותרת">
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
                placeholder="כותרת הפריט"
              />
            </Field>
            <Field
              label="תוכן"
              hint="עיצוב, רשימות, קישורים ושדות דינמיים נתמכים. תמיכה במדיה תתווסף בשלב הבא."
            >
              <RichEditor
                value={form.body}
                onChange={(html) => setForm({ ...form, body: html })}
                ariaLabel="תוכן הפריט"
                minContentHeight={260}
              />
            </Field>
          </Section>

          <Section title="מטה-מידע">
            <Field label="הערה פנימית" hint="לא מוצג לעובדים. לשימוש פנימי בלבד.">
              <textarea
                value={form.internalNote}
                onChange={(e) => setForm({ ...form, internalNote: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm min-h-[80px] focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
                placeholder="הערה פנימית (אופציונלי)"
              />
            </Field>
          </Section>

          {mode === 'edit' && (
            <Section title="בשימוש">
              <div className="text-sm text-gray-500">
                מידע על זרימות שמשתמשות בפריט יוצג כאן בשלב הבא.
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section>
      <h2 className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-2">
        {title}
      </h2>
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
        {children}
      </div>
    </section>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-800 mb-1">{label}</label>
      {children}
      {hint && <div className="text-[11px] text-gray-500 mt-1">{hint}</div>}
    </div>
  );
}

function LoadError({ error }) {
  return (
    <div className="p-6 text-center">
      <div className="text-sm text-red-600 mb-2">שגיאה בטעינת הפריט</div>
      <div className="text-xs text-gray-500 font-mono" dir="ltr">
        {error}
      </div>
    </div>
  );
}
