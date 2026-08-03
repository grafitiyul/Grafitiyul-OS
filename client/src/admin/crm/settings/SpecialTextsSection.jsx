import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';
import { SettingsCard } from './catalogKit.jsx';
import RichEditor from '../../../editor/RichEditor.jsx';
import TranslateButton from '../../common/TranslateButton.jsx';

// טקסטים מיוחדים למייל אישור — office-curated wording options selected inside
// a Deal. Category-GENERIC: the server registry
// (src/confirmation/specialTexts.js) owns the category list; cancellation
// policies are simply the first. Each option: internal office name +
// explanation (deal-card selection UI only), customer text He/En
// (side-by-side, the only place bilingual editing happens), active, and ONE
// default (★) per category — the default is undeletable and stays active.

const INPUT =
  'h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';
const LABEL = 'block text-[12px] font-medium text-gray-600 mb-1';

const ERROR_TEXT = {
  internalName_required: 'שם פנימי חסר.',
  default_required: 'חייבת להיות ברירת מחדל — סמנו אפשרות אחרת כברירת מחדל במקום.',
  default_must_stay_active: 'ברירת המחדל חייבת להישאר פעילה.',
  default_undeletable: 'לא ניתן למחוק את ברירת המחדל — קבעו קודם ברירת מחדל אחרת.',
};
const errText = (e) => ERROR_TEXT[e?.payload?.error] || 'שגיאה: ' + (e?.payload?.error || e?.message);

export default function SpecialTextsSection() {
  const [data, setData] = useState(null); // { categories, texts }
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setData(await api.confirmationEmail.specialTexts());
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
        שגיאה בטעינה: <span dir="ltr" className="font-mono">{error}</span>
      </div>
    );
  }
  if (!data) return <div className="py-8 text-center text-sm text-gray-400">טוען…</div>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-gray-900">טקסטים מיוחדים למייל אישור</h2>
        <p className="text-[13.5px] text-gray-500 mt-0.5">
          אפשרויות נוסח שהמשרד בוחר מהן בתוך הדיל. הלקוח מקבל רק את הטקסט ללקוח.
        </p>
      </div>
      {data.categories.map((cat) => (
        <CategorySection
          key={cat.key}
          category={cat}
          texts={data.texts.filter((t) => t.category === cat.key)}
          editingId={editingId}
          setEditingId={setEditingId}
          onChange={refresh}
        />
      ))}
    </div>
  );
}

function CategorySection({ category, texts, editingId, setEditingId, onChange }) {
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  async function add(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const created = await api.confirmationEmail.createSpecialText({
        category: category.key,
        internalName: newName.trim(),
      });
      setNewName('');
      await onChange();
      setEditingId(created.id);
    } catch (e) {
      alert(errText(e));
    } finally {
      setBusy(false);
    }
  }
  async function makeDefault(t) {
    try {
      await api.confirmationEmail.updateSpecialText(t.id, { isDefault: true, active: true });
      await onChange();
    } catch (e) {
      alert(errText(e));
    }
  }
  async function toggleActive(t) {
    try {
      await api.confirmationEmail.updateSpecialText(t.id, { active: !t.active });
      await onChange();
    } catch (e) {
      alert(errText(e));
    }
  }
  async function remove(t) {
    if (!confirm(`למחוק את "${t.internalName}"?`)) return;
    try {
      await api.confirmationEmail.removeSpecialText(t.id);
      if (editingId === t.id) setEditingId(null);
      await onChange();
    } catch (e) {
      alert(errText(e));
    }
  }

  return (
    <SettingsCard
      title={category.labelHe}
      description={category.hintHe}
      footer={
        <form onSubmit={add} className="flex flex-col sm:flex-row gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="שם פנימי לאפשרות חדשה (למשל: מדיניות גמישה לסוכנים)"
            className={`flex-1 ${INPUT}`}
          />
          <button
            type="submit"
            disabled={busy || !newName.trim()}
            className="h-10 shrink-0 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'מוסיף…' : 'הוסף'}
          </button>
        </form>
      }
    >
      {texts.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-400">
          עדיין אין אפשרויות. הראשונה שתיווצר תוגדר כברירת המחדל.
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {texts.map((t) => (
            <li key={t.id}>
              <div className="flex items-center gap-3 px-2.5 py-2.5">
                <button
                  type="button"
                  onClick={() => makeDefault(t)}
                  disabled={t.isDefault}
                  title={t.isDefault ? 'ברירת המחדל' : 'קבע כברירת מחדל'}
                  className={`shrink-0 text-[16px] ${t.isDefault ? 'text-amber-500' : 'text-gray-300 hover:text-amber-400'}`}
                >
                  ★
                </button>
                <button
                  onClick={() => setEditingId(editingId === t.id ? null : t.id)}
                  className="flex-1 min-w-0 text-start"
                >
                  <span className={`font-medium text-[14.5px] ${t.active ? 'text-gray-900' : 'text-gray-400'}`}>
                    {t.internalName}
                  </span>
                  {t.internalNote && (
                    <span className="block text-[12px] text-gray-400 mt-0.5 truncate">{t.internalNote}</span>
                  )}
                </button>
                {!t.active && (
                  <span className="shrink-0 text-[11px] rounded-full bg-gray-100 text-gray-500 px-2 py-0.5">לא פעיל</span>
                )}
                {!t.isDefault && (
                  <button
                    onClick={() => toggleActive(t)}
                    className="shrink-0 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md px-2 py-1 text-[12px] font-medium"
                  >
                    {t.active ? 'כבה' : 'הפעל'}
                  </button>
                )}
                <button
                  onClick={() => setEditingId(editingId === t.id ? null : t.id)}
                  className="shrink-0 text-blue-600 hover:bg-blue-50 rounded-md px-2 py-1 text-[12px] font-medium"
                >
                  {editingId === t.id ? 'סגור' : 'עריכה'}
                </button>
                {!t.isDefault && (
                  <button onClick={() => remove(t)} title="מחק" className="shrink-0 text-red-500 hover:bg-red-50 rounded-md p-1.5">
                    🗑
                  </button>
                )}
              </div>
              {editingId === t.id && (
                <SpecialTextEditor text={t} onSaved={onChange} onClose={() => setEditingId(null)} />
              )}
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}

function SpecialTextEditor({ text, onSaved, onClose }) {
  const [internalName, setInternalName] = useState(text.internalName);
  const [internalNote, setInternalNote] = useState(text.internalNote || '');
  const [bodyHe, setBodyHe] = useState(text.bodyHe || '');
  const [bodyEn, setBodyEn] = useState(text.bodyEn || '');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!internalName.trim()) return;
    setBusy(true);
    try {
      await api.confirmationEmail.updateSpecialText(text.id, {
        internalName: internalName.trim(),
        internalNote: internalNote.trim() || null,
        bodyHe: bodyHe || null,
        bodyEn: bodyEn || null,
      });
      await onSaved();
      onClose();
    } catch (e) {
      alert(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-2.5 mb-3 rounded-lg border border-blue-100 bg-blue-50/40 p-3 sm:p-4 space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <label className="block">
          <span className={LABEL}>שם פנימי (למשרד)</span>
          <input value={internalName} onChange={(e) => setInternalName(e.target.value)} className={INPUT} />
        </label>
        <label className="block">
          <span className={LABEL}>הסבר פנימי (מוצג למשרד בבחירה בדיל)</span>
          <input
            value={internalNote}
            onChange={(e) => setInternalNote(e.target.value)}
            className={INPUT}
            placeholder="מתי משתמשים באפשרות הזו…"
          />
        </label>
      </div>

      {/* Customer texts — bilingual side-by-side lives HERE (Settings), never
          in the Deal. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <span className={LABEL}>טקסט ללקוח (עברית)</span>
          <RichEditor value={bodyHe} onChange={setBodyHe} ariaLabel="טקסט ללקוח — עברית" minContentHeight={140} />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className={LABEL}>Customer text (English)</span>
            <TranslateButton getSource={() => bodyHe} getTarget={() => bodyEn} onResult={setBodyEn} />
          </div>
          <div dir="ltr">
            <RichEditor value={bodyEn} onChange={setBodyEn} ariaLabel="Customer text — English" minContentHeight={140} placeholder="Write here..." />
          </div>
        </div>
      </div>

      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={save}
          disabled={busy || !internalName.trim()}
          className="h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? 'שומר…' : 'שמור'}
        </button>
        <button type="button" onClick={onClose} className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-600 hover:bg-gray-50">
          סגור
        </button>
      </div>
    </div>
  );
}
