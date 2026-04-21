import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

// TeamRef is a read-only reference layer into the recruitment system's
// teams. Rows are NEVER created manually here. The "ייבוא" action pulls
// the latest snapshot from the recruitment source and upserts by
// externalTeamId. Local display-name edits are allowed as a cache
// correction but will be overwritten on the next import.
export default function TeamsPage() {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [importOpen, setImportOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTeams(await api.teams.list());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-lg font-semibold text-gray-900">צוותים</h1>
        <span className="text-[12px] text-gray-500">({teams.length})</span>
        <div className="flex-1" />
        <button
          onClick={() => setImportOpen(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white rounded-md px-3 py-1.5 text-sm font-medium"
          title="ייבוא צוותים ממערכת הגיוס"
        >
          ⬇ ייבוא ממערכת הגיוס
        </button>
      </div>

      <div className="text-[12px] text-gray-600 bg-gray-50 border border-gray-200 rounded px-3 py-2 mb-4">
        הצוותים נוצרים במערכת הגיוס ומיובאים לכאן. המזהה החיצוני הוא
        מזהה מערכת — הוא לא נערך ידנית כאן. ייבוא חוזר מעדכן שמות של
        צוותים שכבר יובאו ומוסיף חדשים.
      </div>

      {loading && (
        <div className="p-6 text-center text-sm text-gray-500">טוען…</div>
      )}
      {error && (
        <div className="p-6 text-center">
          <div className="text-sm text-red-600 mb-2">שגיאה בטעינה</div>
          <div className="text-xs text-gray-500 font-mono" dir="ltr">
            {error}
          </div>
        </div>
      )}

      {!loading && !error && teams.length === 0 && (
        <div className="p-10 text-center text-sm text-gray-500">
          אין צוותים. לחצו "ייבוא ממערכת הגיוס" כדי לטעון את הרשימה.
        </div>
      )}

      {!loading && !error && teams.length > 0 && (
        <ul className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
          {teams.map((t) => (
            <TeamRow key={t.id} team={t} onChanged={refresh} />
          ))}
        </ul>
      )}

      <ImportTeamsDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={async () => {
          setImportOpen(false);
          await refresh();
        }}
      />
    </div>
  );
}

function TeamRow({ team, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(team.displayName);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(team.displayName);
  }, [team]);

  async function save() {
    setBusy(true);
    try {
      await api.teams.update(team.id, { displayName: name.trim() });
      await onChanged();
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (
      !window.confirm(
        `למחוק את "${team.displayName}"? ניתן לייבא אותו שוב ממערכת הגיוס.`,
      )
    )
      return;
    await api.teams.remove(team.id);
    onChanged();
  }

  return (
    <li className="px-3 py-2 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm"
          />
        ) : (
          <div className="font-medium text-gray-900">{team.displayName}</div>
        )}
        <div className="text-[11px] text-gray-500 font-mono truncate" dir="ltr">
          {team.externalTeamId}
        </div>
      </div>
      {editing ? (
        <>
          <button
            onClick={() => {
              setEditing(false);
              setName(team.displayName);
            }}
            disabled={busy}
            className="text-[12px] border border-gray-300 rounded px-2 py-1"
          >
            ביטול
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="text-[12px] bg-blue-600 text-white rounded px-3 py-1"
          >
            {busy ? 'שומר…' : 'שמור'}
          </button>
        </>
      ) : (
        <>
          <button
            onClick={() => setEditing(true)}
            className="text-[12px] text-blue-700 hover:bg-blue-50 rounded px-2 py-1"
            title="עריכה מקומית (תידרס בייבוא הבא)"
          >
            ✎
          </button>
          <button
            onClick={remove}
            className="text-[12px] text-red-600 hover:bg-red-50 rounded px-2 py-1"
          >
            ×
          </button>
        </>
      )}
    </li>
  );
}

// ── Import dialog ───────────────────────────────────────────────────────────

function ImportTeamsDialog({ open, onClose, onImported }) {
  const [snap, setSnap] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setErr(null);
    setSnap(null);
    (async () => {
      try {
        setSnap(await api.recruitment.teams());
      } catch (e) {
        setErr(e.message);
      }
    })();
  }, [open]);

  if (!open) return null;

  async function doImport() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.teams.importFromRecruitment();
      setResult(r);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[85vh] flex flex-col"
      >
        <div className="px-5 py-3 border-b border-gray-200 flex items-center">
          <h3 className="text-lg font-semibold text-gray-900 flex-1">
            ייבוא צוותים ממערכת הגיוס
          </h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-800 text-xl"
            aria-label="סגור"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {!snap && !err && (
            <div className="text-sm text-gray-500">טוען רשימת מקור…</div>
          )}
          {err && <div className="text-sm text-red-600">{err}</div>}
          {snap && (
            <>
              <div className="text-[12px] text-gray-600 bg-gray-50 border border-gray-200 rounded px-3 py-2">
                הרשומות למטה מגיעות ממערכת הגיוס. אינן ניתנות לעריכה
                כאן.
              </div>
              <ul className="border border-gray-200 rounded divide-y divide-gray-100">
                {snap.map((t) => (
                  <li
                    key={t.externalTeamId}
                    className="px-3 py-2 text-sm flex items-center gap-2"
                  >
                    <span className="flex-1 font-medium text-gray-900 truncate">
                      {t.displayName}
                    </span>
                    <span
                      className="text-[11px] text-gray-500 font-mono"
                      dir="ltr"
                    >
                      {t.externalTeamId}
                    </span>
                  </li>
                ))}
                {snap.length === 0 && (
                  <li className="px-3 py-3 text-[12px] text-gray-500 italic">
                    אין רשומות במקור.
                  </li>
                )}
              </ul>
              {result && (
                <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
                  ייבוא הושלם: {result.created} חדשים, {result.updated}{' '}
                  עודכנו.
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md"
          >
            סגור
          </button>
          <button
            onClick={result ? onImported : doImport}
            disabled={busy || !snap}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-md font-medium disabled:opacity-50"
          >
            {busy ? 'מייבא…' : result ? 'סיום' : 'ייבא'}
          </button>
        </div>
      </div>
    </div>
  );
}
