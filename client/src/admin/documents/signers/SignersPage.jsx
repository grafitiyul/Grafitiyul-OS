import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../../lib/api.js';
import SignerDetail from './SignerDetail.jsx';

// Signers tab: list on the leading edge, detail on the main edge.
export default function SignersPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.signers.list();
      setList(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const inDetail = !!id;
  const listCls = inDetail
    ? 'hidden lg:flex w-full lg:w-[320px] lg:shrink-0 bg-white border-l border-gray-200 flex-col min-h-0'
    : 'flex w-full lg:w-[320px] lg:shrink-0 bg-white border-l border-gray-200 flex-col min-h-0';
  const workCls = inDetail
    ? 'flex flex-1 bg-gray-50 min-h-0'
    : 'hidden lg:flex flex-1 bg-gray-50 min-h-0';

  return (
    <div className="h-full flex">
      <aside className={listCls}>
        <div className="p-3 border-b border-gray-200 bg-white">
          {creating ? (
            <CreateForm
              onCancel={() => setCreating(false)}
              onCreated={async (p) => {
                setCreating(false);
                await refresh();
                navigate(`/admin/documents/signers/${p.id}`);
              }}
            />
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="w-full border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md px-3 py-2 text-sm font-medium"
            >
              + חותם חדש
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && <div className="p-6 text-center text-sm text-gray-500">טוען…</div>}
          {error && !loading && (
            <div className="p-6 text-center text-sm">
              <div className="text-red-600 mb-2">שגיאה בטעינה</div>
              <button
                onClick={refresh}
                className="text-xs border border-gray-300 rounded px-3 py-1 hover:bg-gray-50"
              >
                נסה שוב
              </button>
            </div>
          )}
          {!loading && !error && list.length === 0 && (
            <div className="p-8 text-center text-sm text-gray-500">
              אין חותמים עדיין.
            </div>
          )}
          {!loading && !error && list.length > 0 && (
            <ul className="divide-y divide-gray-100">
              {list.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => navigate(`/admin/documents/signers/${p.id}`)}
                    className={`w-full text-right px-3 py-3 hover:bg-gray-50 transition block ${
                      id === p.id ? 'bg-blue-50' : ''
                    }`}
                  >
                    <div className="font-medium text-gray-900 truncate">
                      {p.displayName}
                    </div>
                    {p.role && (
                      <div className="text-[12px] text-gray-600 truncate">{p.role}</div>
                    )}
                    <div className="text-[11px] text-gray-500 mt-1">
                      {p.assets.length} נכסים
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <section className={workCls}>
        {id ? (
          <SignerDetail key={id} personId={id} onChanged={refresh} />
        ) : (
          <div className="hidden lg:flex flex-1 items-center justify-center p-10">
            <div className="text-center max-w-sm">
              <div className="text-5xl mb-4 opacity-40">✒️</div>
              <div className="text-lg font-semibold text-gray-800 mb-1">
                בחר חותם
              </div>
              <div className="text-sm text-gray-500">
                לכל חותם ניתן להוסיף חתימה מצויירת, חותמת, או קובץ משולב של חתימה+חותמת.
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function CreateForm({ onCancel, onCreated }) {
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (!displayName.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const p = await api.signers.create({
        displayName: displayName.trim(),
        role: role.trim() || null,
      });
      onCreated(p);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <input
        autoFocus
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        placeholder="שם מלא"
        className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
      />
      <input
        value={role}
        onChange={(e) => setRole(e.target.value)}
        placeholder="תפקיד (אופציונלי)"
        className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
      />
      {err && <div className="text-xs text-red-700">{err}</div>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!displayName.trim() || busy}
          className="flex-1 bg-blue-600 text-white rounded px-3 py-1.5 text-sm font-medium disabled:opacity-40"
        >
          {busy ? 'יוצר…' : 'צור'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-gray-600 px-3 py-1.5 rounded hover:bg-gray-100"
        >
          ביטול
        </button>
      </div>
    </form>
  );
}
