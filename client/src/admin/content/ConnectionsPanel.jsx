import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { reasonText } from './contentLabels.js';

// Sources and consumers. Every state here is REPORTED, never assumed: a
// provider is "connected" only because the server said so, and Vimeo's import
// capability comes from a live probe of the actual token and account.

function StatusDot({ ok }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-gray-300'}`}
      aria-hidden
    />
  );
}

function ProviderCard({ title, hint, children }) {
  return (
    <section className="rounded-2xl border border-gray-200 p-5">
      <div className="flex items-center gap-2">
        <StatusDot ok={hint?.configured} />
        <h3 className="text-[15px] font-semibold text-gray-900">{title}</h3>
        <span className={`text-xs ${hint?.configured ? 'text-emerald-700' : 'text-gray-500'}`}>
          {hint?.configured ? 'מחובר' : 'לא מוגדר'}
        </span>
      </div>
      {hint?.note && <p className="mt-2 text-sm leading-relaxed text-gray-500">{hint.note}</p>}
      {!hint?.configured && hint?.requiredEnv?.length > 0 && (
        <p className="mt-2 text-xs text-gray-500">
          נדרש משתנה סביבה:{' '}
          <code dir="ltr" className="rounded bg-gray-100 px-1.5 py-0.5">
            {hint.requiredEnv.join(', ')}
          </code>
        </p>
      )}
      {children}
    </section>
  );
}

function VimeoCapability({ caps }) {
  if (!caps || !caps.configured) return null;
  return (
    <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm">
      <p className="font-medium text-gray-800">ייבוא ל-R2 (העתקת הקובץ אלינו)</p>
      <p className={`mt-1 ${caps.canMirrorToR2 ? 'text-emerald-700' : 'text-amber-700'}`}>
        {caps.canMirrorToR2 ? 'זמין — נבדק מול הטוקן והחשבון בפועל.' : 'לא זמין כרגע.'}
      </p>
      {!caps.canMirrorToR2 && caps.reason && (
        <p className="mt-1 text-xs text-gray-600">{reasonText(caps.reason)}</p>
      )}
      <dl className="mt-2 space-y-0.5 text-xs text-gray-500">
        <div>הרשאת video_files בטוקן: {caps.hasVideoFilesScope ? 'קיימת' : 'חסרה'}</div>
        {caps.probe && typeof caps.probe === 'object' && (
          <div>
            נבדק על סרטון אמיתי: {caps.probe.usableFileCount} קבצי מקור זמינים
          </div>
        )}
        {caps.videoCount != null && <div>סרטונים בחשבון: {caps.videoCount}</div>}
      </dl>
    </div>
  );
}

function ServiceTokens() {
  const [tokens, setTokens] = useState(null);
  const [workspaces, setWorkspaces] = useState([]);
  const [minted, setMinted] = useState(null);
  const [label, setLabel] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [grants, setGrants] = useState({ canRead: true, canTranscribe: false, canWrite: false });

  const load = useCallback(async () => {
    const [t, m] = await Promise.all([
      api.contentLibrary.listServiceTokens(),
      api.contentLibrary.meta(),
    ]);
    setTokens(t.tokens || []);
    setWorkspaces(m.workspaces || []);
    if (!workspaceId && m.workspaces?.[0]) setWorkspaceId(m.workspaces[0].id);
  }, [workspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  async function mint(e) {
    e.preventDefault();
    if (!label.trim() || !workspaceId) return;
    const res = await api.contentLibrary.createServiceToken({ workspaceId, label: label.trim(), ...grants });
    setMinted(res);
    setLabel('');
    await load();
  }

  return (
    <section className="rounded-2xl border border-gray-200 p-5">
      <h3 className="text-[15px] font-semibold text-gray-900">גישה למערכות אחרות</h3>
      <p className="mt-1 text-sm leading-relaxed text-gray-500">
        מערכת האתגרים והגיוס צורכות תוכן דרך ה-API של GOS בלבד — בלי גישה למסד
        הנתונים ובלי מפתחות אחסון. כל טוקן מוגבל למערכת אחת ולהרשאות שנבחרו.
      </p>

      {minted && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-900">
            הטוקן מוצג פעם אחת בלבד — העתיקו אותו עכשיו.
          </p>
          <code dir="ltr" className="mt-2 block break-all rounded bg-white px-2 py-1.5 text-xs">
            {minted.token}
          </code>
          <button
            onClick={() => { navigator.clipboard?.writeText(minted.token); }}
            className="mt-2 rounded border border-amber-400 px-2 py-1 text-xs font-medium text-amber-900"
          >
            העתק
          </button>
        </div>
      )}

      <form onSubmit={mint} className="mt-4 flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="text-sm font-medium text-gray-700">שם</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="למשל: מערכת אתגרים"
            className="mt-1.5 w-48 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">מערכת</span>
          <select
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            className="mt-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </label>
        {[
          ['canRead', 'קריאה'],
          ['canTranscribe', 'הפעלת תמלול'],
          ['canWrite', 'עריכת תיאור'],
        ].map(([k, l]) => (
          <label key={k} className="flex items-center gap-1.5 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={!!grants[k]}
              onChange={(e) => setGrants({ ...grants, [k]: e.target.checked })}
            />
            {l}
          </label>
        ))}
        <button
          type="submit"
          disabled={!label.trim()}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          צור טוקן
        </button>
      </form>

      {tokens?.length > 0 && (
        <ul className="mt-4 divide-y divide-gray-100 rounded-lg border border-gray-200">
          {tokens.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <StatusDot ok={t.status === 'active'} />
              <span className="flex-1 text-gray-900">{t.label}</span>
              <span className="text-xs text-gray-500">{t.workspace.name}</span>
              <span className="text-xs text-gray-400">
                {t.lastUsedAt ? `נעשה שימוש ${new Date(t.lastUsedAt).toLocaleDateString('he-IL')}` : 'לא היה בשימוש'}
              </span>
              {t.status === 'active' && (
                <button
                  onClick={async () => {
                    if (window.confirm(`לבטל את הטוקן "${t.label}"?`)) {
                      await api.contentLibrary.revokeServiceToken(t.id);
                      load();
                    }
                  }}
                  className="text-xs text-red-600 hover:underline"
                >
                  בטל
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function ConnectionsPanel({ meta }) {
  const p = meta?.providers;
  if (!p) return <p className="text-sm text-gray-500">טוען…</p>;
  return (
    <div className="grid max-w-5xl grid-cols-1 gap-5 lg:grid-cols-2">
      <ProviderCard title="יוטיוב" hint={p.youtube} />
      <ProviderCard title="וימאו" hint={p.vimeo}>
        <VimeoCapability caps={p.vimeo?.capabilities} />
      </ProviderCard>
      <ProviderCard title="תמלול" hint={p.transcription} />
      <div className="lg:col-span-2">
        <ServiceTokens />
      </div>
    </div>
  );
}
