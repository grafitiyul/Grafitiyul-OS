import { useCallback, useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';

// פרטים אישיים — the guide's own operational identity. View always; editing
// phone/email only when the server-side editPersonalProfile permission is on
// (the server enforces it regardless of what renders here).

export default function ProfilePage() {
  const { token } = useOutletContext();
  const [state, setState] = useState({ phase: 'loading' });
  const [form, setForm] = useState({ phone: '', email: '' });
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const load = useCallback(async () => {
    setState({ phase: 'loading' });
    try {
      const res = await fetch(`/api/portal/${encodeURIComponent(token)}/profile`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setForm({ phone: data.phone || '', email: data.email || '' });
      setState({ phase: 'ready', data });
    } catch (e) {
      setState({ phase: 'error', message: e?.message || 'שגיאה' });
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/portal/${encodeURIComponent(token)}/profile`, {
        method: 'PUT',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: form.phone, email: form.email }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        const messages = {
          invalid_phone: 'מספר הטלפון אינו תקין.',
          invalid_email: 'כתובת האימייל אינה תקינה.',
          not_allowed: 'עדכון פרטים אינו זמין.',
        };
        throw new Error(messages[payload?.error] || `HTTP ${res.status}`);
      }
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (state.phase === 'loading') {
    return <div className="py-10 text-center text-sm text-gray-500">טוען…</div>;
  }
  if (state.phase === 'error') {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
        <div className="mb-1 text-base font-semibold text-gray-800">שגיאה בטעינת הפרטים</div>
        <button
          type="button"
          onClick={load}
          className="mt-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"
        >
          נסה שוב
        </button>
      </div>
    );
  }

  const p = state.data;
  return (
    <div>
      <h1 className="mb-3 px-1 text-[17px] font-bold text-gray-900">פרטים אישיים</h1>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-4">
          {p.imageUrl ? (
            <img
              src={p.imageUrl}
              alt=""
              className="h-16 w-16 shrink-0 rounded-full border border-gray-200 object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xl font-semibold text-white">
              {(p.displayName || '?').slice(0, 1)}
            </div>
          )}
          <div className="min-w-0">
            <div className="text-[17px] font-bold text-gray-900">{p.displayName}</div>
            {p.lifecycleLabel && (
              <div className="text-[12.5px] text-gray-500">{p.lifecycleLabel} · גרפיטיול</div>
            )}
          </div>
        </div>

        <div className="mt-5 space-y-3">
          <Field
            label="טלפון"
            dir="ltr"
            type="tel"
            value={form.phone}
            disabled={!p.canEdit}
            onChange={(v) => setForm((f) => ({ ...f, phone: v }))}
          />
          <Field
            label="אימייל"
            dir="ltr"
            type="email"
            value={form.email}
            disabled={!p.canEdit}
            onChange={(v) => setForm((f) => ({ ...f, email: v }))}
          />
        </div>

        {p.canEdit ? (
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-xl bg-blue-600 px-5 py-2.5 text-[14px] font-semibold text-white active:bg-blue-700 disabled:opacity-60"
            >
              {saving ? 'שומר…' : 'שמירה'}
            </button>
            {savedFlash && (
              <span className="text-[13px] font-semibold text-emerald-600">✓ נשמר</span>
            )}
            {saveError && <span className="text-[13px] text-red-600">{saveError}</span>}
          </div>
        ) : (
          <p className="mt-4 text-[12.5px] text-gray-400">
            לעדכון פרטים יש לפנות למשרד.
          </p>
        )}
      </div>

      <p className="mt-3 px-1 text-[12px] leading-relaxed text-gray-400">
        שינוי שם או תמונה מתבצע דרך המשרד.
      </p>
    </div>
  );
}

function Field({ label, value, onChange, disabled, dir, type }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12.5px] font-semibold text-gray-500">{label}</span>
      <input
        type={type || 'text'}
        dir={dir}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-[15px] text-gray-900 focus:border-blue-500 focus:outline-none disabled:bg-gray-50 disabled:text-gray-500"
      />
    </label>
  );
}
