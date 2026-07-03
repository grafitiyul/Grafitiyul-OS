import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useDirtyWhen } from '../../lib/dirtyForms.js';
import Dialog from '../common/Dialog.jsx';
import ReorderableList from '../common/ReorderableList.jsx';
import { SingleImage } from '../products/ImageUploader.jsx';
import {
  ActiveBadge, Loading, ErrorBox, alertError, Field, TextInput, SectionTitle,
  STATION_KINDS, primaryBtn, ghostBtn,
} from './kit.jsx';

export default function StationDetail() {
  const { stationId } = useParams();
  const nav = useNavigate();
  const [station, setStation] = useState(null);
  const [form, setForm] = useState(null);
  const [original, setOriginal] = useState(null);
  const [heroImage, setHeroImage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [addStepOpen, setAddStepOpen] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const s = await api.tourContent.getStation(stationId);
      setStation(s);
      setHeroImage(s.heroImage || null);
      const init = {
        titleHe: s.titleHe || '',
        descriptionHe: s.descriptionHe || '',
        kind: s.kind || 'location',
        heroImageId: s.heroImageId || null,
        heroImageTitle: s.heroImageTitle || '',
        active: s.active,
      };
      setForm(init);
      setOriginal(init);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [stationId]);
  useEffect(() => { refresh(); }, [refresh]);

  useDirtyWhen(form, original, { active: !!form && !!original });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  function onHeroChange(mf) {
    setHeroImage(mf);
    set('heroImageId', mf?.id || null);
  }

  async function save() {
    setSaving(true);
    try {
      await api.tourContent.updateStation(stationId, form);
      await refresh();
    } catch (e) {
      alertError('שגיאה בשמירה', e);
    } finally {
      setSaving(false);
    }
  }

  async function setActive(active) {
    try {
      await api.tourContent.updateStation(stationId, { active });
      await refresh();
    } catch (e) {
      alertError('שגיאה', e);
    }
  }

  async function reorderSteps(ids) {
    try {
      await api.tourContent.reorderSteps(stationId, ids);
    } catch (e) {
      alertError('שגיאה בעדכון הסדר', e);
      refresh();
    }
  }
  async function removeStep(id) {
    if (!confirm('להסיר את הצעד מהתחנה? (בלוק התוכן עצמו נשאר בספרייה)')) return;
    try { await api.tourContent.removeStep(id); await refresh(); }
    catch (e) { alertError('שגיאה', e); }
  }
  async function toggleStepVisible(step) {
    try { await api.tourContent.updateStep(step.id, { isVisible: !step.isVisible }); await refresh(); }
    catch (e) { alertError('שגיאה', e); }
  }

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;

  const tourId = station.tourId;

  return (
    <div dir="rtl" className="max-w-3xl space-y-8">
      <div className="text-[13px] text-gray-400">
        <Link to="/admin/tour-content/tours" className="hover:text-gray-600">סיורים</Link>
        <span className="mx-1">/</span>
        <Link to={`/admin/tour-content/tours/${tourId}`} className="hover:text-gray-600">הסיור</Link>
        <span className="mx-1">/</span>
        <span className="text-gray-600">{station.titleHe}</span>
      </div>

      {/* Station meta */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <SectionTitle>פרטי התחנה</SectionTitle>
          <div className="flex-1" />
          <ActiveBadge active={station.active} />
        </div>
        <Field label="שם התחנה (עברית)">
          <TextInput value={form.titleHe} onChange={(e) => set('titleHe', e.target.value)} />
        </Field>
        <Field label="תיאור (עברית)">
          <TextInput value={form.descriptionHe} onChange={(e) => set('descriptionHe', e.target.value)} placeholder="אופציונלי" />
        </Field>
        <Field label="סוג התחנה">
          <select
            value={form.kind}
            onChange={(e) => set('kind', e.target.value)}
            className="h-10 w-full rounded-xl border border-gray-300 px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
          >
            {STATION_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </Field>
        <Field label="תמונה ראשית (R2)">
          <SingleImage image={heroImage} onChange={onHeroChange} folder="tour-content/hero" />
        </Field>
        <div className="flex gap-2 pt-1">
          <button className={primaryBtn} onClick={save} disabled={saving}>{saving ? 'שומר…' : 'שמור'}</button>
          {station.active ? (
            <button className={ghostBtn} onClick={() => { if (confirm('להעביר את התחנה לארכיון?')) setActive(false); }}>העברה לארכיון</button>
          ) : (
            <button className={ghostBtn} onClick={() => setActive(true)}>שחזור מארכיון</button>
          )}
        </div>
      </section>

      {/* Steps */}
      <section>
        <SectionTitle count={station.steps.length} action={<button className={primaryBtn} onClick={() => setAddStepOpen(true)}>+ צעד</button>}>
          צעדים
        </SectionTitle>
        <p className="text-[12px] text-gray-400 mb-2">כל צעד מצביע על בלוק תוכן מהספרייה. סדר הצעדים = סדר ההצגה.</p>
        <ReorderableList
          items={station.steps}
          onReorder={reorderSteps}
          emptyText="אין עדיין צעדים בתחנה."
          renderRow={(step, { handle }) => (
            <div className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${step.isVisible ? 'border-gray-200 bg-white' : 'border-gray-200 bg-gray-50'}`}>
              {handle}
              <div className="flex-1 min-w-0">
                <div className={`font-medium truncate ${step.isVisible ? 'text-gray-900' : 'text-gray-400'}`}>
                  {step.contentBlock?.titleHe || '(בלוק ללא כותרת)'}
                  {step.roleHint && <span className="text-[11px] text-gray-400 mr-2">· {step.roleHint}</span>}
                </div>
              </div>
              <Link to={`/admin/tour-content/blocks/${step.contentBlockId}`} className="text-[12px] text-blue-600 hover:underline shrink-0">ערוך תוכן</Link>
              <button onClick={() => toggleStepVisible(step)} title={step.isVisible ? 'מוצג' : 'מוסתר'} className="text-gray-400 hover:text-gray-600 shrink-0">
                {step.isVisible ? '👁' : '🚫'}
              </button>
              <button onClick={() => removeStep(step.id)} aria-label="הסר צעד" className="text-gray-300 hover:text-red-600 shrink-0">×</button>
            </div>
          )}
        />
      </section>

      {/* Notes (admin-only) */}
      <NotesSection stationId={stationId} notes={station.notes} onChanged={refresh} />

      {addStepOpen && (
        <AddStepDialog
          stationId={stationId}
          onClose={() => setAddStepOpen(false)}
          onAdded={async (goToBlockId) => { setAddStepOpen(false); await refresh(); if (goToBlockId) nav(`/admin/tour-content/blocks/${goToBlockId}`); }}
        />
      )}
    </div>
  );
}

// ── Add-step dialog: pick an existing library block OR create a new one ──────────
function AddStepDialog({ stationId, onClose, onAdded }) {
  const [mode, setMode] = useState('new'); // 'new' | 'library'
  const [titleHe, setTitleHe] = useState('');
  const [q, setQ] = useState('');
  const [blocks, setBlocks] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode !== 'library') return;
    let live = true;
    api.tourContent.listBlocks({ shared: true, active: true, q: q || undefined })
      .then((r) => { if (live) setBlocks(r); })
      .catch(() => {});
    return () => { live = false; };
  }, [mode, q]);

  async function createNew() {
    if (!titleHe.trim()) return;
    setBusy(true);
    try {
      const step = await api.tourContent.createStep(stationId, { block: { titleHe: titleHe.trim(), shared: false } });
      onAdded(step.contentBlockId); // jump to the new block editor
    } catch (e) { alertError('שגיאה', e); setBusy(false); }
  }
  async function pick(blockId) {
    setBusy(true);
    try { await api.tourContent.createStep(stationId, { contentBlockId: blockId }); onAdded(null); }
    catch (e) { alertError('שגיאה', e); setBusy(false); }
  }

  return (
    <Dialog open onClose={onClose} title="הוספת צעד" size="lg">
      <div className="flex gap-1 mb-4">
        <button className={`px-3 py-1.5 text-sm rounded-lg ${mode === 'new' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-100'}`} onClick={() => setMode('new')}>בלוק חדש</button>
        <button className={`px-3 py-1.5 text-sm rounded-lg ${mode === 'library' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-100'}`} onClick={() => setMode('library')}>מהספרייה</button>
      </div>

      {mode === 'new' ? (
        <div className="space-y-3">
          <Field label="כותרת הבלוק (עברית)">
            <TextInput autoFocus value={titleHe} onChange={(e) => setTitleHe(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') createNew(); }} placeholder="לדוגמה: הסיפור של הקיר" />
          </Field>
          <p className="text-[12px] text-gray-400">ייווצר בלוק חדש (לא משותף) ותועברו לעריכת התוכן שלו.</p>
          <div className="flex justify-end gap-2">
            <button className={ghostBtn} onClick={onClose} disabled={busy}>ביטול</button>
            <button className={primaryBtn} onClick={createNew} disabled={busy || !titleHe.trim()}>{busy ? 'יוצר…' : 'צור והמשך'}</button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש בספריית התוכן…" />
          <ul className="max-h-72 overflow-y-auto space-y-1">
            {blocks.length === 0 && <li className="text-sm text-gray-400 py-6 text-center">אין בלוקים משותפים תואמים.</li>}
            {blocks.map((b) => (
              <li key={b.id}>
                <button className="w-full text-right rounded-lg border border-gray-200 px-3 py-2 hover:border-blue-300 hover:bg-blue-50/40" onClick={() => pick(b.id)} disabled={busy}>
                  <div className="font-medium text-gray-900 truncate">{b.titleHe || '(ללא כותרת)'}</div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  );
}

// ── Notes section (admin-only) ──────────────────────────────────────────────────
function NotesSection({ stationId, notes, onChanged }) {
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    try { await api.tourContent.createNote(stationId, { contentHe: '' }); await onChanged(); }
    catch (e) { alertError('שגיאה', e); } finally { setBusy(false); }
  }
  async function reorder(ids) {
    try { await api.tourContent.reorderNotes(stationId, ids); }
    catch (e) { alertError('שגיאה בעדכון הסדר', e); onChanged(); }
  }

  return (
    <section>
      <SectionTitle count={notes.length} action={<button className={ghostBtn} onClick={add} disabled={busy}>+ הערה</button>}>
        הערות פנימיות
      </SectionTitle>
      <p className="text-[12px] text-gray-400 mb-2">הערות אדמין בלבד — לא מוצגות לחניך.</p>
      <ReorderableList
        items={notes}
        onReorder={reorder}
        emptyText="אין הערות."
        renderRow={(note, { handle }) => <NoteRow note={note} handle={handle} onChanged={onChanged} />}
      />
    </section>
  );
}

function NoteRow({ note, handle, onChanged }) {
  const [text, setText] = useState(note.contentHe || '');
  const dirty = text !== (note.contentHe || '');

  async function save() {
    try { await api.tourContent.updateNote(note.id, { contentHe: text }); await onChanged(); }
    catch (e) { alertError('שגיאה', e); }
  }
  async function remove() {
    if (!confirm('למחוק את ההערה?')) return;
    try { await api.tourContent.removeNote(note.id); await onChanged(); }
    catch (e) { alertError('שגיאה', e); }
  }

  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2">
      <div className="pt-1">{handle}</div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => { if (dirty) save(); }}
        rows={2}
        className="flex-1 resize-y rounded-lg border border-amber-200 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200"
        placeholder="הערה פנימית…"
      />
      <button onClick={remove} aria-label="מחק הערה" className="text-gray-300 hover:text-red-600 pt-1">×</button>
    </div>
  );
}
