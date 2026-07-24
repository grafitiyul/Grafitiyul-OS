import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import Dialog from '../common/Dialog.jsx';
import ConfirmDialog from '../common/ConfirmDialog.jsx';

// "זמני שליחה" — sending-window policies + date exceptions management.
// Weekly allow-rules per window (days × start–end, Israel time) and
// allow/block exceptions (global or window-scoped). Precedence is fixed and
// shown to the user: a block ALWAYS wins (safety first), then allow
// exceptions, then the weekly rules.

const DAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const inputCls = 'rounded-lg border border-gray-300 px-2.5 py-1.5 text-[13px] focus:border-blue-400 focus:outline-none';

export default function SendingWindowsDialog({ onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async () => {
    try { setData(await api.communication.windows()); }
    catch (err) { setError(err?.payload?.error || err.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function addWindow() {
    await api.communication.createWindow({
      name: 'חלון חדש',
      rules: [
        { days: [0, 1, 2, 3, 4], start: '08:30', end: '20:00' },
        { days: [5], start: '08:30', end: '14:00' },
      ],
    });
    load();
  }

  return (
    <Dialog open onClose={onClose} title="זמני שליחה" size="2xl">
      <div dir="rtl" className="space-y-5 p-1">
        <div className="rounded-lg bg-gray-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-gray-600">
          מסר שמסומן «כפוף לחלון שליחה» ממתין לחלון הפתוח הבא; מסר שאינו כפוף נשלח מיד.
          <span className="font-semibold"> חסימה מפורשת (למשל יום כיפור) גוברת תמיד — גם על חריגות אישור וגם על מסרים שאינם כפופים לחלון.</span>
          {' '}כל השעות בשעון ישראל.
        </div>
        {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">שגיאה: {error}</div>}
        {!data && !error && <div className="py-8 text-center text-[13px] text-gray-400">טוען…</div>}

        {data && (
          <>
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[14px] font-bold text-gray-900">חלונות שליחה</h3>
                <button type="button" onClick={addWindow}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-blue-700">
                  + חלון חדש
                </button>
              </div>
              {data.windows.length === 0 && (
                <div className="rounded-xl border border-dashed border-gray-300 px-4 py-8 text-center text-[13px] text-gray-400">
                  אין עדיין חלונות — צרו חלון ראשון (למשל «לקוחות: א׳–ה׳ 08:30–20:00, ו׳ עד 14:00»).
                </div>
              )}
              <div className="space-y-3">
                {data.windows.map((w) => (
                  <WindowCard key={w.id} window={w} onChanged={load}
                    onDelete={() => setConfirm({
                      title: 'מחיקת חלון',
                      body: w._count?.messages
                        ? `החלון "${w.name}" משויך ל-${w._count.messages} מסרים ולא ניתן למחוק אותו.`
                        : `למחוק את החלון "${w.name}"?`,
                      blocked: !!w._count?.messages,
                      action: async () => { await api.communication.deleteWindow(w.id); load(); },
                    })} />
                ))}
              </div>
            </section>

            <ExceptionsSection data={data} onChanged={load} />
          </>
        )}
      </div>
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title}
        body={confirm?.body}
        confirmLabel={confirm?.blocked ? 'הבנתי' : 'מחק'}
        danger={!confirm?.blocked}
        onCancel={() => setConfirm(null)}
        onConfirm={() => { if (!confirm?.blocked) confirm?.action?.(); setConfirm(null); }}
      />
    </Dialog>
  );
}

function WindowCard({ window: w, onChanged, onDelete }) {
  const [name, setName] = useState(w.name);
  const [rules, setRules] = useState(w.rules || []);
  const dirty = name !== w.name || JSON.stringify(rules) !== JSON.stringify(w.rules || []);

  async function save() {
    try {
      await api.communication.updateWindow(w.id, { name, rules });
      onChanged();
    } catch (err) {
      alert(`שמירה נכשלה: ${err?.payload?.error || err.message}`);
    }
  }
  const updateRule = (i, patch) => setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[15px]">🕐</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)}
          className={`${inputCls} flex-1 font-semibold`} />
        {w._count?.messages > 0 && (
          <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-medium text-blue-700 ring-1 ring-blue-200">
            {w._count.messages} מסרים משתמשים
          </span>
        )}
        {dirty && (
          <button type="button" onClick={save}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700">שמור</button>
        )}
        <button type="button" onClick={onDelete}
          className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600" title="מחק חלון">🗑</button>
      </div>
      <div className="space-y-2">
        {rules.map((rule, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 px-3 py-2">
            <div className="flex gap-1">
              {DAYS.map((d, di) => {
                const on = (rule.days || []).includes(di);
                return (
                  <button key={di} type="button"
                    onClick={() => updateRule(i, { days: on ? rule.days.filter((x) => x !== di) : [...(rule.days || []), di].sort() })}
                    className={`h-7 w-7 rounded-full text-[11.5px] font-semibold ring-1 transition-colors ${
                      on ? 'bg-blue-600 text-white ring-blue-600' : 'bg-white text-gray-500 ring-gray-300 hover:bg-gray-100'
                    }`}>
                    {d}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-1.5 text-[13px] text-gray-600">
              <span>מ-</span>
              <input type="time" value={rule.start || ''} onChange={(e) => updateRule(i, { start: e.target.value })} className={inputCls} dir="ltr" />
              <span>עד</span>
              <input type="time" value={rule.end || ''} onChange={(e) => updateRule(i, { end: e.target.value })} className={inputCls} dir="ltr" />
            </div>
            <button type="button" onClick={() => setRules(rules.filter((_, j) => j !== i))}
              className="mr-auto rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600" title="הסר שורה">✕</button>
          </div>
        ))}
        <button type="button" onClick={() => setRules([...rules, { days: [0, 1, 2, 3, 4], start: '08:30', end: '20:00' }])}
          className="rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-[12px] text-gray-500 hover:border-blue-300 hover:text-blue-600">
          + שורת ימים ושעות
        </button>
      </div>
    </div>
  );
}

function ExceptionsSection({ data, onChanged }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ kind: 'block', label: '', dateFrom: '', dateTo: '', startTime: '', endTime: '', windowId: '' });

  async function add() {
    try {
      await api.communication.createException({
        kind: form.kind, label: form.label, dateFrom: form.dateFrom,
        dateTo: form.dateTo || null, startTime: form.startTime || null, endTime: form.endTime || null,
        windowId: form.windowId || null,
      });
      setAdding(false);
      setForm({ kind: 'block', label: '', dateFrom: '', dateTo: '', startTime: '', endTime: '', windowId: '' });
      onChanged();
    } catch (err) {
      alert(`הוספה נכשלה: ${err?.payload?.error || err.message}`);
    }
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[14px] font-bold text-gray-900">חריגות — חסימות ואישורים</h3>
        <button type="button" onClick={() => setAdding((v) => !v)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[12.5px] font-medium text-gray-700 hover:bg-gray-50">
          + חריגה חדשה
        </button>
      </div>

      {adding && (
        <div className="mb-3 flex flex-wrap items-end gap-2 rounded-xl border border-blue-200 bg-blue-50/50 p-3">
          <div>
            <label className="block text-[11px] font-semibold text-gray-600">סוג</label>
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className={`${inputCls} bg-white`}>
              <option value="block">🚫 חסימה (למשל יום כיפור)</option>
              <option value="allow">✅ אישור חריג (למשל ביטול דחוף)</option>
            </select>
          </div>
          <div className="min-w-[160px] flex-1">
            <label className="block text-[11px] font-semibold text-gray-600">תיאור</label>
            <input type="text" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="למשל: ערב יום כיפור" className={`${inputCls} w-full`} />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-gray-600">מתאריך</label>
            <input type="date" value={form.dateFrom} onChange={(e) => setForm({ ...form, dateFrom: e.target.value })} className={inputCls} dir="ltr" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-gray-600">עד (אופציונלי)</label>
            <input type="date" value={form.dateTo} onChange={(e) => setForm({ ...form, dateTo: e.target.value })} className={inputCls} dir="ltr" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-gray-600">משעה</label>
            <input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} className={inputCls} dir="ltr" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-gray-600">עד שעה</label>
            <input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} className={inputCls} dir="ltr" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-gray-600">תחולה</label>
            <select value={form.windowId} onChange={(e) => setForm({ ...form, windowId: e.target.value })} className={`${inputCls} bg-white`}>
              <option value="">גלובלי — כל המסרים</option>
              {data.windows.map((w) => <option key={w.id} value={w.id}>רק החלון: {w.name}</option>)}
            </select>
          </div>
          <button type="button" onClick={add} disabled={!form.label.trim() || !form.dateFrom}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-[12.5px] font-semibold text-white hover:bg-blue-700 disabled:opacity-40">
            הוסף
          </button>
        </div>
      )}

      {data.exceptions.length === 0 && !adding && (
        <div className="rounded-xl border border-dashed border-gray-300 px-4 py-6 text-center text-[12.5px] text-gray-400">
          אין חריגות. חסימות (חגים, תאריכים סגורים) ואישורים חריגים יופיעו כאן.
        </div>
      )}
      <div className="space-y-1.5">
        {data.exceptions.map((x) => (
          <div key={x.id} className={`flex flex-wrap items-center gap-2.5 rounded-lg border px-3 py-2 text-[12.5px] ${
            x.kind === 'block' ? 'border-red-100 bg-red-50/50' : 'border-emerald-100 bg-emerald-50/50'
          } ${x.active ? '' : 'opacity-50'}`}>
            <span>{x.kind === 'block' ? '🚫' : '✅'}</span>
            <span className="font-medium text-gray-800">{x.label}</span>
            <span className="text-gray-500" dir="ltr">
              {x.dateFrom}{x.dateTo && x.dateTo !== x.dateFrom ? ` → ${x.dateTo}` : ''}
              {x.startTime ? ` ${x.startTime}–${x.endTime || ''}` : ''}
            </span>
            <span className="text-gray-400">
              {x.windowId ? `חלון: ${data.windows.find((w) => w.id === x.windowId)?.name || '?'}` : 'גלובלי'}
            </span>
            <div className="mr-auto flex items-center gap-1">
              <button type="button"
                onClick={async () => { await api.communication.updateException(x.id, { active: !x.active }); onChanged(); }}
                className="rounded px-2 py-0.5 text-[11.5px] text-gray-500 hover:bg-white">
                {x.active ? 'השבת' : 'הפעל'}
              </button>
              <button type="button"
                onClick={async () => { await api.communication.deleteException(x.id); onChanged(); }}
                className="rounded p-1 text-gray-400 hover:bg-white hover:text-red-600" title="מחק">✕</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
