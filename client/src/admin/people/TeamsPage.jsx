import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

// Teams are managed natively in this system. Recruitment does NOT model
// teams and never will — they live here by design. Admins create,
// rename, and delete teams. Guide ↔ team membership is managed via the
// guide profile's Identity section (teamRefId on PersonRef).
export default function TeamsPage() {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);

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
          onClick={() => setCreateOpen(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white rounded-md px-3 py-1.5 text-sm font-medium"
        >
          + צוות חדש
        </button>
      </div>

      <div className="text-[12px] text-gray-600 bg-gray-50 border border-gray-200 rounded px-3 py-2 mb-4">
        צוותים מנוהלים במערכת הזו ואינם מיובאים ממערכת הגיוס. שיוך מדריך
        לצוות נקבע בעמוד הפרופיל של המדריך.
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
          אין צוותים. לחצו "צוות חדש" כדי להוסיף.
        </div>
      )}

      {!loading && !error && teams.length > 0 && (
        <ul className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
          {teams.map((t) => (
            <TeamRow key={t.id} team={t} onChanged={refresh} />
          ))}
        </ul>
      )}

      <CreateTeamDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          refresh();
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
        `למחוק את "${team.displayName}"? מדריכים המשויכים לצוות הזה יישארו בלי צוות.`,
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
            autoFocus
          />
        ) : (
          <div className="font-medium text-gray-900">{team.displayName}</div>
        )}
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
            title="שנה שם"
          >
            ✎
          </button>
          <button
            onClick={remove}
            className="text-[12px] text-red-600 hover:bg-red-50 rounded px-2 py-1"
            title="מחק צוות"
          >
            ×
          </button>
        </>
      )}
    </li>
  );
}

function CreateTeamDialog({ open, onClose, onCreated }) {
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (open) {
      setDisplayName('');
      setErr(null);
    }
  }, [open]);

  if (!open) return null;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.teams.create({ displayName: displayName.trim() });
      onCreated();
    } catch (e2) {
      setErr(e2?.payload?.error || e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-lg shadow-xl w-full max-w-md p-5"
      >
        <div className="text-lg font-semibold mb-3">צוות חדש</div>

        <label className="block mb-3">
          <div className="text-sm font-medium text-gray-800 mb-1">
            שם הצוות <span className="text-red-500">*</span>
          </div>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            autoFocus
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            placeholder="למשל: מדריכי סיורים — צפון"
          />
        </label>

        {err && (
          <div className="text-sm text-red-600 mb-2">
            {err === 'displayName_required' ? 'חובה להזין שם' : err}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md"
          >
            ביטול
          </button>
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-md font-medium disabled:opacity-50"
          >
            {busy ? 'יוצר…' : 'צור צוות'}
          </button>
        </div>
      </form>
    </div>
  );
}
