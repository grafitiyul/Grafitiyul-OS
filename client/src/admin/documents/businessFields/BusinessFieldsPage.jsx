import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';

export default function BusinessFieldsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const list = await api.businessFields.list();
      setItems(list);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function addField({ key, label, value, category }) {
    await api.businessFields.create({ key, label, value, category });
    setCreating(false);
    await refresh();
  }

  return (
    <div className="h-full flex flex-col bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">שדות קבועים של העסק</h1>
            <p className="text-sm text-gray-600 mt-1">
              ערכים גלובליים שיוזרמו אוטומטית לכל מסמך ששדותיו מקושרים אליהם.
            </p>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="shrink-0 bg-blue-600 text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-blue-700"
          >
            + שדה חדש
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-5">
        {loading && <div className="text-gray-500 text-center py-10">טוען…</div>}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded p-3 max-w-xl mx-auto">
            שגיאה בטעינה: {error}
          </div>
        )}

        {!loading && !error && (
          <div className="max-w-3xl mx-auto">
            {creating && (
              <CreateRow
                onCancel={() => setCreating(false)}
                onSubmit={addField}
              />
            )}

            {items.length === 0 && !creating && (
              <div className="bg-white border border-gray-200 rounded-lg p-10 text-center">
                <div className="text-4xl mb-3 opacity-50">🏷</div>
                <div className="font-semibold text-gray-800 mb-1">
                  אין שדות קבועים עדיין
                </div>
                <div className="text-sm text-gray-500">
                  שדות אלה יוזרמו למסמכים — למשל שם החברה, ח״פ, כתובת.
                </div>
              </div>
            )}

            <ul className="space-y-2">
              {items.map((f) => (
                <FieldRow key={f.id} field={f} onChanged={refresh} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function CreateRow({ onCancel, onSubmit }) {
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [category, setCategory] = useState('');

  function submit(e) {
    e.preventDefault();
    if (!label.trim()) return;
    onSubmit({
      label: label.trim(),
      key: key.trim() || undefined,
      value,
      category: category.trim() || null,
    });
  }

  return (
    <form
      onSubmit={submit}
      className="bg-white border border-blue-200 rounded-lg p-4 mb-3 space-y-3"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FieldInput
          label="תווית תצוגה *"
          value={label}
          onChange={setLabel}
          autoFocus
          required
          placeholder="למשל: שם החברה"
        />
        <FieldInput
          label="מפתח פנימי"
          dir="ltr"
          value={key}
          onChange={setKey}
          placeholder="company_name"
          hint="אופציונלי — יתמלא אוטומטית מהתווית."
        />
      </div>
      <FieldInput
        label="ערך"
        value={value}
        onChange={setValue}
        placeholder="למשל: גרפיטיול בע״מ"
      />
      <FieldInput
        label="קטגוריה"
        value={category}
        onChange={setCategory}
        placeholder="זהות / כתובות / בנק"
      />
      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={!label.trim()}
          className="bg-blue-600 text-white rounded-md px-4 py-1.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
        >
          הוסף
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-gray-600 px-3 py-1.5 rounded hover:bg-gray-100"
        >
          ביטול
        </button>
      </div>
    </form>
  );
}

function FieldRow({ field, onChanged }) {
  const [label, setLabel] = useState(field.label);
  const [value, setValue] = useState(field.value || '');
  const [category, setCategory] = useState(field.category || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const dirty =
    label !== field.label || value !== field.value || (category || '') !== (field.category || '');

  async function save() {
    setErr(null);
    setSaving(true);
    try {
      await api.businessFields.update(field.id, { label, value, category: category || null });
      await onChanged();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`למחוק את השדה "${field.label}"?`)) return;
    try {
      await api.businessFields.remove(field.id);
      await onChanged();
    } catch (e) {
      if (e.payload?.error === 'field_in_use') {
        window.alert(
          `אי אפשר למחוק — השדה משומש ב-${e.payload.templatesCount} תבניות.`,
        );
      } else {
        window.alert(e.message);
      }
    }
  }

  return (
    <li className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="grid grid-cols-1 sm:grid-cols-[180px,1fr,180px,auto] gap-3 items-start">
        <div>
          <FieldInput label="תווית" value={label} onChange={setLabel} compact />
          <div
            className="text-[11px] text-gray-500 mt-1 font-mono truncate"
            dir="ltr"
          >
            {field.key}
          </div>
        </div>
        <FieldInput label="ערך" value={value} onChange={setValue} compact />
        <FieldInput
          label="קטגוריה"
          value={category}
          onChange={setCategory}
          compact
        />
        <div className="flex flex-col gap-1 pt-5">
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="text-[12px] bg-blue-600 text-white rounded px-2.5 py-1 disabled:opacity-40"
          >
            {saving ? 'שומר…' : 'שמור'}
          </button>
          <button
            onClick={remove}
            className="text-[12px] text-red-600 hover:bg-red-50 rounded px-2.5 py-1"
          >
            מחק
          </button>
        </div>
      </div>
      {err && (
        <div className="mt-2 bg-red-50 border border-red-200 text-red-800 rounded p-2 text-xs">
          {err}
        </div>
      )}
    </li>
  );
}

function FieldInput({
  label,
  value,
  onChange,
  dir,
  hint,
  compact,
  autoFocus,
  required,
  placeholder,
}) {
  return (
    <label className="block">
      <div
        className={`text-[${compact ? '11' : '12'}px] text-gray-600 mb-1 ${
          compact ? '' : 'font-medium'
        }`}
      >
        {label}
      </div>
      <input
        autoFocus={autoFocus}
        dir={dir}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full border border-gray-300 rounded px-2 py-${
          compact ? '1' : '2'
        } text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400`}
      />
      {hint && <div className="text-[11px] text-gray-500 mt-0.5">{hint}</div>}
    </label>
  );
}
