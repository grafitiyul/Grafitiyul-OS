import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import AnchoredMenu from '../common/AnchoredMenu.jsx';
import TourTeamEditor, { StaffAvatar } from './TourTeamEditor.jsx';
import TourComponents from './TourComponents.jsx';
import ComponentChipList from './ComponentChips.jsx';
import {
  fmtTourDate,
  TOUR_STATUS_LABELS,
  TOUR_STATUS_STYLES,
  ASSIGNMENT_ROLES,
  ASSIGNMENT_ROLE_LABELS,
  ASSIGNMENT_ROLE_STYLES,
} from './config.js';

// Deal workspace → live Tour summary + shared operational editor. The banner is
// a click-trigger; the popover reads LIVE TourEvent data (api.tours.get) and can
// flip into an editor that reuses the SAME components as the Tour modal
// (TourTeamEditor + TourComponents) hitting the SAME TourEvent APIs — one source
// of truth, two editing surfaces. Nothing is copied onto the Deal.
//
// The popover renders through AnchoredMenu (the platform portal pattern) so it
// escapes the right panel's overflow clipping and is always fully visible —
// never render a floating overlay with plain absolute positioning inside the
// workspace side panels.
export default function DealTourSummary({ booking, onGroupSlot, canReplace, onReplace }) {
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(false);
  const [tour, setTour] = useState(null);
  const [gallery, setGallery] = useState(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const anchorRef = useRef(null);
  const tourEventId = booking.tourEventId;
  const te = booking.tourEvent;
  // Viewport-clamped width — AnchoredMenu keeps the box fully inside the screen
  // regardless of how narrow the panel is.
  const popWidth = Math.min(480, (typeof window !== 'undefined' ? window.innerWidth : 480) - 32);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTour(await api.tours.get(tourEventId));
    } catch {
      /* transient — the banner stays usable */
    } finally {
      setLoading(false);
    }
    // Gallery summary — READ-THROUGH from the TourEvent (nothing stored on the
    // Deal); quiet on failure, the popover stays usable.
    try {
      setGallery(await api.tourGallery.summary(tourEventId));
    } catch {
      setGallery(null);
    }
  }, [tourEventId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const assignments = [...(tour?.assignments || [])].sort(
    (a, b) => ASSIGNMENT_ROLES.indexOf(a.role) - ASSIGNMENT_ROLES.indexOf(b.role),
  );
  const components = tour?.activityComponents || [];

  return (
    <div>
      <div className="flex items-center justify-between gap-2 rounded-lg bg-blue-50/70 ring-1 ring-inset ring-blue-100 px-3 py-2">
        <button
          ref={anchorRef}
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="min-w-0 text-right text-[13px] text-blue-900 hover:text-blue-950"
          title="פרטי הסיור"
        >
          <span className="me-1">🧭</span>
          <span className="font-semibold">
            {onGroupSlot ? 'משובץ לסיור קבוצתי' : 'סיור נוצר מהדיל'}
          </span>
          {' · '}
          {fmtTourDate(te.date)} · <span dir="ltr" className="tabular-nums">{te.startTime || '—'}</span>
          {te.status === 'cancelled' && <span className="ms-1 font-semibold text-red-600">(הסיור בוטל)</span>}
          {te.status === 'postponed' && <span className="ms-1 font-semibold text-amber-600">(הסיור נדחה — טרם נקבע מועד)</span>}
          <span className="ms-1 text-blue-500">{open ? '▴' : '▾'}</span>
        </button>
        {canReplace && (
          <button
            type="button"
            onClick={onReplace}
            className="shrink-0 rounded-lg border border-blue-200 bg-white px-2.5 py-1 text-[12px] font-semibold text-blue-700 hover:bg-blue-50"
          >
            החלף סיור
          </button>
        )}
      </div>

      {/* Portal popover — always fully visible, never clipped by the panel. */}
      <AnchoredMenu anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} width={popWidth} align="start">
        <div className="p-3" dir="rtl">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-bold text-gray-900">הסיור</span>
                {tour && (
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${TOUR_STATUS_STYLES[tour.status]}`}>
                    {TOUR_STATUS_LABELS[tour.status] || tour.status}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <a
                  href={`/admin/tours/${tourEventId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-[12px] font-semibold text-gray-700 hover:bg-gray-50"
                >
                  פתח סיור ↗
                </a>
                <button
                  type="button"
                  onClick={() => setEdit((e) => !e)}
                  className={`rounded-lg px-2.5 py-1 text-[12px] font-semibold ${
                    edit ? 'bg-blue-600 text-white' : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {edit ? 'סיום עריכה' : '✎ עריכה'}
                </button>
              </div>
            </div>

            {loading && !tour ? (
              <div className="py-6 text-center text-[13px] text-gray-400">טוען…</div>
            ) : !tour ? (
              <div className="py-6 text-center text-[13px] text-gray-400">לא ניתן לטעון את הסיור.</div>
            ) : (
              <div className="max-h-[60vh] space-y-3 overflow-y-auto">
                {/* Team */}
                <section>
                  <h4 className="mb-1.5 text-[12px] font-bold text-gray-500">צוות</h4>
                  {edit ? (
                    <TourTeamEditor tourId={tourEventId} assignments={tour.assignments || []} onChanged={load} />
                  ) : assignments.length === 0 ? (
                    <p className="text-[12.5px] text-gray-400">לא שובצו מדריכים.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {assignments.map((a) => (
                        <span
                          key={a.id}
                          className={`inline-flex items-center gap-1.5 rounded-full py-0.5 ps-1 pe-2 text-[12px] font-semibold ${ASSIGNMENT_ROLE_STYLES[a.role]}`}
                        >
                          <StaffAvatar
                            src={a.personRef?.profile?.imageUrl}
                            name={a.personRef?.displayName || a.displayName}
                            className="h-5 w-5"
                          />
                          {a.personRef?.displayName || a.displayName || '?'}
                          <span className="opacity-75">· {ASSIGNMENT_ROLE_LABELS[a.role] || a.role}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </section>

                {/* Components */}
                <section>
                  <h4 className="mb-1.5 text-[12px] font-bold text-gray-500">מרכיבי הפעילות</h4>
                  {edit ? (
                    <TourComponents tourId={tourEventId} rows={tour.activityComponents || []} onChanged={load} />
                  ) : (
                    /* Read mode: compact INLINE chips (flex-wrap) — the shared
                       renderer; edit mode keeps the reorder-friendly editor. */
                    <ComponentChipList rows={components} />
                  )}
                </section>

                {/* Gallery — read-through summary; the operational truth lives
                    on the TourEvent (open the tour for the full workspace). */}
                <section>
                  <h4 className="mb-1.5 text-[12px] font-bold text-gray-500">גלריית הסיור</h4>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
                    {!gallery || (gallery.imageCount === 0 && gallery.videoCount === 0) ? (
                      <span className="text-gray-400">אין עדיין מדיה.</span>
                    ) : (
                      <span className="text-gray-700">
                        📸 {gallery.imageCount} תמונות
                        {gallery.videoCount > 0 && ` · ${gallery.videoCount} סרטונים`}
                      </span>
                    )}
                    {tour.status !== 'cancelled' && (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const link =
                              gallery?.link || (await api.tourGallery.ensureLink(tourEventId));
                            await navigator.clipboard.writeText(
                              `${window.location.origin}/g/${link.token}`,
                            );
                            setLinkCopied(true);
                            setTimeout(() => setLinkCopied(false), 2000);
                          } catch {
                            /* quiet */
                          }
                        }}
                        className="rounded-lg border border-gray-300 bg-white px-2 py-0.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50"
                      >
                        {linkCopied ? '✓ הועתק' : '🔗 קישור ללקוח'}
                      </button>
                    )}
                  </div>
                </section>
              </div>
            )}
        </div>
      </AnchoredMenu>
    </div>
  );
}
