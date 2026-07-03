import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useDirtyWhen } from '../../lib/dirtyForms.js';
import RichEditor from '../../editor/RichEditor.jsx';
import Dialog from '../common/Dialog.jsx';
import ReorderableList from '../common/ReorderableList.jsx';
import { SingleImage } from '../products/ImageUploader.jsx';
import {
  ActiveBadge, Loading, ErrorBox, alertError, Field, TextInput, SectionTitle,
  ASSET_TYPES, assetTypeLabel, primaryBtn, ghostBtn,
} from './kit.jsx';

export default function ContentBlockDetail() {
  const { blockId } = useParams();
  const nav = useNavigate();
  const [block, setBlock] = useState(null);
  const [form, setForm] = useState(null);
  const [original, setOriginal] = useState(null);
  const [usage, setUsage] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [addAssetOpen, setAddAssetOpen] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [b, u] = await Promise.all([
        api.tourContent.getBlock(blockId),
        api.tourContent.blockWhereUsed(blockId).catch(() => []),
      ]);
      setBlock(b);
      setUsage(u);
      const init = {
        titleHe: b.titleHe || '',
        bodyHe: b.bodyHe || '',
        internalNote: b.internalNote || '',
        shared: b.shared,
        active: b.active,
      };
      setForm(init);
      setOriginal(init);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [blockId]);
  useEffect(() => { refresh(); }, [refresh]);

  useDirtyWhen(form, original, { active: !!form && !!original });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setSaving(true);
    try {
      await api.tourContent.updateBlock(blockId, form);
      await refresh();
    } catch (e) {
      alertError('שגיאה בשמירה', e);
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    if (!confirm('למחוק את הבלוק? פעולה זו אפשרית רק אם הוא לא משובץ באף תחנה.')) return;
    try {
      await api.tourContent.removeBlock(blockId);
      nav('/admin/tour-content/blocks');
    } catch (e) {
      if (e?.payload?.error === 'has_placements') {
        alert(`לא ניתן למחוק: הבלוק משובץ ב-${e.payload.count} מקומות. הסירו אותו קודם מהתחנות.`);
      } else alertError('שגיאה', e);
    }
  }

  async function reorderAssets(ids) {
    try { await api.tourContent.reorderAssets(blockId, ids); }
    catch (e) { alertError('שגיאה בעדכון הסדר', e); refresh(); }
  }
  async function removeAsset(id) {
    if (!confirm('למחוק את הנכס?')) return;
    try { await api.tourContent.removeAsset(id); await refresh(); }
    catch (e) { alertError('שגיאה', e); }
  }

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;

  return (
    <div dir="rtl" className="max-w-3xl space-y-8">
      <div className="text-[13px] text-gray-400">
        <Link to="/admin/tour-content/blocks" className="hover:text-gray-600">ספריית תוכן</Link>
        <span className="mx-1">/</span>
        <span className="text-gray-600">{block.titleHe || '(ללא כותרת)'}</span>
      </div>

      {/* Block meta */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <SectionTitle>בלוק תוכן</SectionTitle>
          <div className="flex-1" />
          <ActiveBadge active={block.active} />
        </div>
        <Field label="כותרת (עברית)">
          <TextInput value={form.titleHe} onChange={(e) => set('titleHe', e.target.value)} />
        </Field>
        <Field label="תוכן (עברית)">
          <RichEditor value={form.bodyHe} onChange={(html) => set('bodyHe', html)} ariaLabel="תוכן הבלוק" />
        </Field>
        <Field label="הערה פנימית">
          <TextInput value={form.internalNote} onChange={(e) => set('internalNote', e.target.value)} placeholder="אופציונלי — לא מוצג לחניך" />
        </Field>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={!!form.shared} onChange={(e) => set('shared', e.target.checked)} />
          מוצג בספריית התוכן לשימוש חוזר
        </label>
        <div className="flex gap-2 pt-1">
          <button className={primaryBtn} onClick={save} disabled={saving}>{saving ? 'שומר…' : 'שמור'}</button>
          {block.active ? (
            <button className={ghostBtn} onClick={() => api.tourContent.updateBlock(blockId, { active: false }).then(refresh).catch((e) => alertError('שגיאה', e))}>העברה לארכיון</button>
          ) : (
            <button className={ghostBtn} onClick={() => api.tourContent.updateBlock(blockId, { active: true }).then(refresh).catch((e) => alertError('שגיאה', e))}>שחזור</button>
          )}
          <div className="flex-1" />
          <button className="text-[13px] text-red-600 hover:underline" onClick={del}>מחיקה</button>
        </div>
      </section>

      {/* Assets */}
      <section>
        <SectionTitle count={block.assets.length} action={<button className={primaryBtn} onClick={() => setAddAssetOpen(true)}>+ נכס</button>}>
          נכסים (מדיה / קישורים)
        </SectionTitle>
        <ReorderableList
          items={block.assets}
          onReorder={reorderAssets}
          emptyText="אין נכסים לבלוק זה."
          renderRow={(a, { handle }) => (
            <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2">
              {handle}
              {a.media?.url ? (
                <img src={a.media.url} alt="" className="h-10 w-10 object-cover rounded-lg border border-gray-200" />
              ) : (
                <span className="h-10 w-10 rounded-lg bg-gray-100 grid place-items-center text-[10px] text-gray-500">{assetTypeLabel(a.assetType)}</span>
              )}
              <div className="flex-1 min-w-0">
                <div className="font-medium text-gray-900 truncate">{a.titleHe}</div>
                <div className="text-[11px] text-gray-400 truncate">
                  {assetTypeLabel(a.assetType)}{a.url ? ' · ' + a.url : a.media ? ' · R2' : ''}
                </div>
              </div>
              <button onClick={() => removeAsset(a.id)} aria-label="מחק נכס" className="text-gray-300 hover:text-red-600">×</button>
            </div>
          )}
        />
      </section>

      {/* Where used */}
      <section>
        <SectionTitle count={usage.length}>שימוש בבלוק</SectionTitle>
        {usage.length === 0 ? (
          <p className="text-[13px] text-gray-400">הבלוק לא משובץ באף תחנה כרגע.</p>
        ) : (
          <ul className="space-y-1">
            {usage.map((u) => (
              <li key={u.stepId}>
                <Link to={`/admin/tour-content/stations/${u.stationId}`} className="block rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:border-blue-300 hover:bg-blue-50/40">
                  {u.stationTitleHe}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {addAssetOpen && (
        <AddAssetDialog blockId={blockId} onClose={() => setAddAssetOpen(false)} onAdded={async () => { setAddAssetOpen(false); await refresh(); }} />
      )}
    </div>
  );
}

// ── Add-asset dialog: image (→ R2/MediaFile) OR url (video/file/link) ────────────
function AddAssetDialog({ blockId, onClose, onAdded }) {
  const [assetType, setAssetType] = useState('image');
  const [titleHe, setTitleHe] = useState('');
  const [url, setUrl] = useState('');
  const [media, setMedia] = useState(null); // MediaFile from R2 upload
  const [busy, setBusy] = useState(false);

  const isImage = assetType === 'image';
  const canSave = titleHe.trim() && (isImage ? !!media : !!url.trim());

  async function save() {
    if (!canSave) return;
    setBusy(true);
    try {
      const data = isImage
        ? { assetType, titleHe: titleHe.trim(), mediaId: media.id }
        : { assetType, titleHe: titleHe.trim(), url: url.trim() };
      await api.tourContent.createAsset(blockId, data);
      onAdded();
    } catch (e) {
      alertError('שגיאה בהוספת נכס', e);
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="הוספת נכס"
      footer={
        <>
          <button className={ghostBtn} onClick={onClose} disabled={busy}>ביטול</button>
          <button className={primaryBtn} onClick={save} disabled={busy || !canSave}>{busy ? 'שומר…' : 'הוסף'}</button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="סוג">
          <select
            value={assetType}
            onChange={(e) => { setAssetType(e.target.value); setMedia(null); setUrl(''); }}
            className="h-10 w-full rounded-xl border border-gray-300 px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
          >
            {ASSET_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="כותרת (עברית)">
          <TextInput autoFocus value={titleHe} onChange={(e) => setTitleHe(e.target.value)} />
        </Field>
        {isImage ? (
          <Field label="תמונה (R2)">
            <SingleImage image={media} onChange={setMedia} folder="tour-content/asset" />
          </Field>
        ) : (
          <Field label="קישור (URL)">
            <TextInput value={url} onChange={(e) => setUrl(e.target.value)} dir="ltr" placeholder="https://…" />
            <p className="text-[11px] text-gray-400 mt-1">קישורים יציבים (YouTube / Vimeo / Drive) נשמרים כפי שהם.</p>
          </Field>
        )}
      </div>
    </Dialog>
  );
}
