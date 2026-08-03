import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';

// זמני שליחה — a 3×2 matrix: who is on the receiving end × which channel.
//
// The windows themselves (weekly rules, date exceptions) are still authored in
// the Communication Center; this only decides WHICH window governs which
// audience on which channel. Two screens, one set of windows — never a second
// scheduling model.
//
// The important promise, stated on the screen: a held message is never dropped.

// Hebrew day letters, Sunday-first — matches the rules model (0=Sunday).
const DAY_HE = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

/** [0,1,2,3,4] → "א׳–ה׳"; [5] → "ו׳"; [0,2] → "א׳, ג׳". */
function dayRange(days) {
  const d = [...new Set(days)].sort((a, b) => a - b);
  if (!d.length) return '';
  const runs = [];
  let start = d[0]; let prev = d[0];
  for (const x of d.slice(1)) {
    if (x === prev + 1) { prev = x; continue; }
    runs.push([start, prev]); start = x; prev = x;
  }
  runs.push([start, prev]);
  return runs.map(([a, b]) => (a === b ? DAY_HE[a] : DAY_HE[a] + '–' + DAY_HE[b])).join(', ');
}

/** One line per rule — the operator reads the ACTUAL schedule, not a name. */
function WindowSummary({ window }) {
  const rules = window?.rules || [];
  if (!rules.length) return null;
  return (
    <div className="mt-1 space-y-0.5 text-[11px] leading-snug text-gray-500">
      {rules.map((r, i) => (
        <div key={i}>{dayRange(r.days)} {r.start}–{r.end}</div>
      ))}
    </div>
  );
}

export default function SendingWindowsPanel({ onSaved }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await api.queue.policies());
    } catch (e) {
      setError(e.payload?.error || e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (audienceKind, channel, patch) => {
    const key = `${audienceKind}:${channel}`;
    setBusy(key);
    setError('');
    try {
      const r = await api.queue.setPolicy(audienceKind, channel, patch);
      setData((d) => ({ ...d, policies: r.policies }));
      onSaved?.();
    } catch (e) {
      setError(e.payload?.error === 'window_required'
        ? 'כדי להפעיל זמני שליחה יש לבחור חלון'
        : (e.payload?.error || e.message));
    } finally {
      setBusy('');
    }
  };

  if (!data) return null;

  const cell = (audienceKind, channel) =>
    data.policies.find((p) => p.audienceKind === audienceKind && p.channel === channel);

  return (
    <section className="mt-8 rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-[15px] font-semibold text-gray-900">זמני שליחה</h2>
      <p className="mt-1 text-[12.5px] leading-relaxed text-gray-600">
        קובעים מתי מותר לשלוח לכל קהל בכל ערוץ. הודעה שנוצרה מחוץ לחלון —
        או שהצטברה בזמן שהחיבור היה מנותק — <strong>לא נמחקת</strong>: היא
        ממתינה ונשלחת בפתיחת החלון הבא.
      </p>

      {error ? (
        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{error}</div>
      ) : null}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] text-[13px]">
          <thead>
            <tr className="text-[12px] text-gray-500">
              <th className="px-2 py-2 text-start font-medium">קהל</th>
              <th className="px-2 py-2 text-start font-medium">💬 WhatsApp</th>
              <th className="px-2 py-2 text-start font-medium">✉️ אימייל</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.audienceKinds.map((a) => (
              <tr key={a.key}>
                <td className="px-2 py-3 font-medium text-gray-800">{a.labelHe}</td>
                {data.channels.map((ch) => {
                  const c = cell(a.key, ch);
                  const key = `${a.key}:${ch}`;
                  return (
                    <td key={ch} className="px-2 py-3">
                      <select
                        disabled={busy === key}
                        value={c?.enabled ? (c.windowId || '') : ''}
                        onChange={(e) => {
                          const windowId = e.target.value;
                          save(a.key, ch, windowId
                            ? { enabled: true, windowId }
                            : { enabled: false, windowId: null });
                        }}
                        className="w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[12.5px] disabled:bg-gray-50"
                      >
                        <option value="">ללא הגבלה — נשלח מיד</option>
                        {data.windows.map((w) => (
                          <option key={w.id} value={w.id}>{w.name}</option>
                        ))}
                      </select>
                      {c?.enabled && c.windowId ? (
                        <WindowSummary window={data.windows.find((w) => w.id === c.windowId)} />
                      ) : (
                        <div className="mt-1 text-[11px] text-gray-400">אין חלון פעיל — הודעות יישלחו מיד</div>
                      )}
                      {c?.updatedByName ? (
                        <div className="mt-0.5 text-[11px] text-gray-400">עודכן ע״י {c.updatedByName}</div>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11.5px] text-gray-500">
        החלונות עצמם (שעות בשבוע, חריגות ותאריכים חסומים) מוגדרים ב
        <Link to="/admin/settings/communication" className="text-blue-600 hover:underline">מרכז התקשורת</Link>.
        חסימת תאריך גוברת תמיד — גם על קהל ללא הגבלה.
        מסר שנבחר לו חלון ספציפי במרכז התקשורת שומר עליו וגובר על הטבלה הזו.
      </p>
    </section>
  );
}
