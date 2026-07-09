import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
  fmtTourDate,
} from './config.js';

// Tour page — the operational workspace of ONE TourEvent: key facts, guide
// assignments (role on the assignment, easy switching), and the customer
// panel. Customer data is READ-THROUGH from each booking's Deal — this page
// owns execution (assignments, status, operational notes); planning belongs
// to the Deal (private/business) or the slot (group, edited here).
// "טופס שיחת תיאום" / "טופס סיכום סיור" are approved placeholders.

const dash = <span className="text-gray-400">—</span>;

function Chip({ styles, label }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${styles}`}>
      {label}
    </span>
  );
}

// Resolve the customer panel's contacts from the deal's DealContact links:
// ordering contact = the primary link; field representative = the fieldRep
// role, FALLING BACK to the primary contact (product rule).
function resolveCustomerContacts(dealContacts) {
  const links = dealContacts || [];
  const primary = links.find((l) => l.isPrimary) || links[0] || null;
  const fieldRep = links.find((l) => (l.roles || []).includes('fieldRep')) || primary;
  return { primary, fieldRep };
}

function ContactLine({ label, link }) {
  if (!link?.contact) {
    return (
      <div className="flex items-baseline gap-2 text-sm">
        <span className="w-24 shrink-0 text-[12px] text-gray-500">{label}</span>
        {dash}
      </div>
    );
  }
  const c = link.contact;
  const phone = c.phones?.[0]?.value;
  const email = c.emails?.[0]?.value;
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
      <span className="w-24 shrink-0 text-[12px] text-gray-500">{label}</span>
      <span className="font-medium text-gray-900">{contactNameHe(c)}</span>
      {phone && (
        <a href={`tel:${phone}`} dir="ltr" className="tabular-nums text-blue-700 hover:underline">
          {phone}
        </a>
      )}
      {email && (
        <a href={`mailto:${email}`} dir="ltr" className="text-blue-700 hover:underline break-all">
          {email}
        </a>
      )}
    </div>
  );
}

// One booking = one customer card (group tours show several).
function CustomerCard({ booking, navigate }) {
  const [infoOpen, setInfoOpen] = useState(false);
  const deal = booking.deal;
  if (!deal) return null;
  const { primary, fieldRep } = resolveCustomerContacts(deal.contacts);
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3.5">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => navigate(dealPath(deal))}
          className="min-w-0 text-right"
          title="פתיחת הדיל"
        >
          <div className="truncate text-[15px] font-semibold text-gray-900 hover:text-blue-700">
            {deal.title}
            {deal.orderNo && (
              <span dir="ltr" className="ms-1 tabular-nums text-[13px] text-gray-400">#{deal.orderNo}</span>
            )}
          </div>
          <div className="text-[13px] text-gray-500">
            {deal.organization?.name || 'לקוח פרטי'}
            {deal.organizationUnit?.name && ` · ${deal.organizationUnit.name}`}
          </div>
        </button>
        <div className="shrink-0 text-left">
          <div className="text-[13px] tabular-nums text-gray-700" dir="ltr">
            {booking.seats} 👥
          </div>
          {booking.status !== 'active' && (
            <span className="text-[11px] font-semibold text-amber-600">
              {booking.status === 'orphaned' ? 'orphan' : 'בוטל'}
            </span>
          )}
        </div>
      </div>
      <div className="mt-2.5 space-y-1.5 border-t border-gray-100 pt-2.5">
        <ContactLine label="איש קשר מזמין" link={primary} />
        <ContactLine label="נציג בשטח" link={fieldRep} />
      </div>
      {deal.customerInfo && (
        <div className="mt-2.5 border-t border-gray-100 pt-2">
          <button
            type="button"
            onClick={() => setInfoOpen((o) => !o)}
            className="flex w-full items-center justify-between text-[13px] font-semibold text-gray-700 hover:text-gray-900"
          >
            <span>מידע חשוב על הלקוח</span>
            <span className="text-gray-400 text-xs">{infoOpen ? '▾' : '▸'}</span>
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

function AssignmentRow({ a, onRoleChange, onRemove, busy }) {
  const gone = !a.personRef;
  return (
    <div
      className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 ${
        a.role === 'lead_guide' ? 'border-indigo-200 bg-indigo-50/50' : 'border-gray-200 bg-white'
      }`}
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
          a.role === 'lead_guide' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'
        }`}
        aria-hidden
      >
        {(a.personRef?.displayName || a.displayName || '?').slice(0, 1)}
      </span>
      <div className="min-w-0 flex-1">
        <div className={`truncate text-sm ${a.role === 'lead_guide' ? 'font-bold text-gray-900' : 'font-medium text-gray-800'}`}>
          {a.personRef?.displayName || a.displayName}
          {gone && <span className="ms-1 text-[11px] text-gray-400">(הוסר מהצוות)</span>}
        </div>
        <Chip styles={ASSIGNMENT_ROLE_STYLES[a.role]} label={ASSIGNMENT_ROLE_LABELS[a.role] || a.role} />
      </div>
      <select
        value={a.role}
        disabled={busy}
        onChange={(e) => onRoleChange(a, e.target.value)}
        title="החלפת תפקיד"
        className="h-8 rounded-lg border border-gray-300 bg-white px-2 text-[12px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
      >
        {ASSIGNMENT_ROLES.map((r) => (
          <option key={r} value={r}>{ASSIGNMENT_ROLE_LABELS[r]}</option>
        ))}
      </select>
      <button
        type="button"
        disabled={busy}
        onClick={() => onRemove(a)}
        title="הסרת השיבוץ"
        className="h-8 w-8 rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
      >
        ✕
      </button>
    </div>
  );
}

export default function TourPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tour, setTour] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [people, setPeople] = useState([]);
  const [addPersonId, setAddPersonId] = useState('');
  const [addRole, setAddRole] = useState('guide');
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null); // 'cancel' | 'restore' | 'delete'

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

  const assignedIds = useMemo(
    () => new Set((tour?.assignments || []).map((a) => a.personRefId).filter(Boolean)),
    [tour],
  );
  const availablePeople = people.filter((p) => !assignedIds.has(p.id));

  async function addAssignment() {
    if (!addPersonId) return;
    setBusy(true);
    try {
      await api.tours.addAssignment(id, { personRefId: addPersonId, role: addRole });
      setAddPersonId('');
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

  async function runConfirmAction() {
    const type = confirmAction;
    setConfirmAction(null);
    try {
      if (type === 'delete') {
        await api.tours.remove(id);
        navigate('/admin/tours');
        return;
      }
      await api.tours.update(id, { status: type === 'cancel' ? 'cancelled' : 'scheduled' });
      await refresh();
    } catch (e) {
      const code = e.payload?.error;
      alert(
        code === 'tour_has_active_bookings'
          ? 'לא ניתן לבטל סיור עם דילים פעילים — יש להסיר או להעביר אותם קודם.'
          : code === 'tour_has_bookings'
            ? 'לא ניתן למחוק סיור שיש לו הזמנות — ניתן רק לבטל אותו.'
            : 'שגיאה: ' + (code || e.message),
      );
    }
  }

  if (loading) return <div className="p-8 text-sm text-gray-400">טוען…</div>;
  if (error)
    return (
      <div className="p-8 text-sm text-red-600">
        שגיאה: <span dir="ltr" className="font-mono">{error}</span>
      </div>
    );
  if (!tour) return null;

  const city = tour.location?.nameHe || tour.productVariant?.location?.nameHe;
  const isSlot = tour.kind === 'group_slot';
  const relevantBookings = (tour.bookings || []).filter((b) => b.status !== 'cancelled');
  const sortedAssignments = [...(tour.assignments || [])].sort(
    (a, b) => ASSIGNMENT_ROLES.indexOf(a.role) - ASSIGNMENT_ROLES.indexOf(b.role),
  );

  return (
    <div className="mx-auto max-w-[1200px] px-5 lg:px-8 py-4">
      {/* Header */}
      <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-4 lg:p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => navigate('/admin/tours')}
              className="mb-1 text-[12px] text-gray-400 hover:text-gray-600"
            >
              → כל הסיורים
            </button>
            <h1 className="flex flex-wrap items-center gap-2.5 text-xl lg:text-2xl font-bold tracking-tight text-gray-900">
              <span aria-hidden>🧭</span>
              {tour.product?.nameHe || 'סיור'}
              {city && <span className="font-medium text-gray-500">· {city}</span>}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-gray-700">
              <Chip styles={TOUR_KIND_STYLES[tour.kind]} label={TOUR_KIND_LABELS[tour.kind] || tour.kind} />
              <Chip styles={TOUR_STATUS_STYLES[tour.status]} label={TOUR_STATUS_LABELS[tour.status] || tour.status} />
              <span className="font-semibold">{fmtTourDate(tour.date)}</span>
              <span dir="ltr" className="tabular-nums">{tour.startTime}</span>
              {tour.tourLanguage && <span className="text-gray-500">· {TOUR_LANG_LABELS[tour.tourLanguage]}</span>}
              <span className="text-gray-500" dir="ltr">
                · {tour.activeSeats}{tour.capacity != null ? ` / ${tour.capacity}` : ''} 👥
              </span>
              {tour.capacity != null && tour.activeSeats > tour.capacity && (
                <span className="text-[12px] font-bold text-red-600">חריגה מהקיבולת</span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {/* Approved placeholders — no functionality yet. */}
            <button type="button" disabled title="בקרוב"
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] text-gray-400 cursor-not-allowed">
              טופס שיחת תיאום <span className="text-[10px]">· בקרוב</span>
            </button>
            <button type="button" disabled title="בקרוב"
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] text-gray-400 cursor-not-allowed">
              טופס סיכום סיור <span className="text-[10px]">· בקרוב</span>
            </button>
            {isSlot && tour.status !== 'cancelled' && (
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50"
              >
                ✎ עריכה
              </button>
            )}
            {tour.status === 'scheduled' && (
              <button
                type="button"
                onClick={() => setConfirmAction('cancel')}
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[12px] font-semibold text-red-700 hover:bg-red-100"
              >
                בטל סיור
              </button>
            )}
            {tour.status === 'cancelled' && (
              <button
                type="button"
                onClick={() => setConfirmAction('restore')}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50"
              >
                ↩ החזר לתכנון
              </button>
            )}
            {tour.totalBookings === 0 && (
              <button
                type="button"
                onClick={() => setConfirmAction('delete')}
                className="rounded-lg border border-red-200 px-3 py-1.5 text-[12px] font-semibold text-red-600 hover:bg-red-50"
              >
                🗑 מחיקה
              </button>
            )}
          </div>
        </div>
        {!isSlot && (
          <p className="mt-2 text-[12px] text-gray-400">
            שדות התכנון (תאריך, שעה, מוצר, עיר, שפה) של סיור פרטי/עסקי נערכים בדיל — הדיל הוא מקור התכנון.
          </p>
        )}
        {tour.notes && (
          <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-[13px] text-gray-700">📝 {tour.notes}</p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Guide assignments */}
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-[15px] font-bold text-gray-900">שיבוץ מדריכים</h2>
          <div className="space-y-2">
            {sortedAssignments.length === 0 && (
              <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-center text-[13px] text-gray-400">
                עדיין לא שובצו מדריכים לסיור.
              </p>
            )}
            {sortedAssignments.map((a) => (
              <AssignmentRow key={a.id} a={a} busy={busy} onRoleChange={changeRole} onRemove={removeAssignment} />
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-3">
            <select
              value={addPersonId}
              onChange={(e) => setAddPersonId(e.target.value)}
              className="h-9 flex-1 rounded-lg border border-gray-300 bg-white px-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
            >
              <option value="">— בחר איש צוות —</option>
              {availablePeople.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                  {p.lifecycleHint === 'trainee' ? ' (מתלמד)' : ''}
                </option>
              ))}
            </select>
            <select
              value={addRole}
              onChange={(e) => setAddRole(e.target.value)}
              className="h-9 rounded-lg border border-gray-300 bg-white px-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
            >
              {ASSIGNMENT_ROLES.map((r) => (
                <option key={r} value={r}>{ASSIGNMENT_ROLE_LABELS[r]}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={!addPersonId || busy}
              onClick={addAssignment}
              className="h-9 rounded-lg bg-blue-600 px-3.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
            >
              שבץ
            </button>
          </div>
        </section>

        {/* Customer panel — one card per (non-cancelled) booking. */}
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-[15px] font-bold text-gray-900">
            לקוחות והזמנות
            {relevantBookings.length > 1 && (
              <span className="ms-1.5 text-[12px] font-medium text-gray-400">({relevantBookings.length} דילים)</span>
            )}
          </h2>
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
        </section>
      </div>

      {/* Tour timeline — lifecycle events + operational notes. */}
      <div className="mt-4">
        <TimelineFeed subjectType="tour_event" subjectId={tour.id} />
      </div>

      <TourSlotModal open={editOpen} tour={tour} onClose={() => setEditOpen(false)} onSaved={refresh} />

      <ConfirmDialog
        open={!!confirmAction}
        title={confirmAction === 'delete' ? 'מחיקת סיור' : confirmAction === 'restore' ? 'החזרת סיור לתכנון' : 'ביטול סיור'}
        body={
          confirmAction === 'delete'
            ? 'למחוק את הסיור? רק סיורים ריקים ניתנים למחיקה. לא ניתן לבטל פעולה זו.'
            : confirmAction === 'restore'
              ? 'להחזיר את הסיור לסטטוס מתוכנן?'
              : 'לבטל את הסיור? הסיור יישאר בהיסטוריה בסטטוס "בוטל".'
        }
        confirmLabel={confirmAction === 'delete' ? 'מחק' : confirmAction === 'restore' ? 'החזר' : 'בטל סיור'}
        danger={confirmAction !== 'restore'}
        onCancel={() => setConfirmAction(null)}
        onConfirm={runConfirmAction}
      />
    </div>
  );
}
