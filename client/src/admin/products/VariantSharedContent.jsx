import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import Dialog from '../common/Dialog.jsx';
import SharedContentEditorDialog from '../shared-content/SharedContentEditorDialog.jsx';
import { TYPE_LABEL, STATE_META, htmlPreview } from '../shared-content/sharedContentMeta.js';

// Per-variant Shared Content manager (Slice 3). One panel per relevant type
// (meeting point, ending point). Shows the current state (linked / standalone /
// inherited / legacy / empty) and offers the reference-safe actions:
//   Create new · Link to existing · Convert legacy · Edit · Fork (this variant) · Detach
// Nothing is copied except an explicit Fork; editing a shared block affects every
// linked draft by reference.

const TYPES = ['meeting_point', 'ending_point'];

const TONE = {
  blue: 'bg-blue-50 text-blue-700 ring-blue-100',
  gray: 'bg-gray-100 text-gray-600 ring-gray-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-100',
  amber: 'bg-amber-50 text-amber-700 ring-amber-100',
};

export default function VariantSharedContent({ variant, locations = [] }) {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(null); // { kind:'create'|'edit'|'link', type, block }
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setState(await api.sharedContent.variantState(variant.id));
    } catch (e) {
      setState(null);
    } finally {
      setLoading(false);
    }
  }, [variant.id]);
  useEffect(() => { refresh(); }, [refresh]);

  async function run(fn) {
    setBusy(true);
    try {
      const next = await fn();
      if (next && next.types) setState(next);
      else await refresh();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }

  async function submitEditor(data) {
    await run(async () => {
      if (dialog.kind === 'edit') {
        await api.sharedContent.update(dialog.block.id, data);
        return null;
      }
      return api.sharedContent.createForVariant(variant.id, data);
    });
    setDialog(null);
  }

  async function pickExisting(id) {
    setBusy(true);
    try {
      await api.sharedContent.link(id, variant.id);
      await refresh();
      setDialog(null);
    } catch (e) {
      if (e.payload?.error === 'type_conflict') {
        // Never overwrite silently — confirm the replace, then retry.
        if (confirm(`הוריאציה כבר משתמשת ב"${e.payload.current?.internalName}" עבור סוג זה. להחליף?`)) {
          try {
            await api.sharedContent.link(id, variant.id, true);
            await refresh();
            setDialog(null);
          } catch (e2) {
            alert('שגיאה: ' + (e2.payload?.error || e2.message));
          }
        }
      } else {
        alert('שגיאה: ' + (e.payload?.error || e.message));
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="text-[12px] text-gray-400">טוען תוכן משותף…</div>;
  if (!state) return <div className="text-[12px] text-red-500">שגיאה בטעינת תוכן משותף.</div>;

  return (
    <div className="space-y-3">
      {TYPES.map((type) => (
        <TypePanel
          key={type}
          type={type}
          info={state.types[type]}
          busy={busy}
          onCreate={() => setDialog({ kind: 'create', type })}
          onEdit={(block) => setDialog({ kind: 'edit', type, block })}
          onLink={() => setDialog({ kind: 'link', type })}
          onConvert={() => run(() => api.sharedContent.convert(variant.id, type))}
          onFork={(block) => {
            if (confirm('לפצל עותק נפרד לוריאציה זו בלבד? שאר הוריאציות המקושרות יישארו על התוכן המקורי.')) {
              run(() => api.sharedContent.fork(block.id, variant.id));
            }
          }}
          onDetach={() => {
            if (confirm('לנתק את הוריאציה מהתוכן המשותף? התוכן עצמו יישאר בספרייה.')) {
              run(() => api.sharedContent.detach(variant.id, type));
            }
          }}
        />
      ))}

      {dialog && dialog.kind !== 'link' && (
        <SharedContentEditorDialog
          open
          onClose={() => { setDialog(null); refresh(); }}
          fixedType={dialog.type}
          initial={dialog.kind === 'edit' ? dialog.block : null}
          locations={locations}
          usedByCount={dialog.kind === 'edit' ? state.types[dialog.type]?.usedByCount || 0 : 0}
          onSubmit={submitEditor}
          submitting={busy}
          onLinksChanged={refresh}
        />
      )}

      {dialog?.kind === 'link' && (
        <LinkPickerDialog
          type={dialog.type}
          currentId={state.types[dialog.type]?.block?.id || null}
          onClose={() => setDialog(null)}
          onPick={pickExisting}
        />
      )}
    </div>
  );
}

function TypePanel({ type, info, busy, onCreate, onEdit, onLink, onConvert, onFork, onDetach }) {
  const meta = STATE_META[info.state] || STATE_META.empty;
  const block = info.block;
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="font-semibold text-[13px] text-gray-800">{TYPE_LABEL[type]}</span>
        <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${TONE[meta.tone]}`}>
          {meta.label}
        </span>
        {info.state !== 'inherited' && info.usedByCount > 0 && (
          <span className="text-[11px] text-gray-500">· בשימוש ב־{info.usedByCount} וריאציות</span>
        )}
      </div>

      {block ? (
        <div className="flex gap-3">
          {block.image?.url && <img src={block.image.url} alt="" className="h-12 w-12 rounded object-cover border border-gray-200 shrink-0" />}
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-gray-800 truncate">{block.internalName}</div>
            <div className="text-[12px] text-gray-500 line-clamp-2">{htmlPreview(block.bodyHe || block.bodyEn) || '(ללא תוכן)'}</div>
          </div>
        </div>
      ) : info.state === 'legacy' ? (
        <div className="text-[12px] text-gray-500 line-clamp-2">{htmlPreview(info.legacy?.he || info.legacy?.en) || '(תוכן ישן)'}</div>
      ) : (
        <div className="text-[12px] text-gray-400">אין תוכן.</div>
      )}

      <div className="flex flex-wrap gap-1.5 mt-2.5">
        {(info.state === 'empty' || info.state === 'inherited') && (
          <Btn onClick={onCreate} disabled={busy}>צור חדש</Btn>
        )}
        {info.state === 'legacy' && (
          <Btn onClick={onConvert} disabled={busy} primary>המר לתוכן משותף</Btn>
        )}
        {(info.state === 'shared' || info.state === 'standalone') && (
          <Btn onClick={() => onEdit(block)} disabled={busy}>{info.state === 'shared' ? 'ערוך (משותף)' : 'ערוך'}</Btn>
        )}
        {info.state === 'shared' && (
          <Btn onClick={() => onFork(block)} disabled={busy}>פצל לוריאציה זו</Btn>
        )}
        <Btn onClick={onLink} disabled={busy}>קשר לקיים</Btn>
        {(info.state === 'shared' || info.state === 'standalone') && (
          <Btn onClick={onDetach} disabled={busy} danger>נתק</Btn>
        )}
      </div>
    </div>
  );
}

function Btn({ children, onClick, disabled, primary, danger }) {
  const cls = primary
    ? 'bg-blue-600 text-white hover:bg-blue-700 border-blue-600'
    : danger
    ? 'bg-white text-red-600 border-red-200 hover:bg-red-50'
    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50';
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`h-8 px-3 rounded-lg border text-[12px] font-medium disabled:opacity-50 ${cls}`}>
      {children}
    </button>
  );
}

// Picker: choose an existing Shared Content of a type to link. Read-only list with
// a live filter; selecting one links it to the variant (replacing the current one).
function LinkPickerDialog({ type, currentId, onClose, onPick }) {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    api.sharedContent.list({ type, active: true }).then((r) => { if (alive) setRows(r); }).catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [type]);

  const filtered = (rows || []).filter((r) => {
    if (!q.trim()) return true;
    const hay = `${r.internalName} ${htmlPreview(r.bodyHe)} ${htmlPreview(r.bodyEn)}`.toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  });

  return (
    <Dialog open onClose={onClose} title={`קישור ל${TYPE_LABEL[type]} קיים`} size="lg">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש לפי שם או תוכן…"
        className="h-10 w-full rounded-lg border border-gray-300 px-3 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-200" />
      {rows === null ? (
        <div className="py-8 text-center text-sm text-gray-400">טוען…</div>
      ) : filtered.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-400">לא נמצא תוכן משותף מסוג זה.</div>
      ) : (
        <ul className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
          {filtered.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => onPick(r.id)} disabled={r.id === currentId}
                className="w-full text-right flex gap-3 px-2 py-2.5 rounded-lg hover:bg-blue-50 disabled:opacity-50 disabled:hover:bg-transparent">
                {r.image?.url && <img src={r.image.url} alt="" className="h-10 w-10 rounded object-cover border border-gray-200 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-gray-800 truncate">
                    {r.internalName}
                    {r.id === currentId && <span className="text-[11px] text-gray-400"> · מקושר כרגע</span>}
                  </div>
                  <div className="text-[12px] text-gray-500 truncate">{htmlPreview(r.bodyHe || r.bodyEn) || '(ללא תוכן)'}</div>
                </div>
                {typeof r.usedByCount === 'number' && <span className="text-[11px] text-gray-400 shrink-0 self-center">{r.usedByCount} וריאציות</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
