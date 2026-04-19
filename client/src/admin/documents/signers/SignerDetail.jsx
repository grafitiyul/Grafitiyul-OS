import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../lib/api.js';
import SignaturePad from '../shared/SignaturePad.jsx';
import StampBuilder from '../shared/StampBuilder.jsx';
import CombinedAssetEditor from '../shared/CombinedAssetEditor.jsx';
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
  // Active builder modal. One of null | 'draw' | 'stamp' | 'combined'.
  // Opening for edit: editing = { type, asset } — carries existing asset for
  // in-place update via PUT.
  const [builder, setBuilder] = useState(null);
  const [editing, setEditing] = useState(null);
  const [combinedPicker, setCombinedPicker] = useState(null);
  const [fallbackOpen, setFallbackOpen] = useState(false);

  const fileInputRef = useRef(null);
  const [uploadMode, setUploadMode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const drawAssets = useMemo(
    () => person.assets.filter((a) => a.assetType === 'draw'),
    [person.assets],
  );
  const stampAssets = useMemo(
    () => person.assets.filter((a) => a.assetType === 'stamp'),
    [person.assets],
  );
  const assetById = useMemo(() => {
    const m = new Map();
    for (const a of person.assets) m.set(a.id, a);
    return m;
  }, [person.assets]);

  const canCombine = drawAssets.length > 0 && stampAssets.length > 0;

  function openDrawBuilder(asset) {
    setEditing(asset ? { type: 'draw', asset } : null);
    setBuilder('draw');
  }
  function openStampBuilder(asset) {
    setEditing(asset ? { type: 'stamp', asset } : null);
    setBuilder('stamp');
  }
  const [combinedPending, setCombinedPending] = useState(null); // { drawId, stampId } while picking

  function openCombinedBuilder(asset) {
    if (asset) {
      // Re-edit existing combined asset — re-hydrate the source assets from
      // the saved layout. If a source is gone, we refuse to open the editor.
      const layout = asset.stampConfigJson;
      if (!layout || !Array.isArray(layout.elements)) {
        setErr('נכס משולב ללא נתוני הרכבה לא ניתן לעריכה.');
        return;
      }
      const drawEl = layout.elements.find((e) => e.asset_type === 'draw');
      const stampEl = layout.elements.find((e) => e.asset_type === 'stamp');
      const draw = drawEl ? assetById.get(drawEl.asset_id) : null;
      const stamp = stampEl ? assetById.get(stampEl.asset_id) : null;
      if (!draw || !stamp) {
        setErr('אחד מנכסי המקור (חתימה או חותמת) נמחק — לא ניתן לערוך.');
        return;
      }
      setCombinedPicker({ draw, stamp, layout, asset });
      setBuilder('combined');
      return;
    }
    if (!canCombine) {
      setErr('צריך לפחות חתימה מצויירת אחת וחותמת אחת כדי לבנות נכס משולב.');
      return;
    }
    // Single draw + single stamp: auto-pair. Multiple: show picker first.
    if (drawAssets.length === 1 && stampAssets.length === 1) {
      setCombinedPicker({
        draw: drawAssets[0],
        stamp: stampAssets[0],
        layout: null,
        asset: null,
      });
      setBuilder('combined');
    } else {
      setCombinedPending({
        drawId: drawAssets[0].id,
        stampId: stampAssets[0].id,
      });
    }
  }

  function confirmCombinedPick() {
    const draw = assetById.get(combinedPending.drawId);
    const stamp = assetById.get(combinedPending.stampId);
    if (!draw || !stamp) return;
    setCombinedPending(null);
    setCombinedPicker({ draw, stamp, layout: null, asset: null });
    setBuilder('combined');
  }

  function closeBuilder() {
    setBuilder(null);
    setEditing(null);
    setCombinedPicker(null);
  }

  async function handleDrawConfirm(dataUrl) {
    setBusy(true);
    setErr(null);
    try {
      if (editing?.asset) {
        await api.signers.updateAsset(person.id, editing.asset.id, { dataUrl });
      } else {
        await api.signers.createDrawAsset(
          person.id,
          dataUrl,
          `חתימה ${new Date().toLocaleDateString('he-IL')}`,
        );
      }
      await onChanged();
      closeBuilder();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleStampConfirm(config, dataUrl) {
    setBusy(true);
    setErr(null);
    try {
      if (editing?.asset) {
        await api.signers.updateAsset(person.id, editing.asset.id, {
          dataUrl,
          stampConfig: config,
        });
      } else {
        const defaultLabel = config.lines?.[0]?.slice(0, 30) || 'חותמת';
        await api.signers.createStampAsset(person.id, dataUrl, config, defaultLabel);
      }
      await onChanged();
      closeBuilder();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCombinedConfirm(layout, dataUrl, label) {
    setBusy(true);
    setErr(null);
    try {
      const existing = combinedPicker?.asset;
      if (existing) {
        await api.signers.updateAsset(person.id, existing.id, {
          dataUrl,
          layout,
          label,
        });
      } else {
        await api.signers.createCombinedAsset(person.id, dataUrl, layout, label);
      }
      await onChanged();
      closeBuilder();
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
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 className="font-semibold text-gray-900">חתימה / חותמת</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => openDrawBuilder(null)}
            disabled={busy}
            className="text-[12px] bg-blue-600 text-white rounded px-3 py-1.5 hover:bg-blue-700 disabled:opacity-40"
          >
            ✎ ציור חתימה
          </button>
          <button
            onClick={() => openStampBuilder(null)}
            disabled={busy}
            className="text-[12px] bg-amber-600 text-white rounded px-3 py-1.5 hover:bg-amber-700 disabled:opacity-40"
          >
            ✎ בניית חותמת
          </button>
          <button
            onClick={() => openCombinedBuilder(null)}
            disabled={busy || !canCombine}
            title={!canCombine ? 'נדרשת חתימה + חותמת לפני שניתן לבנות נכס משולב' : undefined}
            className="text-[12px] bg-fuchsia-600 text-white rounded px-3 py-1.5 hover:bg-fuchsia-700 disabled:opacity-40"
          >
            ✎ חתימה + חותמת
          </button>
        </div>
      </div>

      {err && (
        <div className="mb-3 bg-red-50 border border-red-200 text-red-800 rounded p-2 text-xs">
          {err}
        </div>
      )}

      {person.assets.length === 0 ? (
        <div className="text-sm text-gray-500 italic">
          אין נכסים עדיין. צרו חתימה, חותמת או נכס משולב כדי להשתמש בחותם במסמכים.
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {person.assets.map((a) => {
            const canEdit =
              a.assetType === 'stamp' ||
              (a.assetType === 'combined' && a.stampConfigJson);
            return (
              <li
                key={a.id}
                className="border border-gray-200 rounded-lg p-3 bg-gray-50"
              >
                <div className="flex items-start justify-between mb-1">
                  <div className="text-[11px] font-medium text-gray-700">
                    {ASSET_LABELS[a.assetType] || a.assetType}
                  </div>
                  <div className="flex items-center gap-1">
                    {canEdit && (
                      <button
                        onClick={() =>
                          a.assetType === 'stamp'
                            ? openStampBuilder(a)
                            : openCombinedBuilder(a)
                        }
                        disabled={busy}
                        className="text-[11px] text-blue-700 hover:bg-blue-50 rounded px-2 py-0.5"
                      >
                        ערוך
                      </button>
                    )}
                    <button
                      onClick={() => remove(a.id)}
                      disabled={busy}
                      className="text-[11px] text-red-600 hover:bg-red-50 rounded px-2 py-0.5"
                    >
                      מחק
                    </button>
                  </div>
                </div>
                <div className="bg-white border border-gray-200 rounded flex items-center justify-center p-2 h-32 overflow-hidden">
                  <img
                    alt={a.label || 'asset'}
                    src={api.signers.assetPngUrl(person.id, a.id)}
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
                <div className="text-[10px] text-gray-500 mt-1 truncate">
                  {a.label || a.id.slice(-6)}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Collapsed PNG upload fallback — not primary flow. */}
      <details
        open={fallbackOpen}
        onToggle={(e) => setFallbackOpen(e.currentTarget.open)}
        className="mt-5 border border-gray-200 rounded-lg bg-gray-50"
      >
        <summary className="list-none cursor-pointer px-4 py-2 text-[12px] text-gray-600 hover:bg-gray-100 flex items-center gap-2">
          <span className="text-gray-400 transition" style={{
            display: 'inline-block',
            transform: fallbackOpen ? 'rotate(90deg)' : 'none',
          }}>▸</span>
          העלאת PNG (אופציונלי) — אם כבר יש לכם קובץ מוכן
        </summary>
        <div className="p-4 border-t border-gray-200 flex items-center gap-2 flex-wrap">
          <button
            onClick={() => startImageUpload('draw')}
            disabled={busy}
            className="text-[12px] border border-gray-300 text-gray-700 rounded px-3 py-1.5 hover:bg-white disabled:opacity-40"
          >
            העלה חתימה (PNG)
          </button>
          <button
            onClick={() => startImageUpload('stamp')}
            disabled={busy}
            className="text-[12px] border border-gray-300 text-gray-700 rounded px-3 py-1.5 hover:bg-white disabled:opacity-40"
          >
            העלה חותמת (PNG)
          </button>
          <button
            onClick={() => startImageUpload('combined')}
            disabled={busy}
            className="text-[12px] border border-gray-300 text-gray-700 rounded px-3 py-1.5 hover:bg-white disabled:opacity-40"
          >
            העלה חתימה+חותמת (PNG)
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png"
            className="hidden"
            onChange={handleFileChosen}
          />
        </div>
      </details>

      {combinedPending && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          dir="rtl"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setCombinedPending(null);
          }}
        >
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-900">בחר חתימה וחותמת</h3>
              <button
                onClick={() => setCombinedPending(null)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs text-gray-600 mb-1">חתימה מצויירת</label>
                <select
                  value={combinedPending.drawId}
                  onChange={(e) =>
                    setCombinedPending({ ...combinedPending, drawId: e.target.value })
                  }
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                >
                  {drawAssets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label || `#${a.id.slice(-6)}`}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">חותמת</label>
                <select
                  value={combinedPending.stampId}
                  onChange={(e) =>
                    setCombinedPending({ ...combinedPending, stampId: e.target.value })
                  }
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                >
                  {stampAssets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label || `#${a.id.slice(-6)}`}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-2 px-5 pb-5">
              <button
                onClick={confirmCombinedPick}
                className="flex-1 bg-fuchsia-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-fuchsia-700"
              >
                המשך לעורך
              </button>
              <button
                onClick={() => setCombinedPending(null)}
                className="px-4 bg-gray-100 text-gray-700 rounded-xl py-2.5 text-sm hover:bg-gray-200"
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}

      {builder === 'draw' && (
        <SignaturePad onConfirm={handleDrawConfirm} onClose={closeBuilder} />
      )}
      {builder === 'stamp' && (
        <StampBuilder
          initial={editing?.asset?.stampConfigJson || undefined}
          onConfirm={handleStampConfirm}
          onClose={closeBuilder}
        />
      )}
      {builder === 'combined' && combinedPicker && (
        <CombinedAssetEditor
          drawAsset={{
            ...combinedPicker.draw,
            pngUrl: api.signers.assetPngUrl(person.id, combinedPicker.draw.id),
          }}
          stampAsset={{
            ...combinedPicker.stamp,
            pngUrl: api.signers.assetPngUrl(person.id, combinedPicker.stamp.id),
          }}
          initialLayout={combinedPicker.layout || undefined}
          initialLabel={combinedPicker.asset?.label || ''}
          onConfirm={handleCombinedConfirm}
          onClose={closeBuilder}
        />
      )}
    </section>
  );
}
