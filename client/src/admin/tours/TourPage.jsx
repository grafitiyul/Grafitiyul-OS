import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import TimelineFeed from '../common/timeline/TimelineFeed.jsx';
import QuestionnaireFillDialog from '../../questionnaire/QuestionnaireFillDialog.jsx';
import CoordinationFormAction from './CoordinationFormAction.jsx';
import TourSlotModal from './TourSlotModal.jsx';
import TourComponents from './TourComponents.jsx';
import TourTeamEditor from './TourTeamEditor.jsx';
import TourGalleryCard from './gallery/TourGalleryCard.jsx';
import { contactNameHe, dealPath, resolveActivityLabel } from '../deals/config.js';
import {
  TOUR_STATUS_LABELS,
  TOUR_STATUS_STYLES,
  TOUR_LANG_LABELS,
  fmtTourDate,
} from './config.js';

// The tour's activity dimension (kind) IS the Deal's activityType — one
// vocabulary, mapped here so the header can reuse the Deal's activity badge.
const KIND_TO_ACTIVITY = { private: 'private', business: 'business', group_slot: 'group' };

// Tour page — the operational workspace of ONE TourEvent, opened as a large
// CENTERED MODAL on top of the Tours list (the user never leaves the workspace).
// It is a dense operational dashboard, not a CRUD form: a compact fact header,
// the assigned team as chips, and one card per participating customer. Customer
// data is READ-THROUGH from each booking's Deal — this page owns execution
// (team assignments, group-slot fields); CRM writing (notes/tasks) and the
// tour LIFECYCLE (cancellation) live on the Deal and are not exposed here.
// "טופס סיכום סיור" is live (generic questionnaire engine, purpose=
// tour_summary); "טופס שיחת תיאום" is still an approved placeholder (Slice 3).

function Chip({ styles, label }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${styles}`}>
      {label}
    </span>
  );
}

// Quiet metadata separator for the header line.
function Dot() {
  return <span className="text-gray-300">·</span>;
}

// Resolve the customer card's contacts from the deal's DealContact links.
// primary link = the customer (the card title). fieldRep = the fieldRep-role
// link ONLY if one is explicitly set AND it is a different person — otherwise
// the field-rep line is omitted (it would just repeat the customer).
function resolveCustomerContacts(dealContacts) {
  const links = dealContacts || [];
  const primary = links.find((l) => l.isPrimary) || links[0] || null;
  const fieldRep = links.find((l) => (l.roles || []).includes('fieldRep')) || null;
  return { primary, fieldRep };
}

// One booking = one customer card (group tours show several, stacked). Title is
// the CUSTOMER (primary contact), with the organization beneath. The
// coordination-call form and the "important info" accordion belong to the
// participant and live inside the card.
function CustomerCard({ booking }) {
  const deal = booking.deal;
  const [infoOpen, setInfoOpen] = useState(true); // operationally important → open by default
  if (!deal) return null;
  const { primary, fieldRep } = resolveCustomerContacts(deal.contacts);
  const customerName = (primary?.contact && contactNameHe(primary.contact)) || deal.title;
  const phone = primary?.contact?.phones?.[0]?.value;
  const email = primary?.contact?.emails?.[0]?.value;
  const showFieldRep = fieldRep && fieldRep !== primary && fieldRep.contact;

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="flex items-start justify-between gap-3 p-3">
        {/* Opens the Deal in a NEW tab — the operational tour stays open here. */}
        <a
          href={dealPath(deal)}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 text-right"
          title="פתיחת הדיל בכרטיסייה חדשה"
        >
          <div className="truncate text-[15px] font-semibold text-gray-900 hover:text-blue-700">
            {customerName}
          </div>
          <div className="truncate text-[12.5px] text-gray-500">
            {deal.organization?.name || 'לקוח פרטי'}
            {deal.organizationUnit?.name && ` · ${deal.organizationUnit.name}`}
            {deal.orderNo && (
              <span dir="ltr" className="ms-1 tabular-nums text-gray-400">#{deal.orderNo}</span>
            )}
          </div>
        </a>
        <div className="shrink-0 text-left text-[12px]">
          <div className="tabular-nums font-medium text-gray-700" dir="ltr">
            👥 {booking.seats}
          </div>
          {booking.status !== 'active' && (
            <span className="font-semibold text-amber-600">
              {booking.status === 'orphaned' ? 'orphan' : 'בוטל'}
            </span>
          )}
        </div>
      </div>

      {(phone || email || showFieldRep) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-100 px-3 py-2 text-[13px]">
          {phone && (
            <a href={`tel:${phone}`} dir="ltr" className="tabular-nums text-blue-700 hover:underline">
              📞 {phone}
            </a>
          )}
          {email && (
            <a href={`mailto:${email}`} dir="ltr" className="text-blue-700 hover:underline break-all">
              ✉ {email}
            </a>
          )}
          {showFieldRep && (
            <span className="text-gray-600">
              נציג בשטח: <span className="font-medium text-gray-800">{contactNameHe(fieldRep.contact)}</span>
            </span>
          )}
        </div>
      )}

      {/* Coordination form — belongs to the participant (one independent
          form per Booking, generic engine purpose=coordination). */}
      <div className="border-t border-gray-100 px-3 py-2">
        <CoordinationFormAction bookingId={booking.id} />
      </div>

      {deal.customerInfo && (
        <div className="border-t border-gray-100 px-3 py-2">
          <button
            type="button"
            onClick={() => setInfoOpen((o) => !o)}
            className="flex w-full items-center justify-between text-[13px] font-semibold text-gray-700 hover:text-gray-900"
          >
            <span>מידע חשוב על הלקוח</span>
            <span className="text-xs text-gray-400">{infoOpen ? '▾' : '▸'}</span>
          </button>
          {infoOpen && (
            <div
              className="prose prose-sm mt-1.5 max-w-none text-[13px] leading-relaxed text-gray-800 [&_a]:text-blue-700"
              // Deal.customerInfo is trusted rich HTML authored in the admin
              // (same rendering as the Deal workspace note).
              dangerouslySetInnerHTML={{ __html: deal.customerInfo }}
            />
          )}
        </div>
      )}
    </div>
  );
}

// Small bordered panel used for the body sections (team / participants).
function Section({ title, count, children }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-3.5">
      <h2 className="mb-2.5 flex items-center gap-1.5 text-[14px] font-bold text-gray-900">
        {title}
        {count != null && count > 1 && (
          <span className="text-[12px] font-medium text-gray-400">({count})</span>
        )}
      </h2>
      {children}
    </section>
  );
}

export default function TourPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  // Rendered inside the Tours list Outlet → closing refreshes the list behind
  // the modal. Standalone (e.g. tests) falls back to a plain navigate.
  const { closeTour } = useOutletContext() || {};
  const close = useCallback(() => {
    if (closeTour) closeTour();
    else navigate('/admin/tours');
  }, [closeTour, navigate]);

  const [tour, setTour] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false); // collapsed by default
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Tour Summary form (generic questionnaire engine, purpose=tour_summary).
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryStatus, setSummaryStatus] = useState(null); // null | draft | submitted | reviewed

  const refreshSummaryStatus = useCallback(async () => {
    try {
      const list = await api.questionnaires.listSubmissions({
        subjectType: 'tour_event',
        subjectId: id,
        purpose: 'tour_summary',
      });
      const active = list.find((s) => ['draft', 'submitted', 'reviewed'].includes(s.status));
      setSummaryStatus(active?.status || null);
    } catch {
      setSummaryStatus(null); // status chip is cosmetic — never block the page
    }
  }, [id]);

  useEffect(() => {
    refreshSummaryStatus();
  }, [refreshSummaryStatus]);

  const refresh = useCallback(async () => {
    try {
      setTour(await api.tours.get(id));
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Esc closes the modal.
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);

  // Delete is the inverse of "create group slot" (Tours-module cleanup of an
  // EMPTY slot) — not customer cancellation, which lives on the Deal.
  async function runDelete() {
    setConfirmDelete(false);
    try {
      await api.tours.remove(id);
      close();
    } catch (e) {
      const code = e.payload?.error;
      alert(
        code === 'tour_has_bookings'
          ? 'לא ניתן למחוק סיור שיש לו הזמנות.'
          : 'שגיאה: ' + (code || e.message),
      );
    }
  }

  const city = tour?.location?.nameHe || tour?.productVariant?.location?.nameHe;
  const isSlot = tour?.kind === 'group_slot';
  const relevantBookings = (tour?.bookings || []).filter((b) => b.status !== 'cancelled');
  // A private/business tour is 1:1 with a deal — its activity classification
  // (org-type + subtype) is read from that deal so the header shows the SAME
  // badge as the Deal header. Group slots have many deals → the broad "קבוצתי".
  const classifyDeal = !isSlot ? relevantBookings[0]?.deal || null : null;
  // Same label source as the Deal header (resolveActivityLabel) — but rendered
  // as plain header metadata, not a colored badge: in this modal color is
  // reserved for meaning (status, team roles).
  const activityLabel = tour
    ? resolveActivityLabel({
        activityType: KIND_TO_ACTIVITY[tour.kind] || null,
        orgTypeLabel:
          classifyDeal?.organizationType?.label ||
          classifyDeal?.organization?.organizationType?.label,
        subtypeLabel: classifyDeal?.organizationSubtype?.label,
      })
    : null;
  const assignmentCount = (tour?.assignments || []).length;
  const over = tour && tour.capacity != null && tour.activeSeats > tour.capacity;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="פרטי סיור"
      className="fixed inset-0 z-50 flex justify-center bg-black/40 p-0 sm:items-center sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        dir="rtl"
        className="flex h-full w-full flex-col overflow-hidden bg-gray-50 shadow-2xl sm:h-[calc(100vh-3rem)] sm:max-w-[1040px] sm:rounded-2xl"
      >
        {loading ? (
          <div className="p-8 text-sm text-gray-400">טוען…</div>
        ) : error ? (
          <div className="p-8 text-sm text-red-600">
            שגיאה: <span dir="ltr" className="font-mono">{error}</span>
          </div>
        ) : !tour ? null : (
          <>
            {/* Compact operational header (fixed). */}
            <header className="shrink-0 border-b border-gray-200 bg-white px-4 py-3 sm:px-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-medium text-gray-400">🧭 פרטי סיור</div>
                  <h1 className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-lg font-bold tracking-tight text-gray-900">
                    {tour.product?.nameHe || 'סיור'}
                    {city && <span className="text-base font-medium text-gray-400">· {city}</span>}
                  </h1>
                  {/* One quiet metadata line — STATUS is the only chip; the rest
                      is plain operational information ("what is this tour?"). */}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] text-gray-500">
                    <Chip styles={TOUR_STATUS_STYLES[tour.status]} label={TOUR_STATUS_LABELS[tour.status] || tour.status} />
                    {activityLabel && (
                      <span className="font-medium text-gray-700">{activityLabel}</span>
                    )}
                    <Dot />
                    <span className="text-gray-700">{fmtTourDate(tour.date)}</span>
                    <Dot />
                    <span dir="ltr" className="tabular-nums text-gray-700">{tour.startTime}</span>
                    {tour.tourLanguage && (
                      <>
                        <Dot />
                        <span>{TOUR_LANG_LABELS[tour.tourLanguage]}</span>
                      </>
                    )}
                    <Dot />
                    <span dir="ltr" className="tabular-nums">
                      👥 {tour.activeSeats}{tour.capacity != null ? ` / ${tour.capacity}` : ''}
                    </span>
                    {over && <span className="font-bold text-red-600">חריגה</span>}
                    <Dot />
                    <span>{assignmentCount} מדריכים</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {/* Tour Summary — one submission per TourEvent, via the
                      generic questionnaire engine (purpose=tour_summary). */}
                  <button
                    type="button"
                    onClick={() => setSummaryOpen(true)}
                    className={`rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold sm:inline-block ${
                      summaryStatus === 'submitted' || summaryStatus === 'reviewed'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                        : summaryStatus === 'draft'
                          ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
                          : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    📋 טופס סיכום סיור
                    {summaryStatus === 'submitted' || summaryStatus === 'reviewed'
                      ? ' · הוגש'
                      : summaryStatus === 'draft'
                        ? ' · בתהליך'
                        : ''}
                  </button>
                  {isSlot && tour.status !== 'cancelled' && (
                    <button
                      type="button"
                      onClick={() => setEditOpen(true)}
                      className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      ✎ עריכה
                    </button>
                  )}
                  {tour.totalBookings === 0 && (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      title="מחיקת סיור ריק"
                      className="rounded-lg border border-red-200 px-2.5 py-1.5 text-[12px] font-semibold text-red-600 hover:bg-red-50"
                    >
                      🗑
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={close}
                    aria-label="סגירה"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-xl leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                  >
                    ✕
                  </button>
                </div>
              </div>
              {tour.notes && (
                <p className="mt-2 rounded-lg bg-gray-50 px-3 py-1.5 text-[12.5px] text-gray-600">📝 {tour.notes}</p>
              )}
            </header>

            {/* Scrolling body. */}
            <div className="flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
              {/* ONE operational block: team → components → workshop locations
                  (locations render inside TourComponents, only when relevant).
                  Quiet sub-labels — the CONTENT carries the hierarchy: role
                  colors on people, icons on components. */}
              <section className="rounded-xl border border-gray-200 bg-white">
                <div className="px-3.5 py-2.5">
                  <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-gray-400">
                    צוות משובץ
                  </h2>
                  <TourTeamEditor tourId={tour.id} assignments={tour.assignments || []} onChanged={refresh} />
                </div>
                <div className="border-t border-gray-100 px-3.5 py-2.5">
                  <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-gray-400">
                    מרכיבי הפעילות
                  </h2>
                  <TourComponents
                    tourId={tour.id}
                    rows={tour.activityComponents || []}
                    onChanged={refresh}
                  />
                </div>
              </section>

              {/* Tour Gallery — compact summary; the full grid opens in a
                  dedicated workspace modal (density of this page is sacred). */}
              <TourGalleryCard tourEventId={tour.id} tourStatus={tour.status} />

              {/* Participants — one card per booking, stacked vertically. */}
              <Section title="משתתפים" count={relevantBookings.length}>
                {relevantBookings.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-center text-[13px] text-gray-400">
                    {isSlot ? 'עדיין לא שובצו דילים לסיור — שיבוץ נעשה מדיל קבוצתי ב-WON.' : 'אין הזמנות פעילות.'}
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {relevantBookings.map((b) => (
                      <CustomerCard key={b.id} booking={b} />
                    ))}
                  </div>
                )}
              </Section>

              {/* History — collapsed accordion. */}
              <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                <button
                  type="button"
                  onClick={() => setHistoryOpen((o) => !o)}
                  className="flex w-full items-center justify-between px-3.5 py-2.5 text-[14px] font-bold text-gray-800 hover:bg-gray-50"
                >
                  <span>היסטוריה</span>
                  <span className="text-gray-400">{historyOpen ? '▾' : '▸'}</span>
                </button>
                {historyOpen && (
                  <div className="border-t border-gray-100 p-3">
                    <TimelineFeed subjectType="tour_event" subjectId={tour.id} readOnly />
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </div>

      <TourSlotModal open={editOpen} tour={tour} onClose={() => setEditOpen(false)} onSaved={refresh} />

      <QuestionnaireFillDialog
        open={summaryOpen}
        onClose={() => {
          setSummaryOpen(false);
          refreshSummaryStatus();
        }}
        purpose="tour_summary"
        subjectType="tour_event"
        subjectId={id}
        title="טופס סיכום סיור"
        onStatusChange={() => refreshSummaryStatus()}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="מחיקת סיור"
        body="למחוק את הסיור? רק סיורים ריקים (ללא הזמנות) ניתנים למחיקה. לא ניתן לבטל פעולה זו."
        confirmLabel="מחק"
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={runDelete}
      />
    </div>
  );
}
