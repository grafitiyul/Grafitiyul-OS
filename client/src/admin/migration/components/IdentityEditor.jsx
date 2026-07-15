import { applyIdentityEdit, isRemoved, moveTargetOf, anyEdits } from './identityPreview.js';

// Correcting the SOURCE DATA of a cluster's records: "this phone is on the wrong
// person". Separate from the merge decision above it — a record can need a
// correction whether or not it is a duplicate.
//
// The original snapshot values are always what is listed; a correction is shown as
// a strike-through beside them, never by rewriting them.
export default function IdentityEditor({ members, edits, note, onToggle, onMove, onNote, onSave, onReset, busy, problems, warnings, keySurvives, clusterKind }) {
  const dirty = anyEdits(edits);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h3 className="text-sm font-semibold text-gray-900">תיקון נתוני מקור</h3>
        <span className="text-[11px] text-gray-400">הצילום לעולם לא משתנה — התיקון נשמר כהחלטה נפרדת</span>
      </div>
      <p className="text-[12px] text-gray-500 leading-relaxed mb-3">
        אם טלפון או אימייל רשומים על האדם הלא נכון — סמן אותם כאן. אפשר גם להעביר אותם לרשומה
        אחרת בקבוצה. הייבוא יחיל את התיקון; דפדפן הצילום ימשיך להציג תמיד את הערך המקורי.
      </p>

      <div className="space-y-2">
        {members.map((m) => {
          const edit = edits[m.legacyId];
          const eff = applyIdentityEdit(m, edit);
          const others = members.filter((x) => x.legacyId !== m.legacyId);
          return (
            <div key={m.legacyId} className={`border rounded-lg p-3 ${eff.changed ? 'border-blue-300 bg-blue-50/30' : 'border-gray-200'}`}>
              <div className="text-[13px] font-semibold text-gray-900 mb-1.5">{m.name}</div>
              {!m.phones.length && !m.emails.length && (
                <div className="text-[12px] text-gray-400">אין לרשומה הזו טלפון או אימייל</div>
              )}
              <Identifiers kind="phone" label="טלפון" values={m.phones} member={m} others={others} edits={edits} onToggle={onToggle} onMove={onMove} />
              <Identifiers kind="email" label="אימייל" values={m.emails} member={m} others={others} edits={edits} onToggle={onToggle} onMove={onMove} />

              {/* What arrives from another record. */}
              <Incoming kind="phone" label="טלפון" member={m} edit={edit} members={members} />
              <Incoming kind="email" label="אימייל" member={m} edit={edit} members={members} />

              {eff.changed && (
                <div className="mt-2 pt-2 border-t border-blue-200/60 text-[11px] text-blue-900">
                  לאחר התיקון: {eff.phones.length || eff.emails.length
                    ? [...eff.phones, ...eff.emails].join(' · ')
                    : <span className="text-amber-800">ללא טלפון ואימייל</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* The correction usually removes the very reason the records were grouped. */}
      {dirty && keySurvives && !keySurvives.survives && (
        <div className="mt-3 text-[12px] text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
          לאחר התיקון הרשומות כבר לא חולקות את {clusterKind === 'phone' ? 'מספר הטלפון' : 'כתובת האימייל'} שבגללו הן קובצו יחד.
          סביר שההחלטה הנכונה עכשיו היא <b>"לא כפילות — השאר בנפרד"</b>.
        </div>
      )}

      {warnings?.map((w) => (
        <div key={w} className="mt-2 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">{w}</div>
      ))}
      {problems?.map((p) => (
        <div key={p} className="mt-2 text-[12px] text-red-800 bg-red-50 border border-red-200 rounded px-2 py-1">{p}</div>
      ))}

      <div className="mt-3 pt-3 border-t border-gray-100">
        <label className="block text-[12px] text-gray-600 mb-1">הסבר לתיקון</label>
        <input
          type="text" value={note || ''} onChange={(e) => onNote(e.target.value)}
          placeholder="למשל: האימייל שייך בפועל לאדם השני"
          className="w-full text-[13px] border border-gray-200 rounded-md px-2 py-1.5 bg-white"
        />
        <div className="flex flex-wrap gap-2 mt-2">
          <button
            type="button" disabled={busy || !dirty} onClick={onSave}
            className="text-[13px] px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >שמור תיקון</button>
          <button
            type="button" disabled={busy || !dirty} onClick={onReset}
            className="text-[13px] px-3 py-1.5 rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >בטל שינויים</button>
        </div>
      </div>
    </div>
  );
}

function Identifiers({ kind, label, values, member, others, edits, onToggle, onMove }) {
  if (!values?.length) return null;
  return (
    <div className="space-y-1">
      {values.map((v) => {
        const removed = isRemoved(edits[member.legacyId], kind, v);
        const target = removed ? moveTargetOf(edits, member.legacyId, kind, v) : null;
        return (
          <div key={v} className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-[12px]">
              <input type="checkbox" checked={removed} onChange={() => onToggle(member.legacyId, kind, v)} />
              <span className="text-gray-400">{label}:</span>
              <span className={removed ? 'line-through text-red-600' : 'text-gray-800'}>{v}</span>
            </label>
            {removed && (
              <select
                value={target ?? ''}
                onChange={(e) => onMove(member.legacyId, kind, v, e.target.value === '' ? null : Number(e.target.value))}
                className="text-[11px] border border-gray-200 rounded px-1.5 py-0.5 bg-white"
              >
                <option value="">הסר בלבד</option>
                {others.map((o) => <option key={o.legacyId} value={o.legacyId}>העבר אל: {o.name}</option>)}
              </select>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Incoming({ kind, label, member, edit, members }) {
  const list = (kind === 'phone' ? edit?.addPhones : edit?.addEmails) || [];
  if (!list.length) return null;
  const nameOf = (id) => members.find((m) => m.legacyId === id)?.name || id;
  return (
    <div className="space-y-0.5 mt-1">
      {list.map((a) => (
        <div key={`${a.value}-${a.fromLegacyId}`} className="text-[12px] text-green-800">
          + {label}: <b>{a.value}</b> <span className="text-[11px] text-green-700">(מועבר מ{nameOf(a.fromLegacyId)})</span>
        </div>
      ))}
    </div>
  );
}
