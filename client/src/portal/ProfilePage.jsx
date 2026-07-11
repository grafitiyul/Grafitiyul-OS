import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../lib/api.js';
import AvatarCropDialog from '../avatar/AvatarCropDialog.jsx';
import BankDetailsFields from '../profile/BankDetailsFields.jsx';

// פרטים אישיים — the guide's own profile. Editable (when the server-side
// editPersonalProfile permission is on): full name, photo (shared crop
// tool), phone, email, and bank details (beneficiary / bank / branch /
// account). Every save is recorded in the immutable person changelog on the
// server; the shell header refreshes immediately after save.

export default function ProfilePage() {
  const { token, refreshHome } = useOutletContext();
  const [state, setState] = useState({ phase: 'loading' });
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [saveError, setSaveError] = useState(null);
  // Crop flow state: { src, originalFile?, originalUrl?, initialCrop? }
  const [cropState, setCropState] = useState(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileInput = useRef(null);

  const apiBase = `/api/portal/${encodeURIComponent(token)}/profile`;

  const load = useCallback(async () => {
    setState({ phase: 'loading' });
    try {
      const res = await fetch(apiBase, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setForm({
        displayName: data.displayName || '',
        phone: data.phone || '',
        email: data.email || '',
        bank: { ...data.bank },
      });
      setState({ phase: 'ready', data });
    } catch (e) {
      setState({ phase: 'error', message: e?.message || 'שגיאה' });
    }
  }, [apiBase]);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(apiBase, {
        method: 'PUT',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: form.displayName,
          phone: form.phone,
          email: form.email,
          bank: form.bank,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        const messages = {
          empty_name: 'יש למלא שם.',
          invalid_phone: 'מספר הטלפון אינו תקין.',
          invalid_email: 'כתובת האימייל אינה תקינה.',
          not_allowed: 'עדכון פרטים אינו זמין.',
        };
        throw new Error(messages[payload?.error] || `HTTP ${res.status}`);
      }
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
      refreshHome?.(); // header shows the new name immediately
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  }

  // ---- photo flow (shared crop tool) ----

  function pickNewPhoto(file) {
    if (!file) return;
    setCropState({ src: URL.createObjectURL(file), originalFile: file });
  }

  // Clicking the avatar opens the EDITOR when a photo exists (recrop the
  // stored original, or the current rendition for legacy photos), otherwise
  // the file picker.
  function openEditor() {
    const p = state.data;
    if (photoBusy || !p?.canEdit) return;
    if (p.imageUrl) {
      setCropState(
        p.imageOriginalUrl
          ? { src: p.imageOriginalUrl, originalUrl: p.imageOriginalUrl, initialCrop: p.imageCrop || null }
          : { src: p.imageUrl, originalUrl: null, initialCrop: null },
      );
    } else {
      fileInput.current?.click();
    }
  }

  async function removePhoto() {
    setPhotoBusy(true);
    try {
      const res = await fetch(`${apiBase}/photo`, { method: 'DELETE', cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setCropState(null);
      await load();
      refreshHome?.();
    } catch (e) {
      alert('הסרת התמונה נכשלה: ' + e.message);
    } finally {
      setPhotoBusy(false);
    }
  }

  async function saveCrop(blob, crop) {
    setPhotoBusy(true);
    try {
      let originalUrl = cropState.originalUrl || null;
      if (cropState.originalFile) {
        const up = await fetch(
          `${apiBase}/photo/original?filename=${encodeURIComponent(cropState.originalFile.name)}`,
          { method: 'POST', cache: 'no-store', body: cropState.originalFile },
        );
        if (!up.ok) throw new Error(`HTTP ${up.status}`);
        originalUrl = (await up.json()).url;
      } else if (!originalUrl && cropState.src) {
        // Legacy photo (no stored original) — the current rendition becomes
        // the original going forward.
        originalUrl = cropState.src;
      }
      const q = new URLSearchParams({
        filename: 'avatar.webp',
        originalUrl: originalUrl || '',
        crop: JSON.stringify(crop),
      });
      const res = await fetch(`${apiBase}/photo?${q}`, {
        method: 'POST',
        cache: 'no-store',
        body: blob,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setCropState(null);
      await load();
      refreshHome?.(); // header shows the new photo immediately
    } catch (e) {
      alert('שמירת התמונה נכשלה: ' + e.message);
    } finally {
      setPhotoBusy(false);
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
  const canEdit = p.canEdit;

  return (
    <div>
      <h1 className="mb-3 px-1 text-[17px] font-bold text-gray-900">פרטים אישיים</h1>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        {/* photo + name row */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            disabled={!canEdit || photoBusy}
            onClick={openEditor}
            className="relative shrink-0"
            aria-label="עריכת תמונת פרופיל"
          >
            {p.imageUrl ? (
              <img
                src={p.imageUrl}
                alt=""
                className="h-16 w-16 rounded-full border border-gray-200 object-cover"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-600 text-xl font-semibold text-white">
                {(p.displayName || '?').slice(0, 1)}
              </div>
            )}
            {canEdit && (
              <span className="absolute -bottom-0.5 -left-0.5 flex h-6 w-6 items-center justify-center rounded-full border border-gray-200 bg-white text-[11px] shadow-sm">
                ✎
              </span>
            )}
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-[17px] font-bold text-gray-900">{p.displayName}</div>
            {p.lifecycleLabel && (
              <div className="text-[12.5px] text-gray-500">{p.lifecycleLabel} · גרפיטיול</div>
            )}
            {canEdit && p.imageUrl && (
              <button
                type="button"
                onClick={openEditor}
                disabled={photoBusy}
                className="mt-1 text-[12px] font-semibold text-blue-700 active:underline"
              >
                עריכת התמונה
              </button>
            )}
          </div>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            pickNewPhoto(e.target.files?.[0]);
            e.target.value = '';
          }}
        />

        {/* identity fields */}
        <div className="mt-5 space-y-3">
          <Field
            label="שם מלא"
            value={form.displayName}
            disabled={!canEdit}
            onChange={(v) => setForm((f) => ({ ...f, displayName: v }))}
          />
          <Field
            label="טלפון"
            dir="ltr"
            type="tel"
            value={form.phone}
            disabled={!canEdit}
            onChange={(v) => setForm((f) => ({ ...f, phone: v }))}
          />
          <Field
            label="אימייל"
            dir="ltr"
            type="email"
            value={form.email}
            disabled={!canEdit}
            onChange={(v) => setForm((f) => ({ ...f, email: v }))}
          />
        </div>
      </div>

      {/* bank details */}
      <div className="mt-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-[13px] font-bold text-gray-500">פרטי חשבון לתשלום</h2>
        <BankSection
          value={form.bank}
          disabled={!canEdit}
          onChange={(patch) => setForm((f) => ({ ...f, bank: { ...f.bank, ...patch } }))}
        />
      </div>

      {canEdit ? (
        <div className="mt-4 flex items-center gap-3 px-1">
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
        <p className="mt-4 px-1 text-[12.5px] text-gray-400">לעדכון פרטים יש לפנות למשרד.</p>
      )}

      {cropState && (
        <AvatarCropDialog
          key={cropState.src}
          open
          src={cropState.src}
          initialCrop={cropState.initialCrop || null}
          saving={photoBusy}
          onCancel={() => !photoBusy && setCropState(null)}
          onSave={saveCrop}
          onPickNew={pickNewPhoto}
          onRemove={p.imageUrl ? removePhoto : null}
        />
      )}
    </div>
  );
}

function BankSection({ value, disabled, onChange }) {
  const [banks, setBanks] = useState([]);
  useEffect(() => {
    api.bankCatalog
      .get()
      .then((r) => setBanks(r.banks || []))
      .catch(() => setBanks([])); // catalog failure never blocks editing
  }, []);
  return (
    <BankDetailsFields value={value} onChange={onChange} banks={banks} disabled={disabled} />
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
