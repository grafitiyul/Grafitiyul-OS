import { useState, useCallback } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import ResizeHandle from '../../shell/ResizeHandle.jsx';
import ToursPane from './ToursPane.jsx';
import StationsPane from './StationsPane.jsx';

// Persisted pane width. Stored locally so each user keeps their layout across
// screens/sessions. Clamped defensively on read.
function usePersistedWidth(key, initial, min, max) {
  const [w, setW] = useState(() => {
    const raw = Number(localStorage.getItem(key));
    return raw >= min && raw <= max ? raw : initial;
  });
  const set = useCallback((next) => {
    const clamped = Math.max(min, Math.min(max, next));
    setW(clamped);
    try { localStorage.setItem(key, String(clamped)); } catch { /* ignore quota */ }
  }, [key, min, max]);
  return [w, set];
}

// 3-pane master–detail shell (RTL right→left): Tours → Stations → Station editor.
// Both list panes are resizable by dragging their divider; widths persist locally.
export default function TourContentShell() {
  const { tourId, stationId } = useParams();
  const [toursW, setToursW] = usePersistedWidth('tc.toursW', 256, 200, 420);
  const [stationsW, setStationsW] = usePersistedWidth('tc.stationsW', 288, 220, 480);

  return (
    <div dir="rtl" className="h-full flex bg-gray-50 overflow-hidden">
      <ToursPane width={toursW} activeTourId={tourId} />
      <ResizeHandle currentWidth={toursW} onResize={setToursW} minWidth={200} maxWidth={420} ariaLabel="רוחב עמודת הסיורים" />
      {tourId && (
        <>
          <StationsPane width={stationsW} tourId={tourId} activeStationId={stationId} />
          <ResizeHandle currentWidth={stationsW} onResize={setStationsW} minWidth={220} maxWidth={480} ariaLabel="רוחב עמודת התחנות" />
        </>
      )}
      <div className="flex-1 min-w-0 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
