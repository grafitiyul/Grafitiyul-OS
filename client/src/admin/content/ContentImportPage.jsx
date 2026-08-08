import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { fmtDuration, reasonText } from './contentLabels.js';
import WorldCategoryPicker from './WorldCategoryPicker.jsx';

// Import from an external source.
//
// Two rules are visible in this screen by design:
//   * nothing is auto-imported — the operator selects rows explicitly;
//   * an already-imported video is shown as such and links to the existing
//     item, because duplicate identity is the provider id, not the title.

const SOURCES = [
  { key: 'youtube', label: 'יוטיוב' },
  { key: 'vimeo', label: 'וימאו' },
];

export default function ContentImportPage() {
  const navigate = useNavigate();
  const [source, setSource] = useState('youtube');
  const [meta, setMeta] = useState(null);
  const [state, setState] = useState({ videos: [], loading: true, error: null, cursor: null });
  const [selected, setSelected] = useState({});
  const [names, setNames] = useState({});
  const [worldIds, setWorldIds] = useState([]);
  const [categoryIds, setCategoryIds] = useState([]);
  const [strategy, setStrategy] = useState('reference');
  const [channelInput, setChannelInput] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    api.contentLibrary.meta().then(setMeta).catch(() => {});
  }, []);

  const load = useCallback(
    async (cursor = null) => {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const res =
          source === 'youtube'
            ? await api.contentLibrary.youtubeVideos({
                pageToken: cursor,
                ...(channelInput.trim().startsWith('@')
                  ? { handle: channelInput.trim() }
                  : channelInput.trim()
                    ? { channelId: channelInput.trim() }
                    : {}),
              })
            : await api.contentLibrary.vimeoVideos(cursor || 1);
        setState({
          videos: res.videos || [],
          loading: false,
          error: null,
          cursor: source === 'youtube' ? res.nextPageToken : res.nextPage,
          channel: res.channel || null,
        });
      } catch (e) {
        setState({
          videos: [],
          loading: false,
          error: e?.payload?.error || 'טעינה נכשלה',
          hint: e?.payload,
          cursor: null,
        });
      }
    },
    [source, channelInput],
  );

  useEffect(() => {
    setSelected({});
    setResult(null);
    load(null);
  }, [source]); // eslint-disable-line react-hooks/exhaustive-deps

  const providerHint = meta?.providers?.[source];
  const vimeoCaps = meta?.providers?.vimeo?.capabilities;
  const mirrorAvailable = source === 'vimeo' && vimeoCaps?.canMirrorToR2 === true;

  const chosen = state.videos.filter((v) => selected[v.externalId]);

  async function runImport() {
    if (!chosen.length) return;
    setImporting(true);
    try {
      const res = await api.contentLibrary.import({
        provider: source,
        strategy,
        worldIds,
        categoryIds,
        videos: chosen.map((v) => ({ ...v, internalName: names[v.externalId] || v.title })),
      });
      setResult(res);
      setSelected({});
      await load(null);
    } catch (e) {
      setState((s) => ({ ...s, error: e?.payload?.error || 'הייבוא נכשל' }));
    } finally {
      setImporting(false);
    }
  }

  return (
    <div dir="rtl" className="px-5 py-8 lg:px-10 lg:py-10 max-w-[1400px] mx-auto">
      <header className="mb-6">
        <Link to="/admin/content-library" className="text-sm text-gray-500 hover:text-gray-900">
          → ספריית תוכן
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-gray-900">ייבוא ממקור חיצוני</h1>
        <p className="mt-1.5 text-[15px] text-gray-500">
          בוחרים סרטונים ומייבאים אותם לספרייה. שום דבר לא מיובא אוטומטית.
        </p>
      </header>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {SOURCES.map((s) => (
          <button
            key={s.key}
            onClick={() => setSource(s.key)}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${
              source === s.key ? 'bg-gray-900 text-white' : 'border border-gray-300 text-gray-600'
            }`}
          >
            {s.label}
          </button>
        ))}
        {source === 'youtube' && (
          <>
            <input
              value={channelInput}
              onChange={(e) => setChannelInput(e.target.value)}
              placeholder="@handle או Channel ID (רשות)"
              dir="ltr"
              className="w-64 rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <button
              onClick={() => load(null)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50"
            >
              טען
            </button>
          </>
        )}
      </div>

      {/* Honest "not configured" — the screen explains exactly what is missing. */}
      {providerHint && !providerHint.configured && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <p className="text-[15px] font-medium text-amber-900">
            {SOURCES.find((s) => s.key === source)?.label} עדיין לא מחובר.
          </p>
          <p className="mt-1 text-sm text-amber-800">{providerHint.note}</p>
          <p className="mt-2 text-sm text-amber-800">
            נדרש משתנה סביבה:{' '}
            <code dir="ltr" className="rounded bg-white px-1.5 py-0.5">
              {(providerHint.requiredEnv || []).join(', ')}
            </code>
          </p>
        </div>
      )}

      {providerHint?.configured && (
        <>
          {state.error && (
            <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {reasonText(state.error) || state.error}
            </p>
          )}

          {/* Import options */}
          <div className="mb-5 flex flex-wrap items-end gap-4 rounded-2xl border border-gray-200 p-4">
            <div>
              <span className="block text-sm font-medium text-gray-700">אחסון</span>
              <div className="mt-1.5 flex gap-2">
                <button
                  onClick={() => setStrategy('reference')}
                  className={`rounded-lg px-3 py-1.5 text-sm ${
                    strategy === 'reference' ? 'bg-gray-900 text-white' : 'border border-gray-300 text-gray-600'
                  }`}
                >
                  השאר במקור
                </button>
                <button
                  onClick={() => mirrorAvailable && setStrategy('mirror')}
                  disabled={!mirrorAvailable}
                  title={
                    source === 'youtube'
                      ? reasonText('youtube_download_not_supported')
                      : !mirrorAvailable
                        ? reasonText(vimeoCaps?.reason) || 'לא זמין'
                        : undefined
                  }
                  className={`rounded-lg px-3 py-1.5 text-sm ${
                    strategy === 'mirror'
                      ? 'bg-gray-900 text-white'
                      : 'border border-gray-300 text-gray-600'
                  } disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  ייבא אלינו (R2)
                </button>
              </div>
              {source === 'youtube' && (
                <p className="mt-1.5 text-xs text-gray-500">
                  סרטוני יוטיוב נשמרים כהפניה בלבד — איננו מורידים אותם.
                </p>
              )}
              {source === 'vimeo' && !mirrorAvailable && (
                <p className="mt-1.5 text-xs text-gray-500">
                  {reasonText(vimeoCaps?.reason) || 'ייבוא ל-R2 לא זמין לחשבון הזה כרגע.'}
                </p>
              )}
            </div>

            <div className="min-w-[320px]">
              {/* Bulk default for the whole import: world first, then that
                  world's categories. Each item can still be edited afterwards. */}
              <WorldCategoryPicker
                worlds={meta?.worlds || []}
                categories={meta?.categories || []}
                selectedWorldIds={worldIds}
                selectedCategoryIds={categoryIds}
                onWorldsChange={setWorldIds}
                onCategoriesChange={setCategoryIds}
                compact
              />
            </div>

            <button
              onClick={runImport}
              disabled={!chosen.length || !worldIds.length || importing}
              className="ms-auto rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              {importing ? 'מייבא…' : `ייבא ${chosen.length || ''}`}
            </button>
          </div>

          {result && (
            <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
              <p className="font-medium text-emerald-900">
                יובאו {result.imported.length} · דולגו {result.skipped.length} · נכשלו {result.failed.length}
              </p>
              {result.imported.some((i) => i.mirrorSkippedReason) && (
                <p className="mt-1 text-emerald-900">
                  חלק מהפריטים יובאו כהפניה בלבד:{' '}
                  {reasonText(result.imported.find((i) => i.mirrorSkippedReason)?.mirrorSkippedReason)}
                </p>
              )}
              {result.imported.some((i) => i.mirrorQueued) && (
                <p className="mt-1 text-emerald-900">
                  העתקה ל-R2 נכנסה לתור ותתבצע ברקע — הסטטוס יתעדכן בפריט עצמו.
                </p>
              )}
            </div>
          )}

          {state.loading ? (
            <p className="text-sm text-gray-500">טוען…</p>
          ) : state.videos.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-gray-300 p-10 text-center text-sm text-gray-500">
              לא נמצאו סרטונים.
            </p>
          ) : (
            <>
              <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200">
                {state.videos.map((v) => {
                  const on = !!selected[v.externalId];
                  return (
                    <li key={v.externalId} className="flex items-start gap-3 p-3">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={v.alreadyImported}
                        onChange={(e) =>
                          setSelected({ ...selected, [v.externalId]: e.target.checked })
                        }
                        className="mt-8"
                      />
                      {v.thumbnailUrl ? (
                        <img
                          src={v.thumbnailUrl}
                          alt=""
                          loading="lazy"
                          className="h-20 w-36 shrink-0 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="h-20 w-36 shrink-0 rounded-lg bg-gray-100" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900" title={v.title}>
                          {v.title}
                        </p>
                        <p className="mt-0.5 text-xs text-gray-500">
                          {v.publishedAt ? new Date(v.publishedAt).toLocaleDateString('he-IL') : ''}
                          {v.durationSeconds ? ` · ${fmtDuration(v.durationSeconds)}` : ''}
                          {source === 'vimeo' && (
                            <span className={v.canMirrorToR2 ? ' text-emerald-700' : ' text-gray-400'}>
                              {v.canMirrorToR2 ? ' · ניתן לייבוא אלינו' : ' · הפניה בלבד'}
                            </span>
                          )}
                        </p>
                        {v.alreadyImported ? (
                          <p className="mt-1 text-xs">
                            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">
                              כבר בספרייה
                            </span>
                            {v.existingItemId && (
                              <button
                                onClick={() => navigate(`/admin/content-library/${v.existingItemId}`)}
                                className="ms-2 text-blue-600 hover:underline"
                              >
                                פתח את הפריט
                              </button>
                            )}
                          </p>
                        ) : on ? (
                          <input
                            value={names[v.externalId] ?? v.title}
                            onChange={(e) => setNames({ ...names, [v.externalId]: e.target.value })}
                            placeholder="שם פנימי"
                            className="mt-1.5 w-full max-w-md rounded border border-gray-300 px-2 py-1 text-sm"
                          />
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>

              {state.cursor && (
                <button
                  onClick={() => load(state.cursor)}
                  className="mt-4 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
                >
                  טען עוד
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
