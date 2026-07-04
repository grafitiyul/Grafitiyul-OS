import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';
import SettingsChrome from '../../settings/SettingsChrome.jsx';
import ReorderableList from '../../common/ReorderableList.jsx';
import { SettingsCard } from './catalogKit.jsx';
import RichEditor from '../../../editor/RichEditor.jsx';

// CRM settings → Quote Content Sections. Reusable fixed content blocks for
// FUTURE quote templates. Content management only — quote generation is not
// built yet. Each section: He/En title + He/En rich HTML (shared RichEditor,
// including its RTL/LTR writing-direction controls). Hebrew title required.

const INPUT =
  'h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';
const LABEL = 'block text-[12px] font-medium text-gray-600 mb-1';

// Which quote section a content row feeds. The composer renders FAQ / Cancellation
// / Participant-policy blocks from rows tagged with the matching category; an
// unassigned row appears in no quote section. Values mirror the composer + server.
const CATEGORY_OPTIONS = [
  { value: '', label: 'ללא שיוך (לא יופיע בהצעה)' },
  { value: 'faq', label: 'שאלות נפוצות' },
  { value: 'cancellation', label: 'מדיניות ביטול / דחייה' },
  { value: 'participant_policy', label: 'מדיניות שינוי כמות המשתתפים' },
];
const CATEGORY_LABEL = Object.fromEntries(CATEGORY_OPTIONS.map((o) => [o.value, o.label]));

function hasText(html) {
  return !!html && html.replace(/<[^>]*>/g, '').replace(/&nbsp;|\s/g, '') !== '';
}

export default function QuoteSectionsSettings() {
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [titleHe, setTitleHe] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setSections(await api.quoteSections.list());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function add(e) {
    e.preventDefault();
    if (!titleHe.trim()) return;
    setBusy(true);
    try {
      const created = await api.quoteSections.create({ titleHe: titleHe.trim() });
      setTitleHe('');
      await refresh();
      setEditingId(created.id); // open the new section straight into edit
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }
  async function reorder(ids) {
    try {
      await api.quoteSections.reorder(ids);
    } catch (e) {
      alert('שגיאה בעדכון הסדר: ' + e.message);
      refresh();
    }
  }
  async function toggleActive(item) {
    try {
      await api.quoteSections.update(item.id, { active: !item.active });
      await refresh();
    } catch (e) {
      alert('שגיאה: ' + e.message);
    }
  }
  async function remove(item) {
    if (!confirm(`למחוק את הסעיף "${item.titleHe}"?`)) return;
    try {
      await api.quoteSections.remove(item.id);
      if (editingId === item.id) setEditingId(null);
      await refresh();
    } catch (e) {
      alert('שגיאה במחיקה: ' + e.message);
    }
  }

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-3xl mx-auto">
      <header className="mb-8">
        <SettingsChrome />
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 mt-1">
          הצעות מחיר
        </h1>
        <p className="text-[15px] text-gray-500 mt-1.5 leading-relaxed">
          סעיפי תוכן קבועים לשימוש חוזר בהצעות מחיר עתידיות. כרגע ניהול תוכן בלבד
          — עדיין לא נבנית הפקת הצעות מחיר.
        </p>
      </header>

      {loading ? (
        <div className="py-16 text-center text-sm text-gray-400">טוען…</div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          שגיאה בטעינה: <span dir="ltr" className="font-mono">{error}</span>
        </div>
      ) : (
        <SettingsCard
          title="סעיפי תוכן"
          description="גררו לשינוי הסדר. לחצו על סעיף כדי לערוך כותרת ותוכן עשיר (עברית/אנגלית)."
          footer={
            <form onSubmit={add} className="flex flex-col sm:flex-row gap-2">
              <input
                value={titleHe}
                onChange={(e) => setTitleHe(e.target.value)}
                placeholder="כותרת סעיף חדש"
                className={`flex-1 ${INPUT}`}
              />
              <button
                type="submit"
                disabled={busy || !titleHe.trim()}
                className="h-10 shrink-0 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
              >
                {busy ? 'מוסיף…' : 'הוסף סעיף'}
              </button>
            </form>
          }
        >
          <ReorderableList
            items={sections}
            onReorder={reorder}
            emptyText="עדיין אין סעיפים. הוסיפו את הראשון למטה."
            renderRow={(item, { handle }) => (
              <div className="rounded-lg hover:bg-gray-50">
                <div className="flex items-center gap-3 px-2.5 py-2.5">
                  {handle}
                  <button
                    onClick={() =>
                      setEditingId(editingId === item.id ? null : item.id)
                    }
                    className="flex-1 min-w-0 text-start"
                  >
                    <span
                      className={`font-medium text-[15px] ${
                        item.active ? 'text-gray-900' : 'text-gray-400'
                      }`}
                    >
                      {item.titleHe}
                    </span>
                    {item.titleEn && (
                      <span className="text-[12px] text-gray-400 ms-2" dir="ltr">
                        {item.titleEn}
                      </span>
                    )}
                    <span className="block text-[11px] text-gray-400 mt-0.5">
                      <span className={item.category ? 'text-teal-700' : 'text-amber-600'}>
                        {CATEGORY_LABEL[item.category || ''] || 'ללא שיוך'}
                      </span>
                      {' · '}
                      {[
                        hasText(item.richTextHe) ? 'תוכן עברית' : null,
                        hasText(item.richTextEn) ? 'תוכן אנגלית' : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'אין תוכן עדיין'}
                    </span>
                  </button>
                  {!item.active && (
                    <span className="shrink-0 text-[11px] rounded-full bg-gray-100 text-gray-500 px-2 py-0.5">
                      לא פעיל
                    </span>
                  )}
                  <button
                    onClick={() => toggleActive(item)}
                    title={item.active ? 'כבה' : 'הפעל'}
                    className="shrink-0 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md px-2 py-1 text-[12px] font-medium"
                  >
                    {item.active ? 'כבה' : 'הפעל'}
                  </button>
                  <button
                    onClick={() =>
                      setEditingId(editingId === item.id ? null : item.id)
                    }
                    className="shrink-0 text-blue-600 hover:bg-blue-50 rounded-md px-2 py-1 text-[12px] font-medium"
                  >
                    {editingId === item.id ? 'סגור' : 'עריכה'}
                  </button>
                  <button
                    onClick={() => remove(item)}
                    title="מחק"
                    className="shrink-0 text-red-500 hover:bg-red-50 rounded-md p-1.5"
                  >
                    🗑
                  </button>
                </div>
                {editingId === item.id && (
                  <SectionEditor
                    item={item}
                    onClose={() => setEditingId(null)}
                    onSaved={refresh}
                  />
                )}
              </div>
            )}
          />
        </SettingsCard>
      )}
    </div>
  );
}

function SectionEditor({ item, onClose, onSaved }) {
  const [titleHe, setTitleHe] = useState(item.titleHe || '');
  const [titleEn, setTitleEn] = useState(item.titleEn || '');
  const [category, setCategory] = useState(item.category || '');
  const [richTextHe, setRichTextHe] = useState(item.richTextHe || '');
  const [richTextEn, setRichTextEn] = useState(item.richTextEn || '');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!titleHe.trim()) return;
    setBusy(true);
    try {
      await api.quoteSections.update(item.id, {
        titleHe: titleHe.trim(),
        titleEn: titleEn.trim() || null,
        category: category || null,
        richTextHe: richTextHe || null,
        richTextEn: richTextEn || null,
      });
      await onSaved();
      onClose();
    } catch (e) {
      alert('שגיאה בשמירה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-2.5 mb-3 rounded-lg border border-blue-100 bg-blue-50/40 p-3 sm:p-4 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className={LABEL}>כותרת (עברית) — חובה</span>
          <input
            value={titleHe}
            onChange={(e) => setTitleHe(e.target.value)}
            className={INPUT}
          />
        </label>
        <label className="block">
          <span className={LABEL}>Title (EN) — אופציונלי</span>
          <input
            value={titleEn}
            onChange={(e) => setTitleEn(e.target.value)}
            dir="ltr"
            className={INPUT}
          />
        </label>
      </div>

      <label className="block">
        <span className={LABEL}>סעיף בהצעה — היכן יופיע התוכן</span>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={INPUT}>
          {CATEGORY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {!category && (
          <span className="mt-1 block text-[11px] text-amber-600">
            ללא שיוך התוכן לא יופיע בהצעה. בחרו סעיף כדי שהוא יוצג.
          </span>
        )}
      </label>

      <div>
        <span className={LABEL}>תוכן עשיר (עברית)</span>
        <RichEditor
          value={richTextHe}
          onChange={setRichTextHe}
          ariaLabel="תוכן הסעיף בעברית"
          placeholder="כתבו כאן את תוכן הסעיף..."
          minContentHeight={160}
        />
      </div>

      <div>
        <span className={LABEL}>Rich content (EN)</span>
        <RichEditor
          value={richTextEn}
          onChange={setRichTextEn}
          ariaLabel="Section content in English"
          placeholder="Write the section content here..."
          minContentHeight={160}
        />
      </div>

      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={save}
          disabled={busy || !titleHe.trim()}
          className="h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? 'שומר…' : 'שמור סעיף'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-600 hover:bg-gray-50"
        >
          סגור
        </button>
      </div>
    </div>
  );
}
