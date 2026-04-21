import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api.js';

// Flow assignment dialog. Three independent targeting bits (openToAll +
// target teams + target people) plus the mandatory/optional flag that
// drives the learner portal's "ללמידה / זמינים" split. Any combination is
// valid — visibility is the union of all three targeting modes.
//
// Keeps a clear warning visible when no targeting is configured, so
// admins notice a flow that nobody will see.
export default function AssignmentDialog({ flowId, open, onClose }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null); // { openToAll, mandatory, teamRefIds, personRefIds }
  const [teams, setTeams] = useState([]);
  const [people, setPeople] = useState([]);
  const [peopleSearch, setPeopleSearch] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [assignment, t, p] = await Promise.all([
        api.flows.getAssignment(flowId),
        api.teams.list(),
        api.people.list(),
      ]);
      setData({
        openToAll: !!assignment.openToAll,
        mandatory: !!assignment.mandatory,
        teamRefIds: new Set(assignment.teamRefIds),
        personRefIds: new Set(assignment.personRefIds),
      });
      setTeams(t);
      setPeople(p);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [flowId]);

  useEffect(() => {
    if (open) reload();
  }, [open, reload]);

  const filteredPeople = useMemo(() => {
    const q = peopleSearch.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) =>
      [p.displayName, p.email, p.phone, p.externalPersonId]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [people, peopleSearch]);

  if (!open) return null;

  function toggleTeam(id) {
    setData((d) => {
      const next = new Set(d.teamRefIds);
      next.has(id) ? next.delete(id) : next.add(id);
      return { ...d, teamRefIds: next };
    });
  }
  function togglePerson(id) {
    setData((d) => {
      const next = new Set(d.personRefIds);
      next.has(id) ? next.delete(id) : next.add(id);
      return { ...d, personRefIds: next };
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.flows.saveAssignment(flowId, {
        openToAll: data.openToAll,
        mandatory: data.mandatory,
        teamRefIds: Array.from(data.teamRefIds),
        personRefIds: Array.from(data.personRefIds),
      });
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const nothingAssigned =
    data &&
    !data.openToAll &&
    data.teamRefIds.size === 0 &&
    data.personRefIds.size === 0;

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col"
      >
        <div className="px-5 py-3 border-b border-gray-200 flex items-center">
          <h3 className="text-lg font-semibold text-gray-900 flex-1">
            הקצאה
          </h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-800 text-xl"
            aria-label="סגור"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading || !data ? (
            <div className="text-sm text-gray-500">טוען…</div>
          ) : (
            <>
              <section>
                <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-2">
                  חובה / רשות
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={data.mandatory}
                    onChange={(e) =>
                      setData({ ...data, mandatory: e.target.checked })
                    }
                  />
                  <span>נוהל חובה</span>
                  <span className="text-[11px] text-gray-500">
                    (משפיע על הופעת הנוהל בסעיף "נהלים ללמידה" מול "נהלים
                    זמינים")
                  </span>
                </label>
              </section>

              <section>
                <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-2">
                  פתוח לכולם
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={data.openToAll}
                    onChange={(e) =>
                      setData({ ...data, openToAll: e.target.checked })
                    }
                  />
                  <span>הצג את הנוהל לכל המדריכים</span>
                </label>
              </section>

              <section>
                <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-2">
                  צוותים ({data.teamRefIds.size})
                </div>
                {teams.length === 0 ? (
                  <div className="text-[12px] text-gray-500 italic">
                    אין צוותים. צרו צוותים במסך "אנשים → צוותים".
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {teams.map((t) => {
                      const sel = data.teamRefIds.has(t.id);
                      return (
                        <button
                          key={t.id}
                          onClick={() => toggleTeam(t.id)}
                          className={`text-[12px] rounded-full border px-3 py-1 transition ${
                            sel
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          {t.displayName}
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>

              <section>
                <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-2 flex items-center">
                  <span className="flex-1">
                    מדריכים ספציפיים ({data.personRefIds.size})
                  </span>
                  <input
                    type="search"
                    value={peopleSearch}
                    onChange={(e) => setPeopleSearch(e.target.value)}
                    placeholder="חיפוש…"
                    className="text-[12px] border border-gray-300 rounded px-2 py-1 w-40"
                  />
                </div>
                {people.length === 0 ? (
                  <div className="text-[12px] text-gray-500 italic">
                    אין מדריכים. הוסיפו במסך "אנשים".
                  </div>
                ) : (
                  <ul className="border border-gray-200 rounded max-h-56 overflow-y-auto divide-y divide-gray-100">
                    {filteredPeople.map((p) => {
                      const sel = data.personRefIds.has(p.id);
                      return (
                        <li key={p.id}>
                          <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={sel}
                              onChange={() => togglePerson(p.id)}
                            />
                            <span className="text-sm text-gray-900 flex-1 min-w-0 truncate">
                              {p.displayName}
                            </span>
                            <span className="text-[11px] text-gray-500 truncate">
                              {p.team?.displayName || ''}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                    {filteredPeople.length === 0 && (
                      <li className="px-3 py-3 text-[12px] text-gray-500 italic">
                        לא נמצאו תוצאות.
                      </li>
                    )}
                  </ul>
                )}
              </section>

              {nothingAssigned && (
                <div className="text-[12px] bg-amber-50 border border-amber-200 text-amber-800 rounded px-3 py-2">
                  לא הוגדרו יעדים. הנוהל לא יהיה נראה לאף מדריך.
                </div>
              )}
            </>
          )}
        </div>

        {error && (
          <div className="px-5 py-2 text-sm text-red-600">{error}</div>
        )}
        <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md"
          >
            ביטול
          </button>
          <button
            onClick={save}
            disabled={saving || !data}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-md font-medium disabled:opacity-50"
          >
            {saving ? 'שומר…' : 'שמור הקצאה'}
          </button>
        </div>
      </div>
    </div>
  );
}
