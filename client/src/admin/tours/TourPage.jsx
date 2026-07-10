import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import TimelineFeed from '../common/timeline/TimelineFeed.jsx';
import TourSlotModal from './TourSlotModal.jsx';
import { contactNameHe, dealPath } from '../deals/config.js';
import {
  TOUR_KIND_LABELS,
  TOUR_KIND_STYLES,
  TOUR_STATUS_LABELS,
  TOUR_STATUS_STYLES,
  TOUR_LANG_LABELS,
  ASSIGNMENT_ROLES,
  ASSIGNMENT_ROLE_LABELS,
  ASSIGNMENT_ROLE_STYLES,
  ASSIGNMENT_ROLE_DOTS,
  fmtTourDate,
} from './config.js';

// Tour page — the operational workspace of ONE TourEvent, opened as a large
// CENTERED MODAL on top of the Tours list (the user never leaves the workspace).
// It is a dense operational dashboard, not a CRUD form: a compact fact header,
// the assigned team as chips, and one card per participating customer. Customer
// data is READ-THROUGH from each booking's Deal — this page owns execution
// (team assignments, group-slot fields); CRM writing (notes/tasks) and the
// tour LIFECYCLE (cancellation) live on the Deal and are not exposed here.
// "טופס שיחת תיאום" / "טופס סיכום סיור" are approved placeholders.

function Chip({ styles, label }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${styles}`}>
      {label}
    </span>
  );
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

// A single assigned guide, shown as a compact role-colored chip. Clicking the
// name opens the role picker (guide / lead / workshop assistant); the ✕ removes
// the assignment. No separate edit UI — everything happens on the chip.
function GuideChip({ a, onRoleChange, onRemove, busy }) {
  const [menu, setMenu] = useState(false);
  const gone = !a.personRef;
  const name = a.personRef?.displayName || a.displayName || '?';
  return (
    <div className="relative">
      <div
        className={`inline-flex items-center gap-1.5 rounded-full py-1 ps-2.5 pe-1 text-[12px] font-semibold ${ASSIGNMENT_ROLE_STYLES[a.role]}`}
      >
        <button
          type="button"
          onClick={() => setMenu((m) => !m)}
          disabled={busy}
          title="שינוי תפקיד"
          className="inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          <span aria-hidden>👤</span>
          <span className="whitespace-nowrap">{name}</span>
          <span className="opacity-75">· {ASSIGNMENT_ROLE_LABELS[a.role] || a.role}</span>
          {gone && <span className="opacity-70">(הוסר)</span>}
        </button>
        <button
          type="button"
          onClick={() => onRemove(a)}
          disabled={busy}
          title="הסרת השיבוץ"
          className="flex h-4 w-4 items-center justify-center rounded-full text-current opacity-70 hover:bg-black/10 hover:opacity-100 disabled:opacity-40"
        >
          ✕
        </button>
      </div>
      {menu && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
          <div className="absolute z-20 mt-1 w-40 rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
            {ASSIGNMENT_ROLES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => {
                  onRoleChange(a, r);
                  setMenu(false);
                }}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-right text-[13px] hover:bg-gray-50 ${
                  r === a.role ? 'font-bold text-gray-900' : 'text-gray-700'
                }`}
              >
                <span className={`h-2.5 w-2.5 rounded-full ${ASSIGNMENT_ROLE_DOTS[r]}`} />
                {ASSIGNMENT_ROLE_LABELS[r]}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// The "+" that opens a searchable popover of assignable staff. Picking a person
// assigns them immediately (as a plain guide — the role is then tuned on the
// chip).
function AddGuideButton({ people, onPick, busy }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const filtered = people.filter((p) =>
    (p.displayName || '').toLowerCase().includes(q.trim().toLowerCase()),
  );
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        title="הוספת איש צוות"
        className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-gray-300 text-lg leading-none text-gray-400 hover:border-blue-400 hover:text-blue-600 disabled:opacity-50"
      >
        +
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 w-60 rounded-xl border border-gray-200 bg-white p-2 shadow-xl">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="חיפוש איש צוות…"
              className="mb-1.5 h-8 w-full rounded-lg border border-gray-200 px-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
            <div className="max-h-56 overflow-y-auto">
              {filtered.length === 0 && (
                <p className="px-2 py-3 text-center text-[12px] text-gray-400">אין אנשי צוות זמינים</p>
              )}
              {filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    onPick(p.id);
                    setOpen(false);
                    setQ('');
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-right text-[13px] hover:bg-blue-50"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[11px] font-bold text-gray-600">
                    {(p.displayName || '?').slice(0, 1)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {p.displayName}
                    {p.lifecycleHint === 'trainee' ? ' · מתלמד' : ''}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// One booking = one customer card (group tours show several, stacked). Title is
// the CUSTOMER (primary contact), with the organization beneath. The
// coordination-call form and the "important info" accordion belong to the
// participant and live inside the card.
function CustomerCard({ booking, navigate }) {
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
        <button
          type="button"
          onClick={() => navigate(dealPath(deal))}
          className="min-w-0 text-right"
          title="פתיחת הדיל"
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
        </button>
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

      {/* Coordination call — belongs to the participant, placed above the info. */}
      <div className="border-t border-gray-100 px-3 py-2">
        <button
          type="button"
          disabled
          title="בקרוב"
          className="flex w-full cursor-not-allowed items-center gap-2 text-[13px] text-gray-400"
        >
          <span aria-hidden>📋</span>
          טופס שיחת תיאום
          <span className="text-[10px]">· בקרוב</span>
        </button>
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
  const [people, setPeople] = useState([]);
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false); // collapsed by default
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  useEffect(() => {
    api.people
      .list()
      .then((r) => setPeople((r.people || []).filter((p) => p.status !== 'blocked')))
      .catch(() => {});
  }, []);

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

  const assignedIds = useMemo(
    () => new Set((tour?.assignments || []).map((a) => a.personRefId).filter(Boolean)),
    [tour],
  );
  const availablePeople = people.filter((p) => !assignedIds.has(p.id));

  async function addAssignment(personRefId, role = 'guide') {
    if (!personRefId) return;
    setBusy(true);
    try {
      await api.tours.addAssignment(id, { personRefId, role });
      await refresh();
    } catch (e) {
      alert(
        e.payload?.error === 'already_assigned'
          ? 'איש הצוות כבר משובץ לסיור הזה.'
          : 'שגיאה: ' + (e.payload?.error || e.message),
      );
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(a, role) {
    if (role === a.role) return;
    setBusy(true);
    try {
      await api.tours.updateAssignment(a.id, { role });
      await refresh();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }

  async function removeAssignment(a) {
    setBusy(true);
    try {
      await api.tours.removeAssignment(a.id);
      await refresh();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }

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
  const sortedAssignments = [...(tour?.assignments || [])].sort(
    (a, b) => ASSIGNMENT_ROLES.indexOf(a.role) - ASSIGNMENT_ROLES.indexOf(b.role),
  );
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
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-gray-600">
                    <Chip styles={TOUR_KIND_STYLES[tour.kind]} label={TOUR_KIND_LABELS[tour.kind] || tour.kind} />
                    <Chip styles={TOUR_STATUS_STYLES[tour.status]} label={TOUR_STATUS_LABELS[tour.status] || tour.status} />
                    <span className="font-semibold text-gray-800">{fmtTourDate(tour.date)}</span>
                    <span dir="ltr" className="tabular-nums">{tour.startTime}</span>
                    {tour.tourLanguage && <span>· {TOUR_LANG_LABELS[tour.tourLanguage]}</span>}
                    <span dir="ltr">
                      · 👥 {tour.activeSeats}{tour.capacity != null ? ` / ${tour.capacity}` : ''}
                    </span>
                    {over && <span className="font-bold text-red-600">חריגה</span>}
                    <span className="text-gray-400">· {sortedAssignments.length} מדריכים</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {/* Approved placeholder — tour-level form. */}
                  <button
                    type="button"
                    disabled
                    title="בקרוב"
                    className="hidden cursor-not-allowed rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] text-gray-400 sm:inline-block"
                  >
                    טופס סיכום סיור
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
              {/* Assigned team — compact chips + add. */}
              <Section title="צוות משובץ">
                <div className="flex flex-wrap items-center gap-2">
                  {sortedAssignments.map((a) => (
                    <GuideChip key={a.id} a={a} busy={busy} onRoleChange={changeRole} onRemove={removeAssignment} />
                  ))}
                  <AddGuideButton people={availablePeople} onPick={addAssignment} busy={busy} />
                  {sortedAssignments.length === 0 && (
                    <span className="text-[13px] text-gray-400">עדיין לא שובצו מדריכים — הוסיפו עם +</span>
                  )}
                </div>
              </Section>

              {/* Participants — one card per booking, stacked vertically. */}
              <Section title="משתתפים" count={relevantBookings.length}>
                {relevantBookings.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-center text-[13px] text-gray-400">
                    {isSlot ? 'עדיין לא שובצו דילים לסיור — שיבוץ נעשה מדיל קבוצתי ב-WON.' : 'אין הזמנות פעילות.'}
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {relevantBookings.map((b) => (
                      <CustomerCard key={b.id} booking={b} navigate={navigate} />
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
                    <TimelineFeed subjectType="tour_event" subjectId={tour.id} />
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </div>

      <TourSlotModal open={editOpen} tour={tour} onClose={() => setEditOpen(false)} onSaved={refresh} />

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
