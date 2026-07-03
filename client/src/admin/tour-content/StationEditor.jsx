import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useDirtyWhen } from '../../lib/dirtyForms.js';
import RichEditor from '../../editor/RichEditor.jsx';
import Dialog from '../common/Dialog.jsx';
import ReorderableList from '../common/ReorderableList.jsx';
import { SingleImage } from '../products/ImageUploader.jsx';
import {
  Loading, ErrorBox, alertError, Field, TextInput,
  roleLabel, textPreview, assetTypeLabel, assetSourceLabel, ASSET_TYPES,
  MEDIA_ROLE, youtubeThumb, vimeoId, vimeoThumb, primaryBtn, ghostBtn,
} from './kit.jsx';

export default function StationEditor() {
  const { tourId, stationId } = useParams();
  const nav = useNavigate();
  const [station, setStation] = useState(null);
  const [siblings, setSiblings] = useState([]);
  const [mediaAssets, setMediaAssets] = useState([]);
  const [form, setForm] = useState(null);
  const [original, setOriginal] = useState(null);
  const [heroImage, setHeroImage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const mediaStep = station?.steps.find((s) => s.roleHint === MEDIA_ROLE) || null;
  const contentSteps = (station?.steps || []).filter((s) => s.roleHint !== MEDIA_ROLE);

  const refresh = useCallback(async () => {
    setError(null); setLoading(true);
    try {
      const [s, sibs] = await Promise.all([api.tourContent.getStation(stationId), api.tourContent.listStations(tourId)]);
      setStation(s); setSiblings(sibs); setHeroImage(s.heroImage || null);
      const init = { titleHe: s.titleHe || '', descriptionHe: s.descriptionHe || '', heroImageId: s.heroImageId || null, active: s.active };
      setForm(init); setOriginal(init);
      const media = s.steps.find((x) => x.roleHint === MEDIA_ROLE);
      setMediaAssets(media ? await api.tourContent.listAssets(media.contentBlockId) : []);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [stationId, tourId]);
  useEffect(() => { refresh(); }, [refresh]);

  useDirtyWhen(form, original, { active: !!form && !!original });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function saveDetails() {
    setSaving(true);
    try { await api.tourContent.updateStation(stationId, form); await refresh(); }
    catch (e) { alertError('שגיאה בשמירה', e); } finally { setSaving(false); }
  }
  function onHero(mf) { setHeroImage(mf); set('heroImageId', mf?.id || null); }

  // Keep the media part (if any) last after structural changes.
  async function ensureMediaLast(fresh) {
    const steps = fresh || station.steps;
    const media = steps.find((s) => s.roleHint === MEDIA_ROLE);
    const content = steps.filter((s) => s.roleHint !== MEDIA_ROLE).sort((a, b) => a.sortOrder - b.sortOrder);
    const order = [...content.map((s) => s.id), ...(media ? [media.id] : [])];
    await api.tourContent.reorderSteps(stationId, order);
  }

  async function reorderParts(ids) {
    // ids = reordered CONTENT parts; media stays last.
    const order = [...ids, ...(mediaStep ? [mediaStep.id] : [])];
    try { await api.tourContent.reorderSteps(stationId, order); await refresh(); }
    catch (e) { alertError('שגיאה בעדכון הסדר', e); refresh(); }
  }
  async function removePart(id) {
    if (!confirm('להסיר את החלק מהתחנה?')) return;
    try { await api.tourContent.removeStep(id); await refresh(); }
    catch (e) { alertError('שגיאה', e); }
  }

  if (loading) return <div className="p-8"><Loading /></div>;
  if (error) return <div className="p-8"><ErrorBox message={error} /></div>;

  const idx = siblings.findIndex((s) => s.id === stationId);
  const prev = idx > 0 ? siblings[idx - 1] : null;
  const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;
  const goto = (s) => s && nav(`/admin/tour-content/tours/${tourId}/stations/${s.id}`);

  return (
    <div className="min-h-full">
      {/* Context header — always shows tour, station, position, prev/next */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-gray-200 px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0">
            <div className="text-[12px] text-gray-400 truncate">{station.tour?.titleHe || ''}</div>
            <div className="flex items-center gap-2">
              <h1 className="text-[19px] font-bold text-gray-900 truncate">{station.titleHe}</h1>
              <span className="text-[12px] text-gray-400 tabular-nums shrink-0">תחנה {idx + 1} מתוך {siblings.length}</span>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${station.active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{station.active ? 'פעיל' : 'בארכיון'}</span>
            </div>
          </div>
          <div className="flex-1" />
          {/* RTL: next (הבאה) advances leftward → left chevron on the left;
              previous (הקודמת) is rightward → right chevron on the right. */}
          <div className="flex items-center gap-1.5">
            <button disabled={!next} onClick={() => goto(next)} className="h-8 pr-2 pl-2.5 rounded-lg border border-gray-200 text-[12.5px] font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-30 flex items-center gap-1" title="לתחנה הבאה"><span>‹</span> הבאה</button>
            <button disabled={!prev} onClick={() => goto(prev)} className="h-8 pl-2 pr-2.5 rounded-lg border border-gray-200 text-[12.5px] font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-30 flex items-center gap-1" title="לתחנה הקודמת">הקודמת <span>›</span></button>
          </div>
          <button className={ghostBtn + ' !py-1.5 !text-[12px]'} onClick={() => window.open(`/preview/tour-station/${stationId}`, '_blank', 'noopener')}>👁 תצוגה מקדימה</button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-6 space-y-5">
        {/* Section A — details */}
        <Section icon="📍" title="פרטי התחנה">
          <div className="grid md:grid-cols-[1.4fr_1fr] gap-6">
            <div className="space-y-3">
              <Field label="שם התחנה"><TextInput value={form.titleHe} onChange={(e) => set('titleHe', e.target.value)} /></Field>
              <Field label="תיאור קצר">
                <textarea rows={2} value={form.descriptionHe} onChange={(e) => set('descriptionHe', e.target.value)} placeholder="אופציונלי"
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
              </Field>
            </div>
            <Field label="תמונה ראשית (R2)">
              <SingleImage image={heroImage} onChange={onHero} folder="tour-content/hero" />
            </Field>
          </div>
          <div className="flex items-center gap-2 pt-4 mt-3 border-t border-gray-100">
            <button className={primaryBtn} onClick={saveDetails} disabled={saving}>{saving ? 'שומר…' : 'שמור פרטים'}</button>
            {station.active ? (
              <button className={ghostBtn} onClick={() => { if (confirm('להעביר את התחנה לארכיון?')) api.tourContent.updateStation(stationId, { active: false }).then(refresh).catch((e) => alertError('שגיאה', e)); }}>העברה לארכיון</button>
            ) : (
              <button className={ghostBtn} onClick={() => api.tourContent.updateStation(stationId, { active: true }).then(refresh).catch((e) => alertError('שגיאה', e))}>שחזור</button>
            )}
          </div>
        </Section>

        {/* Section B — parts (the heart) */}
        <PartsSection
          stationId={stationId}
          parts={contentSteps}
          onReorder={reorderParts}
          onRemove={removePart}
          onChanged={refresh}
          ensureMediaLast={ensureMediaLast}
        />

        {/* Section C — media & links */}
        <MediaSection
          stationId={stationId}
          mediaStep={mediaStep}
          assets={mediaAssets}
          onChanged={refresh}
        />

        {/* Section D — notes (collapsed) */}
        <NotesSection stationId={stationId} notes={station.notes} onChanged={refresh} />
      </div>
    </div>
  );
}

// ── Section shell ───────────────────────────────────────────────────────────────
function Section({ icon, title, count, action, children, tone }) {
  return (
    <section className={`rounded-2xl border shadow-sm ${tone === 'note' ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200'}`}>
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-gray-100/80">
        <span className="w-7 h-7 rounded-lg bg-slate-100 grid place-items-center text-[15px]">{icon}</span>
        <h2 className={`text-[15px] font-bold ${tone === 'note' ? 'text-amber-900' : 'text-gray-900'}`}>{title}</h2>
        {count != null && <span className="text-[12px] text-gray-400 tabular-nums">{count}</span>}
        <div className="flex-1" />
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

// ── Section B: parts ─────────────────────────────────────────────────────────────
function PartsSection({ stationId, parts, onReorder, onRemove, onChanged, ensureMediaLast }) {
  const [adding, setAdding] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  async function addNew(titleHe) {
    try {
      const step = await api.tourContent.createStep(stationId, { block: { titleHe: titleHe || 'חלק חדש', shared: false } });
      await ensureMediaLast();
      setExpandedId(step.id);
      await onChanged();
    } catch (e) { alertError('שגיאה בהוספת חלק', e); }
  }
  async function addExisting(blockId) {
    try { await api.tourContent.createStep(stationId, { contentBlockId: blockId }); await ensureMediaLast(); await onChanged(); }
    catch (e) { alertError('שגיאה', e); }
  }

  return (
    <Section icon="🎬" title="חלקי התחנה" count={`${parts.length} · לפי סדר הצגה`}
      action={<button className={ghostBtn + ' !py-1.5 !text-[12px]'} onClick={() => setAdding(true)}>+ הוסף חלק</button>}>
      {parts.length === 0 ? (
        <div className="py-8 text-center text-[13px] text-gray-400">אין עדיין חלקים בתחנה. הוסיפו את החלק הראשון.</div>
      ) : (
        <ReorderableList
          items={parts}
          onReorder={onReorder}
          emptyText=""
          renderRow={(step, { handle }) => (
            <PartRow
              step={step}
              handle={handle}
              expanded={expandedId === step.id}
              onExpand={() => setExpandedId(expandedId === step.id ? null : step.id)}
              onRemove={() => onRemove(step.id)}
              onSaved={onChanged}
            />
          )}
        />
      )}

      {adding && <AddPartDialog onClose={() => setAdding(false)} onNew={(t) => { setAdding(false); addNew(t); }} onExisting={(id) => { setAdding(false); addExisting(id); }} />}
    </Section>
  );
}

function PartRow({ step, handle, expanded, onExpand, onRemove, onSaved }) {
  const block = step.contentBlock || {};
  const [titleHe, setTitleHe] = useState(block.titleHe || '');
  const [bodyHe, setBodyHe] = useState(block.bodyHe || '');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setTitleHe(block.titleHe || ''); setBodyHe(block.bodyHe || ''); }, [block.id, block.titleHe, block.bodyHe]);

  async function save() {
    setSaving(true);
    try { await api.tourContent.updateBlock(step.contentBlockId, { titleHe, bodyHe }); await onSaved(); onExpand(); }
    catch (e) { alertError('שגיאה בשמירת התוכן', e); } finally { setSaving(false); }
  }

  return (
    <div className={`rounded-xl border ${expanded ? 'border-blue-300 bg-blue-50/20' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-center gap-3 px-3.5 py-2.5">
        <span className="opacity-50">{handle}</span>
        <div className="flex-1 min-w-0 cursor-pointer" onClick={onExpand}>
          <div className="text-[14px] font-semibold truncate text-gray-900">
            {block.titleHe || '(חלק ללא כותרת)'}
            {roleLabel(step.roleHint) && <span className="text-[11px] font-medium text-slate-500 bg-slate-100 rounded px-1.5 py-0.5 mr-2">{roleLabel(step.roleHint)}</span>}
            {block.shared && <span className="text-[11px] text-amber-700 bg-amber-50 rounded px-1.5 py-0.5 mr-1">משותף</span>}
          </div>
          {!expanded && <div className="text-[12px] text-gray-400 truncate">{textPreview(block.bodyHe) || 'ללא תוכן'}</div>}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button onClick={onExpand} title="עריכת תוכן" className="w-8 h-8 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700">✎</button>
          <button onClick={onRemove} title="הסר חלק" className="w-8 h-8 rounded-lg text-gray-300 hover:bg-red-50 hover:text-red-600">×</button>
        </div>
      </div>
      {expanded && (
        <div className="px-3.5 pb-3.5 pt-1 border-t border-blue-100 space-y-3">
          {block.shared && <div className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">התוכן הזה משותף — עריכה תשפיע על כל התחנות שמשתמשות בו.</div>}
          <Field label="כותרת החלק"><TextInput value={titleHe} onChange={(e) => setTitleHe(e.target.value)} /></Field>
          <Field label="תוכן"><RichEditor value={bodyHe} onChange={setBodyHe} ariaLabel="תוכן החלק" /></Field>
          <div className="flex gap-2">
            <button className={primaryBtn} onClick={save} disabled={saving}>{saving ? 'שומר…' : 'שמור תוכן'}</button>
            <button className={ghostBtn} onClick={onExpand} disabled={saving}>סגור</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddPartDialog({ onClose, onNew, onExisting }) {
  const [mode, setMode] = useState('new');
  const [titleHe, setTitleHe] = useState('');
  const [q, setQ] = useState('');
  const [blocks, setBlocks] = useState([]);
  useEffect(() => {
    if (mode !== 'existing') return;
    let live = true;
    api.tourContent.listBlocks({ shared: true, active: true, q: q || undefined }).then((r) => { if (live) setBlocks(r); }).catch(() => {});
    return () => { live = false; };
  }, [mode, q]);

  return (
    <Dialog open onClose={onClose} title="הוספת חלק" size="lg">
      <div className="flex gap-1 mb-4">
        <button className={`px-3 py-1.5 text-sm rounded-lg ${mode === 'new' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-100'}`} onClick={() => setMode('new')}>צור חלק חדש</button>
        <button className={`px-3 py-1.5 text-sm rounded-lg ${mode === 'existing' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-100'}`} onClick={() => setMode('existing')}>השתמש בתוכן קיים</button>
      </div>
      {mode === 'new' ? (
        <div className="space-y-3">
          <Field label="כותרת החלק (עברית)"><TextInput autoFocus value={titleHe} onChange={(e) => setTitleHe(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onNew(titleHe.trim()); }} placeholder="לדוגמה: הסיפור של הכיכר" /></Field>
          <div className="flex justify-end gap-2">
            <button className={ghostBtn} onClick={onClose}>ביטול</button>
            <button className={primaryBtn} onClick={() => onNew(titleHe.trim())}>צור והמשך</button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש תוכן קיים…" />
          <ul className="max-h-72 overflow-y-auto space-y-1">
            {blocks.length === 0 && <li className="text-sm text-gray-400 py-6 text-center">אין תוכן משותף תואם.</li>}
            {blocks.map((b) => (
              <li key={b.id}><button className="w-full text-right rounded-lg border border-gray-200 px-3 py-2 hover:border-blue-300 hover:bg-blue-50/40" onClick={() => onExisting(b.id)}>
                <div className="font-medium text-gray-900 truncate">{b.titleHe || '(ללא כותרת)'}</div>
                <div className="text-[12px] text-gray-400 truncate">{textPreview(b.bodyHe)}</div>
              </button></li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  );
}

// ── Section C: media & links (lightweight media manager) ─────────────────────────
function MediaSection({ stationId, mediaStep, assets, onChanged }) {
  const [adding, setAdding] = useState(false);
  const [replacing, setReplacing] = useState(null); // asset being replaced

  async function ensureMediaBlock() {
    if (mediaStep) return mediaStep.contentBlockId;
    const step = await api.tourContent.createStep(stationId, { block: { titleHe: 'מדיה', shared: false }, roleHint: 'media' });
    return step.contentBlockId;
  }
  async function add(data) {
    try { const blockId = await ensureMediaBlock(); await api.tourContent.createAsset(blockId, data); setAdding(false); await onChanged(); }
    catch (e) { alertError('שגיאה בהוספת מדיה', e); }
  }
  async function rename(id, titleHe) {
    try { await api.tourContent.updateAsset(id, { titleHe }); await onChanged(); } catch (e) { alertError('שגיאה בשינוי השם', e); }
  }
  async function replace(id, data) {
    try { await api.tourContent.updateAsset(id, data); setReplacing(null); await onChanged(); } catch (e) { alertError('שגיאה בהחלפה', e); }
  }
  async function remove(id) {
    if (!confirm('למחוק את הפריט?')) return;
    try { await api.tourContent.removeAsset(id); await onChanged(); } catch (e) { alertError('שגיאה', e); }
  }

  return (
    <Section icon="🎞️" title="מדיה וקישורים" count={assets.length}
      action={<button className={ghostBtn + ' !py-1.5 !text-[12px]'} onClick={() => setAdding(true)}>+ מדיה</button>}>
      {assets.length === 0 ? (
        <div className="py-8 text-center text-[13px] text-gray-400">אין מדיה או קישורים לתחנה זו.</div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3">
          {assets.map((a) => (
            <AssetCard key={a.id} asset={a} onRename={(t) => rename(a.id, t)} onReplace={() => setReplacing(a)} onRemove={() => remove(a.id)} />
          ))}
        </div>
      )}
      {adding && <AddMediaDialog onClose={() => setAdding(false)} onAdd={add} />}
      {replacing && <ReplaceMediaDialog asset={replacing} onClose={() => setReplacing(null)} onReplace={(data) => replace(replacing.id, data)} />}
    </Section>
  );
}

// Resolve the best thumbnail for a media asset. R2 image → its url. YouTube →
// direct thumb (sync). Vimeo → oEmbed lookup (async). Otherwise null (placeholder).
function useAssetThumb(asset) {
  const direct = asset.media?.url || (asset.assetType === 'image' && asset.url) || youtubeThumb(asset.url);
  const [thumb, setThumb] = useState(direct || null);
  useEffect(() => {
    setThumb(direct || null);
    if (!direct && vimeoId(asset.url)) {
      let live = true;
      vimeoThumb(asset.url).then((u) => { if (live && u) setThumb(u); });
      return () => { live = false; };
    }
  }, [asset.url, asset.media?.url, asset.assetType, direct]);
  return thumb;
}

function AssetCard({ asset, onRename, onReplace, onRemove }) {
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(asset.titleHe || '');
  const thumb = useAssetThumb(asset);
  const link = asset.media?.url || asset.url || '';
  const isVideo = asset.assetType === 'video';
  const src = assetSourceLabel(asset);
  useEffect(() => setTitle(asset.titleHe || ''), [asset.titleHe]);

  function saveRename() { const t = title.trim(); setRenaming(false); if (t && t !== asset.titleHe) onRename(t); else setTitle(asset.titleHe || ''); }
  const act = (fn) => { setMenu(false); fn(); };

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden bg-white relative group">
      <div className="aspect-video relative bg-slate-900 grid place-items-center overflow-hidden">
        {thumb ? <img src={thumb} alt="" loading="lazy" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          : <span className="text-slate-300 text-2xl">{asset.assetType === 'image' ? '🖼' : asset.assetType === 'link' ? '🔗' : asset.assetType === 'file' ? '📄' : '▶'}</span>}
        {isVideo && thumb && (
          <span className="absolute inset-0 grid place-items-center pointer-events-none">
            <span className="w-10 h-10 rounded-full bg-black/55 text-white grid place-items-center text-[15px] backdrop-blur-sm">▶</span>
          </span>
        )}
        {src && <span className="absolute bottom-1.5 left-1.5 bg-white/90 text-slate-700 text-[10px] px-1.5 py-0.5 rounded font-semibold">{src}</span>}
        <button onClick={() => setMenu((m) => !m)} className="absolute top-1.5 right-1.5 w-7 h-7 rounded-lg bg-white/90 text-gray-600 hover:text-gray-900 shadow grid place-items-center" aria-label="פעולות">⋮</button>
        {menu && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
            <div className="absolute top-9 right-1.5 z-20 w-36 bg-white rounded-lg shadow-lg border border-gray-200 py-1 text-[13px]">
              <MenuItem onClick={() => act(() => setRenaming(true))}>שינוי שם</MenuItem>
              <MenuItem onClick={() => act(onReplace)}>החלפה</MenuItem>
              {link && <MenuItem onClick={() => act(() => window.open(link, '_blank', 'noopener'))}>פתח</MenuItem>}
              {link && <MenuItem onClick={() => act(() => navigator.clipboard?.writeText(link))}>העתק קישור</MenuItem>}
              <MenuItem danger onClick={() => act(onRemove)}>מחיקה</MenuItem>
            </div>
          </>
        )}
      </div>
      <div className="px-2.5 py-2">
        {renaming ? (
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveRename}
            onKeyDown={(e) => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') { setTitle(asset.titleHe || ''); setRenaming(false); } }}
            className="w-full text-[12.5px] font-semibold rounded border border-blue-300 px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-blue-200" />
        ) : (
          <div className="text-[12.5px] font-semibold text-gray-900 leading-snug line-clamp-2 cursor-text" title={asset.titleHe} onClick={() => setRenaming(true)}>{asset.titleHe}</div>
        )}
        <div className="text-[11px] text-gray-400 mt-0.5">{assetTypeLabel(asset.assetType)}</div>
      </div>
    </div>
  );
}

function MenuItem({ children, onClick, danger }) {
  return <button onClick={onClick} className={`block w-full text-right px-3 py-1.5 hover:bg-gray-50 ${danger ? 'text-red-600' : 'text-gray-700'}`}>{children}</button>;
}

function ReplaceMediaDialog({ asset, onClose, onReplace }) {
  const isImage = asset.assetType === 'image' && (asset.media || !asset.url);
  const [url, setUrl] = useState(asset.url || '');
  const [media, setMedia] = useState(asset.media || null);
  const [busy, setBusy] = useState(false);
  const canSave = isImage ? !!media : !!url.trim();

  async function save() {
    if (!canSave) return;
    setBusy(true);
    await onReplace(isImage ? { mediaId: media.id } : { url: url.trim() });
    setBusy(false);
  }
  return (
    <Dialog open onClose={onClose} title="החלפת מדיה"
      footer={<>
        <button className={ghostBtn} onClick={onClose} disabled={busy}>ביטול</button>
        <button className={primaryBtn} onClick={save} disabled={busy || !canSave}>{busy ? 'שומר…' : 'החלף'}</button>
      </>}>
      {isImage ? (
        <Field label="תמונה חדשה (R2)"><SingleImage image={media} onChange={setMedia} folder="tour-content/asset" /></Field>
      ) : (
        <Field label="קישור חדש (URL)"><TextInput value={url} onChange={(e) => setUrl(e.target.value)} dir="ltr" placeholder="https://…" /></Field>
      )}
    </Dialog>
  );
}

function AddMediaDialog({ onClose, onAdd }) {
  const [assetType, setAssetType] = useState('image');
  const [titleHe, setTitleHe] = useState('');
  const [url, setUrl] = useState('');
  const [media, setMedia] = useState(null);
  const [busy, setBusy] = useState(false);
  const isImage = assetType === 'image';
  const canSave = titleHe.trim() && (isImage ? !!media : !!url.trim());

  async function save() {
    if (!canSave) return;
    setBusy(true);
    await onAdd(isImage ? { assetType, titleHe: titleHe.trim(), mediaId: media.id } : { assetType, titleHe: titleHe.trim(), url: url.trim() });
    setBusy(false);
  }

  return (
    <Dialog open onClose={onClose} title="הוספת מדיה / קישור"
      footer={<>
        <button className={ghostBtn} onClick={onClose} disabled={busy}>ביטול</button>
        <button className={primaryBtn} onClick={save} disabled={busy || !canSave}>{busy ? 'שומר…' : 'הוסף'}</button>
      </>}>
      <div className="space-y-3">
        <Field label="סוג">
          <select value={assetType} onChange={(e) => { setAssetType(e.target.value); setMedia(null); setUrl(''); }} className="h-10 w-full rounded-xl border border-gray-300 px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200">
            {ASSET_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="כותרת (עברית)"><TextInput autoFocus value={titleHe} onChange={(e) => setTitleHe(e.target.value)} /></Field>
        {isImage ? (
          <Field label="תמונה (R2)"><SingleImage image={media} onChange={setMedia} folder="tour-content/asset" /></Field>
        ) : (
          <Field label="קישור (URL)"><TextInput value={url} onChange={(e) => setUrl(e.target.value)} dir="ltr" placeholder="https://…" /></Field>
        )}
      </div>
    </Dialog>
  );
}

// ── Section D: notes (collapsed) ─────────────────────────────────────────────────
function NotesSection({ stationId, notes, onChanged }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    try { await api.tourContent.createNote(stationId, { contentHe: '' }); await onChanged(); }
    catch (e) { alertError('שגיאה', e); } finally { setBusy(false); }
  }

  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 shadow-sm">
      <button className="w-full flex items-center gap-2.5 px-5 py-3.5 text-right" onClick={() => setOpen((o) => !o)}>
        <span className="w-7 h-7 rounded-lg bg-amber-100 grid place-items-center text-[15px]">📝</span>
        <h2 className="text-[15px] font-bold text-amber-900">הערות פנימיות</h2>
        <span className="text-[12px] text-amber-700/70 tabular-nums">{notes.length} · אדמין בלבד</span>
        <div className="flex-1" />
        <span className="text-amber-700 text-[13px]">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-5 pb-5 space-y-2">
          {notes.map((n) => <NoteRow key={n.id} note={n} onChanged={onChanged} />)}
          <button className={ghostBtn + ' !bg-white'} onClick={add} disabled={busy}>+ הערה</button>
        </div>
      )}
    </section>
  );
}

function NoteRow({ note, onChanged }) {
  const [text, setText] = useState(note.contentHe || '');
  const dirty = text !== (note.contentHe || '');
  async function save() { try { await api.tourContent.updateNote(note.id, { contentHe: text }); await onChanged(); } catch (e) { alertError('שגיאה', e); } }
  async function remove() { if (!confirm('למחוק את ההערה?')) return; try { await api.tourContent.removeNote(note.id); await onChanged(); } catch (e) { alertError('שגיאה', e); } }
  return (
    <div className="flex items-start gap-2">
      <textarea value={text} onChange={(e) => setText(e.target.value)} onBlur={() => { if (dirty) save(); }} rows={2}
        className="flex-1 resize-y rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200" placeholder="הערה פנימית…" />
      <button onClick={remove} aria-label="מחק" className="text-gray-300 hover:text-red-600 pt-2">×</button>
    </div>
  );
}
