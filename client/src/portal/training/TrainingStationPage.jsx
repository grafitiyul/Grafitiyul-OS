import { useCallback, useEffect, useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import StationContentView from '../../tourContentView/StationContentView.jsx';
import { usePortalLanguage } from '../PortalLanguage.jsx';

// One training Station — learner-safe content through the SHARED renderer
// (tourContentView/StationContentView, same one the admin preview uses).
// A direct URL without an explicit grant gets 403 from the server and the
// honest blocked state here.
//
// LANGUAGE: the page chrome follows the guide; the station CONTENT is
// single-language in the schema and renders exactly as authored.

export default function TrainingStationPage() {
  const { token } = useOutletContext();
  const { t, rtl } = usePortalLanguage();
  const { stationId } = useParams();
  const [state, setState] = useState({ phase: 'loading' });

  const load = useCallback(async () => {
    setState({ phase: 'loading' });
    try {
      const res = await fetch(
        `/api/portal/${encodeURIComponent(token)}/training/stations/${encodeURIComponent(stationId)}`,
        { cache: 'no-store' },
      );
      if (res.status === 403 || res.status === 404) return setState({ phase: 'blocked' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState({ phase: 'ready', station: await res.json() });
    } catch (e) {
      setState({ phase: 'error', message: e?.message || 'network_error' });
    }
  }, [token, stationId]);

  useEffect(() => {
    load();
    window.scrollTo(0, 0);
  }, [load]);

  const backHref = `/p/${encodeURIComponent(token)}/training`;

  if (state.phase === 'loading') {
    return <div className="py-10 text-center text-sm text-gray-500">{t.common.loading}</div>;
  }
  if (state.phase === 'blocked') {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
        <div className="mb-2 text-3xl">🔒</div>
        <div className="text-sm text-gray-600">{t.training.stationBlocked}</div>
        <Link
          to={backHref}
          className="mt-3 inline-block rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"
        >
          {t.training.backLabel}
        </Link>
      </div>
    );
  }
  if (state.phase === 'error') {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
        <div className="mb-1 text-base font-semibold text-gray-800">
          {t.training.stationErrorTitle}
        </div>
        <button
          type="button"
          onClick={load}
          className="mt-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"
        >
          {t.common.retry}
        </button>
      </div>
    );
  }

  const s = state.station;
  return (
    <div>
      <div className="mb-3">
        <Link
          to={backHref}
          aria-label={t.training.backAria}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-lg text-gray-500 active:bg-gray-100"
        >
          {rtl ? '→' : '←'}
        </Link>
      </div>
      <StationContentView
        tourTitle={s.tour?.titleHe}
        title={s.titleHe}
        description={s.descriptionHe}
        heroImageUrl={s.heroImageUrl}
        parts={s.parts}
        media={s.media}
        labels={t.stationContent}
        collapseGlyphs={{ open: '▾', closed: rtl ? '◂' : '▸' }}
      />
    </div>
  );
}
