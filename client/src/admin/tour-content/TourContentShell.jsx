import { Outlet, useParams } from 'react-router-dom';
import ToursPane from './ToursPane.jsx';
import StationsPane from './StationsPane.jsx';

// 3-pane master–detail shell (RTL right→left): Tours → Stations → Station editor.
// The daily workflow is Tour → Station → edit. The two list panes persist while
// the main editor (Outlet) changes, so context is never lost. Content library is
// intentionally NOT a pane — reuse happens contextually inside the editor.
export default function TourContentShell() {
  const { tourId, stationId } = useParams();

  return (
    <div dir="rtl" className="h-full flex bg-gray-50 overflow-hidden">
      <ToursPane activeTourId={tourId} />
      {tourId && <StationsPane tourId={tourId} activeStationId={stationId} />}
      <div className="flex-1 min-w-0 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
