import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import StationContentView from '../../tourContentView/StationContentView.jsx';
import { MEDIA_ROLE } from './kit.jsx';

// Real, read-only preview of a station as a learner would broadly see it.
// Rendering is the SHARED StationContentView — the exact component the Guide
// Portal מערכי הדרכה page uses, so preview and portal can never drift.
// Admin notes are excluded. Reads only; saves nothing.
export default function StationPreview() {
  const { stationId } = useParams();
  const [station, setStation] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.tourContent.getStation(stationId).then(setStation).catch((e) => setError(e.message));
  }, [stationId]);

  useEffect(() => {
    document.title = station ? `תצוגה מקדימה · ${station.titleHe}` : 'תצוגה מקדימה';
    return () => { document.title = 'Grafitiyul Team'; };
  }, [station]);

  if (error) return <div dir="rtl" className="p-10 text-center text-red-600">שגיאה בטעינת התצוגה: {error}</div>;
  if (!station) return <div dir="rtl" className="p-10 text-center text-gray-400">טוען תצוגה…</div>;

  const visibleSteps = station.steps.filter((s) => s.isVisible !== false);
  const parts = visibleSteps
    .filter((s) => s.roleHint !== MEDIA_ROLE)
    .map((s) => ({
      roleHint: s.roleHint || null,
      title: s.contentBlock?.titleHe || null,
      body: s.contentBlock?.bodyHe || '',
    }));
  const mediaStep = visibleSteps.find((s) => s.roleHint === MEDIA_ROLE);
  const media = (mediaStep?.contentBlock?.assets || [])
    .filter((a) => a.active)
    .map((a) => ({ assetType: a.assetType, title: a.titleHe, url: a.media?.url || a.url || null }));

  return (
    <div dir="rtl" className="min-h-screen bg-gray-50 text-gray-900">
      <div className="fixed top-0 inset-x-0 bg-amber-100 text-amber-900 text-xs text-center py-1 z-40">תצוגה מקדימה — תוכן פנימי, ללא שמירה</div>
      <div className="max-w-2xl mx-auto p-5 sm:p-8 pt-10">
        <StationContentView
          tourTitle={station.tour?.titleHe}
          title={station.titleHe}
          description={station.descriptionHe}
          heroImageUrl={station.heroImage?.url || null}
          parts={parts}
          media={media}
        />
      </div>
    </div>
  );
}
