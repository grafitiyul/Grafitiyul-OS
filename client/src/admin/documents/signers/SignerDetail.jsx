import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../lib/api.js';
import SignaturePad from '../shared/SignaturePad.jsx';
import { SIGNER_ASSET_MODES } from '../config.js';

const ASSET_LABELS = Object.fromEntries(
  SIGNER_ASSET_MODES.map((m) => [m.key, m.label]),
);

export default function SignerDetail({ personId, onChanged }) {
  const [person, setPerson] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const p = await api.signers.get(personId);
      setPerson(p);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [personId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        טוען…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center text-sm">
          <div className="text-red-600 mb-2">שגיאה בטעינה</div>
          <button
            onClick={load}
            className="text-xs border border-gray-300 rounded px-3 py-1 hover:bg-gray-50"
          >
            נסה שוב
          </button>
        </div>
      </div>
    );
  }
  if (!person) return null;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <header className="bg-white border-b border-gray-200 px-5 py-4 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold text-gray-900 truncate">
            {person.displayName}
          </h1>
          {person.role && (
            <div className="text-sm text-gray-600 mt-0.5">{person.role}</div>
          )}
        </div>
        <button
          onClick={async () => {
            if (!window.confirm(`למחוק את ${person.displayName}?`)) return;
            try {
              await api.signers.remove(person.id);
              await onChanged?.();
              navigate('/admin/documents/signers');
            } catch (e) {
              if (e.payload?.error === 'signer_in_use') {
                window.alert(
                  `אי אפשר למחוק — החותם משומש ב-${e.payload.count} שדות בתבניות.`,
                );
              } else {
                window.alert(e.message);
              }
            }
          }}
          className="shrink-0 text-[12px] text-red-600 hover:bg-red-50 border border-red-200 rounded px-3 py-1.5"
        >
          מחק חותם
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        <IdentitySection
          person={person}
          onSaved={async () => {
            await load();
            await onChanged?.();
          }}
        />
        <AssetsSection
          person={person}
          onChanged={async () => {
            await load();
            await onChanged?.();
          }}
        />
      </div>
    </div>
  );
}

function IdentitySection({ person, onSaved }) {
  const [displayName, setDisplayName] = useState(person.displayName);
  const [role, setRole] = useState(person.role || '');
  const [email, setEmail] = useState(person.email || '');
  const [phone, setPhone] = useState(person.phone || '');
  const [extras, setExtras] = useState(() =>
    Object.entries(person.extraFields || {}).map(([k, v]) => ({
      key: k,
      value: v == null ? '' : String(v),
    })),
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const dirty =
    displayName !== person.displayName ||
    role !== (person.role || '') ||
    email !== (person.email || '') ||
    phone !== (person.phone || '') ||
    JSON.stringify(Object.fromEntries(extras.map((e) => [e.key, e.value]))) !==
      JSON.stringify(person.extraFields || {});

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const extraFields = {};
      for (const row of extras) {
        const k = row.key.trim();
        if (!k) continue;
        extraFields[k] = row.value;
      }
      await api.signers.update(person.id, {
        displayName,
        role: role || null,
        email: email || null,
        phone: phone || null,
        extraFields,
      });
      await onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="bg-white border border-gray-200 rounded-lg p-5">
      <h2 className="font-semibold text-gray-900 mb-3">פרטי חותם</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="שם מלא" value={displayName} onChange={setDisplayName} />
        <Field label="תפקיד" value={role} onChange={setRole} />
        <Field label="אימייל" value={email} onChange={setEmail} dir="ltr" />
        <Field label="טלפון" value={phone} onChange={setPhone} dir="ltr" />
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium text-gray-800">שדות נוספים</div>
          <button
            onClick={() =>
              setExtras([...extras, { key: '', value: '' }])
            }
            className="text-[12px] text-blue-700 hover:underline"
          >
            + הוסף שדה
          </button>
        </div>
        {extras.length === 0 && (
          <div className="text-xs text-gray-500 italic">
            לא הוגדרו שדות נוספים (לדוגמה: ת״ז, קוד ספק).
          </div>
        )}
        <ul className="space-y-2">
          {extras.map((row, i) => (
            <li key={i} className="flex gap-2 items-start">
              <input
                value={row.key}
                onChange={(e) =>
                  setExtras(extras.map((r, j) => (i === j ? { ...r, key: e.target.value } : r)))
                }
                placeholder="מפתח (לדוגמה: supplier_code)"
                dir="ltr"
                className="w-40 border border-gray-300 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
              />
              <input
                value={row.value}
                onChange={(e) =>
                  setExtras(extras.map((r, j) => (i === j ? { ...r, value: e.target.value } : r)))
                }
                placeholder="ערך"
                className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
              />
              <button
                onClick={() => setExtras(extras.filter((_, j) => j !== i))}
                className="text-xs text-red-600 hover:bg-red-50 rounded px-2"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </div>

      {err && (
        <div className="mt-3 bg-red-50 border border-red-200 text-red-800 rounded p-2 text-xs">
          {err}
        </div>
      )}
      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="bg-blue-600 text-white rounded px-3.5 py-1.5 text-sm font-medium disabled:opacity-40"
        >
          {saving ? 'שומר…' : 'שמור פרטים'}
        </button>
      </div>
    </section>
  );
}

function Field({ label, value, onChange, dir }) {
  return (
    <label className="block">
      <div className="text-[12px] text-gray-600 mb-1">{label}</div>
      <input
        value={value}
        dir={dir}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
      />
    </label>
  );
}

function AssetsSection({ person, onChanged }) {
  const [padOpen, setPadOpen] = useState(false);
  const fileInputRef = useRef(null);
  const [uploadMode, setUploadMode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function handleDrawConfirm(dataUrl) {
    setPadOpen(false);
    setBusy(true);
    setErr(null);
    try {
      await api.signers.createDrawAsset(person.id, dataUrl, 'חתימה מצויירת');
      await onChanged();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  function startImageUpload(mode) {
    setUploadMode(mode);
    fileInputRef.current?.click();
  }

  async function handleFileChosen(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !uploadMode) return;
    if (file.type !== 'image/png') {
      setErr('יש להעלות קובץ PNG בלבד.');
      setUploadMode(null);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await api.signers.uploadImageAsset(person.id, bytes, uploadMode, file.name);
      await onChanged();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setUploadMode(null);
      setBusy(false);
    }
  }

  async function remove(assetId) {
    if (!window.confirm('למחוק את הנכס?')) return;
    setBusy(true);
    setErr(null);
    try {
      await api.signers.removeAsset(person.id, assetId);
      await onChanged();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-white border border-gray-200 rounded-lg p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900">חתימה / חותמת</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPadOpen(true)}
            disabled={busy}
            className="text-[12px] bg-blue-600 text-white rounded px-3 py-1.5 hover:bg-blue-700 disabled:opacity-40"
          >
            ✎ ציור חתימה
          </button>
          <button
            onClick={() => startImageUpload('stamp')}
            disabled={busy}
            className="text-[12px] border border-gray-300 text-gray-700 rounded px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40"
          >
            העלה חותמת (PNG)
          </button>
          <button
            onClick={() => startImageUpload('combined')}
            disabled={busy}
            className="text-[12px] border border-gray-300 text-gray-700 rounded px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40"
          >
            חתימה+חותמת (PNG)
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png"
            className="hidden"
            onChange={handleFileChosen}
          />
        </div>
      </div>

      {err && (
        <div className="mb-3 bg-red-50 border border-red-200 text-red-800 rounded p-2 text-xs">
          {err}
        </div>
      )}

      {person.assets.length === 0 ? (
        <div className="text-sm text-gray-500 italic">
          אין נכסים עדיין. ציירו חתימה או העלו חותמת כדי להשתמש בחותם במסמכים.
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {person.assets.map((a) => (
            <li
              key={a.id}
              className="border border-gray-200 rounded-lg p-3 bg-gray-50"
            >
              <div className="flex items-start justify-between mb-1">
                <div className="text-[11px] font-medium text-gray-700">
                  {ASSET_LABELS[a.assetType] || a.assetType}
                </div>
                <button
                  onClick={() => remove(a.id)}
                  className="text-[11px] text-red-600 hover:bg-red-50 rounded px-2 py-0.5"
                >
                  מחק
                </button>
              </div>
              <div className="bg-white border border-gray-200 rounded flex items-center justify-center p-2 h-32 overflow-hidden">
                <img
                  alt={a.label || 'asset'}
                  src={api.signers.assetPngUrl(person.id, a.id)}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
              <div className="text-[10px] text-gray-500 mt-1 truncate">
                {a.label || a.id}
              </div>
            </li>
          ))}
        </ul>
      )}

      {padOpen && (
        <SignaturePad
          onConfirm={handleDrawConfirm}
          onClose={() => setPadOpen(false)}
        />
      )}
    </section>
  );
}
