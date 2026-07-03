import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { MEDIA_ROLE, assetTypeLabel, assetSourceLabel } from './kit.jsx';

// Real, read-only preview of a station as a learner would broadly see it:
// hero image, the ordered VISIBLE content parts with their rich content, and the
// station's media. Admin-only notes are intentionally excluded. Reads only
// (getStation); saves nothing. Opened in its own tab from the editor.
export default function StationPreview() {
  const { stationId } = useParams();
  const [station, setStation] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.tourContent.getStation(stationId).then(setStation).catch((e) => setError(e.message));
  }, [stationId]);

  if (error) return <div dir="rtl" className="p-10 text-center text-red-600">שגיאה בטעינת התצוגה: {error}</div>;
  if (!station) return <div dir="rtl" className="p-10 text-center text-gray-400">טוען תצוגה…</div>;

  const parts = station.steps.filter((s) => s.roleHint !== MEDIA_ROLE && s.isVisible);
  const mediaStep = station.steps.find((s) => s.roleHint === MEDIA_ROLE);
  const media = mediaStep?.contentBlock?.assets?.filter((a) => a.active) || [];

  return (
    <div dir="rtl" className="min-h-screen bg-gray-50 text-gray-900" style={{ fontFamily: '"Heebo","Assistant",system-ui,sans-serif' }}>
      <div className="max-w-2xl mx-auto p-5 sm:p-8">
        <div className="text-[12px] text-gray-400 mb-1">{station.tour?.titleHe} · תצוגה מקדימה</div>
        <h1 className="text-2xl font-bold mb-4">{station.titleHe}</h1>
        {station.heroImage?.url && (
          <img src={station.heroImage.url} alt="" className="w-full rounded-2xl border border-gray-200 mb-5 object-cover" style={{ aspectRatio: '16/9' }} />
        )}
        {station.descriptionHe && <p className="text-gray-600 mb-6">{station.descriptionHe}</p>}

        <div className="space-y-5">
          {parts.length === 0 && <div className="text-gray-400 text-center py-8">אין חלקים מוצגים בתחנה זו.</div>}
          {parts.map((s, i) => (
            <section key={s.id} className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-6 h-6 rounded-lg bg-blue-600 text-white grid place-items-center text-[12px] font-bold tabular-nums">{i + 1}</span>
                <h2 className="text-[16px] font-semibold">{s.contentBlock?.titleHe || ''}</h2>
              </div>
              <div className="prose prose-sm max-w-none text-[15px] leading-relaxed" dangerouslySetInnerHTML={{ __html: s.contentBlock?.bodyHe || '<p class="text-gray-400">— ללא תוכן —</p>' }} />
            </section>
          ))}
        </div>

        {media.length > 0 && (
          <section className="mt-6">
            <h2 className="text-[15px] font-semibold text-gray-700 mb-2">מדיה וקישורים</h2>
            <ul className="space-y-2">
              {media.map((a) => (
                <li key={a.id}>
                  {a.media?.url ? (
                    <img src={a.media.url} alt={a.titleHe} className="rounded-xl border border-gray-200 max-h-64" />
                  ) : (
                    <a href={a.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 hover:border-blue-300">
                      <span className="text-lg">{a.assetType === 'link' ? '🔗' : a.assetType === 'file' ? '📄' : '▶'}</span>
                      <span className="font-medium text-blue-700">{a.titleHe}</span>
                      <span className="text-[11px] text-gray-400 mr-auto">{assetSourceLabel(a) || assetTypeLabel(a.assetType)}</span>
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
