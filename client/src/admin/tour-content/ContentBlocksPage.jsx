import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import Dialog from '../common/Dialog.jsx';
import {
  ActiveBadge, Loading, ErrorBox, alertError, Field, TextInput, primaryBtn, ghostBtn,
} from './kit.jsx';

// Reusable content-block library. A block can be placed as a step in many
// stations/tours (by reference). This page lists the shared library.
export default function ContentBlocksPage() {
  const nav = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [titleHe, setTitleHe] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setRows(await api.tourContent.listBlocks());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const shown = rows.filter((b) => {
    if (!showArchived && !b.active) return false;
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return (b.titleHe || '').toLowerCase().includes(s);
  });

  async function createBlock() {
    if (!titleHe.trim()) return;
    setBusy(true);
    try {
      const b = await api.tourContent.createBlock({ titleHe: titleHe.trim(), shared: true });
      setShowCreate(false);
      setTitleHe('');
      nav(`/admin/tour-content/blocks/${b.id}`);
    } catch (e) {
      alertError('שגיאה ביצירת בלוק', e);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;

  return (
    <div dir="rtl" className="max-w-3xl">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <p className="text-sm text-gray-500">בלוקים לשימוש חוזר — כל בלוק יכול להופיע במספר תחנות וסיורים.</p>
        <div className="flex-1" />
        <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש…" className="!h-9 !w-48" />
        <label className="flex items-center gap-1.5 text-[13px] text-gray-500">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          ארכיון
        </label>
        <button className={primaryBtn} onClick={() => setShowCreate(true)}>+ בלוק חדש</button>
      </div>

      {shown.length === 0 ? (
        <div className="px-3 py-16 text-center text-sm text-gray-400">
          {rows.length === 0 ? 'אין עדיין בלוקים בספרייה.' : 'אין תוצאות.'}
        </div>
      ) : (
        <ul className="space-y-1">
          {shown.map((b) => (
            <li key={b.id}>
              <button
                className="w-full flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-3 text-right hover:border-gray-300"
                onClick={() => nav(`/admin/tour-content/blocks/${b.id}`)}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900 truncate">{b.titleHe || '(ללא כותרת)'}</div>
                  {!b.shared && <span className="text-[11px] text-gray-400">חד-פעמי</span>}
                </div>
                <ActiveBadge active={b.active} />
                <span className="text-gray-300 text-sm">‹</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="בלוק תוכן חדש"
        footer={
          <>
            <button className={ghostBtn} onClick={() => setShowCreate(false)} disabled={busy}>ביטול</button>
            <button className={primaryBtn} onClick={createBlock} disabled={busy || !titleHe.trim()}>{busy ? 'יוצר…' : 'צור'}</button>
          </>
        }
      >
        <Field label="כותרת (עברית)">
          <TextInput autoFocus value={titleHe} onChange={(e) => setTitleHe(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') createBlock(); }} placeholder="לדוגמה: הסבר על טכניקת הסטנסיל" />
        </Field>
      </Dialog>
    </div>
  );
}
