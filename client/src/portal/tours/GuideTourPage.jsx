import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import {
  ACTIVITY_LABELS,
  ROLE_LABELS,
  ROLE_STYLES,
  TOUR_LANG_LABELS,
  fmtDayLineHe,
  isToday,
  participantsLabel,
} from '../format.js';
import { FeedError } from './feedStates.jsx';
// ONE participant-card presentation, shared with the admin Tour modal —
// hierarchy, typography and spacing (incl. the customerInfo tight face).
import ParticipantCardView from '../../tours/ParticipantCardView.jsx';
import ProductBreakdown from '../../tours/ProductBreakdown.jsx';
import FormActionButton from '../../questionnaire/FormActionButton.jsx';
import QuestionnaireFillDialog from '../../questionnaire/QuestionnaireFillDialog.jsx';

// Guide Tour Detail — the read-only operational view of ONE tour, mirroring
// the Admin Tour modal's hierarchy (header → team → components → workshop
// locations → participants) but adapted for guides:
//   * everything comes from the guide detail DTO (server permission-gated)
//   * no edit controls anywhere, no History, no CRM/commercial data
//   * the Deal order number is an internal CRM identifier — admin-only,
//     deliberately NOT rendered here (the DTO still ships it by contract)
// The "סיכום סיור" section (summary questionnaire + gallery) is appended by
// Slice D; until then the gallery keeps a plain entry row.

export default function GuideTourPage() {
  const { token, person, permissions } = useOutletContext();
  const { tourEventId } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState({ phase: 'loading' });
  const [sectionStatus, setSectionStatus] = useState(null); // summary-status payload

  const apiBase = `/api/portal/${encodeURIComponent(token)}/tours/${encodeURIComponent(tourEventId)}`;

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setState({ phase: 'loading' });
      try {
        const res = await fetch(`${apiBase}/detail`, { cache: 'no-store' });
        if (res.status === 403 || res.status === 404) {
          // Access revoked (assignment removed) — replace the page even on a
          // SILENT refresh. Nothing of the tour may stay visible.
          return setState({ phase: 'blocked' });
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setState({ phase: 'ready', tour: await res.json() });
      } catch (e) {
        // Transient network failure on a silent refresh keeps the last good
        // data; the next poll retries. Loud loads surface the error.
        if (!silent) setState({ phase: 'error', message: e?.message || 'שגיאה' });
      }
    },
    [apiBase],
  );

  const loadSectionStatus = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/summary-status`, { cache: 'no-store' });
      if (res.ok) setSectionStatus(await res.json());
    } catch {
      /* fails quiet — the section renders without status chips */
    }
  }, [apiBase]);

  useEffect(() => {
    load();
    loadSectionStatus();
    window.scrollTo(0, 0);
  }, [load, loadSectionStatus]);

  // Live revalidation — an admin removing this guide's assignment must make
  // the tour disappear WITHOUT a manual reload: poll softly and re-check on
  // focus/visibility (same convention as the feeds).
  useEffect(() => {
    const t = setInterval(() => load({ silent: true }), 45000);
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        load({ silent: true });
        loadSectionStatus();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
    };
  }, [load, loadSectionStatus]);

  if (state.phase === 'loading') {
    return <div className="py-10 text-center text-sm text-gray-500">טוען…</div>;
  }
  if (state.phase === 'blocked') {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
        <div className="mb-2 text-3xl">🔒</div>
        <div className="text-sm text-gray-600">
          הסיור אינו זמין — ייתכן שאינך משובץ לסיור זה.
        </div>
        <button
          type="button"
          onClick={() => navigate(`/p/${encodeURIComponent(token)}`)}
          className="mt-3 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"
        >
          חזרה לסיורים
        </button>
      </div>
    );
  }
  if (state.phase === 'error') return <FeedError message={state.message} onRetry={load} />;

  const tour = state.tour;
  // Read-only: show a workshop row ONLY when a real location is assigned. The
  // DTO already pre-filters to located workshops; this guards defensively so a
  // future/loosened payload can never surface an empty row or placeholder.
  const workshopLocations = (tour.workshopLocations || []).filter((w) => w.location);

  return (
    <div>
      <BackRow token={token} title={tour.variantName} />

      {/* Cancelled tours never render — the server 403s them and the
          silent revalidation flips this page to the blocked state. */}
      <HeaderCard tour={tour} />

      {tour.team && tour.team.length > 0 && (
        <SectionCard title="הצוות בסיור">
          <div className="space-y-2.5">
            {tour.team.map((m) => (
              <TeamRow key={m.id} member={m} isMe={m.displayName === person?.displayName} />
            ))}
          </div>
        </SectionCard>
      )}

      {(tour.components || []).length > 0 && (
        <SectionCard title="מרכיבי הפעילות">
          <div className="flex flex-wrap gap-1.5">
            {tour.components.map((c) => (
              <ComponentChip key={c.id} component={c} />
            ))}
          </div>
        </SectionCard>
      )}

      {workshopLocations.length > 0 && (
        <SectionCard title="מיקומי סדנאות">
          <div className="space-y-2.5">
            {workshopLocations.map((w) => (
              <WorkshopLocationRow key={w.id} component={w} />
            ))}
          </div>
        </SectionCard>
      )}

      <SectionCard title={`משתתפים · ${participantsLabel(tour.participantsTotal)}`}>
        {/* Grouped aggregate (product → ticket types) — same shared renderer +
            server DTO as the admin tour modal. */}
        {tour.participantBreakdown?.byProduct?.length ? (
          <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50/60 p-3">
            <ProductBreakdown byProduct={tour.participantBreakdown.byProduct} />
          </div>
        ) : null}
        {(tour.participants || []).length === 0 ? (
          <div className="py-2 text-center text-sm text-gray-500">
            אין עדיין נרשמים לסיור.
          </div>
        ) : (
          <div className="space-y-3">
            {tour.participants.map((p) => (
              <ParticipantCard
                key={p.bookingId}
                participant={p}
                coordinationEnabled={permissions.useCoordinationForms}
                apiBase={apiBase}
              />
            ))}
          </div>
        )}
        {(tour.provisionalParticipants || []).length > 0 && (
          <div className="mt-4 space-y-3">
            <div className="text-[12.5px] font-medium text-gray-400">שריון בהמתנה לאישור</div>
            {tour.provisionalParticipants.map((p) => (
              <HeldParticipantCard key={p.registrationId} participant={p} />
            ))}
          </div>
        )}
      </SectionCard>

      <TourSummarySection
        token={token}
        tour={tour}
        apiBase={apiBase}
        permissions={permissions}
        status={sectionStatus}
        onStatusChange={loadSectionStatus}
      />
    </div>
  );
}

// ── סיכום סיור — summary questionnaire + gallery, one dedicated card ─

function TourSummarySection({ token, tour, apiBase, permissions, status, onStatusChange }) {
  const [summaryOpen, setSummaryOpen] = useState(false);

  const showSummary = permissions.fillTourSummary;
  const showGallery = permissions.useTourGallery;
  if (!showSummary && !showGallery) return null;

  const gallery = status?.gallery;
  const galleryCountLabel = gallery
    ? [
        gallery.imageCount > 0 ? `${gallery.imageCount} תמונות` : null,
        gallery.videoCount > 0 ? `${gallery.videoCount} סרטונים` : null,
      ]
        .filter(Boolean)
        .join(' · ') || 'הגלריה ריקה'
    : null;

  // Guide transport — same fill dialog, portal-token endpoints. The server
  // resolves the submission from (tour, purpose); no ids from the client.
  const transport = {
    load: () => portalJson(`${apiBase}/summary`),
    saveAnswers: (_id, answers) =>
      portalJson(`${apiBase}/summary/answers`, {
        method: 'PUT',
        body: JSON.stringify({ answers }),
      }),
    submit: (_id, answers) =>
      portalJson(`${apiBase}/summary/submit`, {
        method: 'POST',
        body: JSON.stringify({ answers }),
      }),
    voidSubmission: () => portalJson(`${apiBase}/summary/void`, { method: 'POST' }),
    uploadAnswerFile: async (file) => {
      const res = await fetch(
        `${apiBase}/summary/upload?filename=${encodeURIComponent(file.name)}`,
        { method: 'POST', cache: 'no-store', body: file },
      );
      if (!res.ok) throw await portalError(res);
      return res.json();
    },
  };

  return (
    <SectionCard title="סיכום סיור">
      <div className="space-y-2.5">
        {showSummary && (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 text-[13.5px] text-gray-700">טופס סיכום סיור</div>
            <FormActionButton
              label={
                status?.summary?.status === 'draft'
                  ? 'המשך מילוי'
                  : status?.summary
                  ? 'פתיחת הטופס'
                  : 'מילוי הטופס'
              }
              status={status?.summary?.status || null}
              onClick={() => setSummaryOpen(true)}
            />
          </div>
        )}
        {showGallery && (
          <div className="flex items-center justify-between gap-2 border-t border-gray-100 pt-2.5 first:border-t-0 first:pt-0">
            <div className="min-w-0 text-[13.5px] text-gray-700">
              גלריית תמונות וסרטונים
              {galleryCountLabel && (
                <span className="ms-1 text-[12px] text-gray-400">· {galleryCountLabel}</span>
              )}
            </div>
            <Link
              to={`/p/${encodeURIComponent(token)}/tour/${encodeURIComponent(tour.id)}/gallery`}
              className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-[12.5px] font-semibold text-indigo-800 shadow-sm active:scale-[0.99]"
            >
              <span aria-hidden>📸</span>
              פתיחת הגלריה
            </Link>
          </div>
        )}
      </div>
      {summaryOpen && (
        <QuestionnaireFillDialog
          open={summaryOpen}
          onClose={() => {
            setSummaryOpen(false);
            onStatusChange?.();
          }}
          title="טופס סיכום סיור"
          transport={transport}
          adminLinks={false}
          onStatusChange={() => onStatusChange?.()}
        />
      )}
    </SectionCard>
  );
}

async function portalError(res) {
  const text = await res.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    /* not json */
  }
  const err = new Error(`${res.status} ${text}`);
  err.status = res.status;
  err.payload = payload;
  return err;
}

async function portalJson(url, options = {}) {
  const res = await fetch(url, {
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw await portalError(res);
  return res.json();
}

function BackRow({ token, title }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Link
        to={`/p/${encodeURIComponent(token)}`}
        aria-label="חזרה לסיורים"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg text-gray-500 active:bg-gray-100"
      >
        →
      </Link>
      <h1 className="min-w-0 flex-1 truncate text-[17px] font-bold text-gray-900">{title}</h1>
    </div>
  );
}

function HeaderCard({ tour }) {
  const today = isToday(tour.date) && tour.status !== 'cancelled';
  const facts = [
    {
      icon: '📅',
      label: (
        <>
          {fmtDayLineHe(tour.date)} ·{' '}
          <span dir="ltr" className="tabular-nums font-semibold">
            {tour.startTime}
          </span>
          {tour.durationHours ? ` · ${tour.durationHours} שעות` : ''}
        </>
      ),
    },
    tour.locationName && { icon: '📍', label: tour.locationName },
    TOUR_LANG_LABELS[tour.tourLanguage] && {
      icon: '🌐',
      label: TOUR_LANG_LABELS[tour.tourLanguage],
    },
    { icon: '👥', label: participantsLabel(tour.participantsTotal) },
  ].filter(Boolean);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        {today && (
          <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[11px] font-bold text-white">
            היום
          </span>
        )}
        {ACTIVITY_LABELS[tour.activityType] && (
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
            {ACTIVITY_LABELS[tour.activityType]}
          </span>
        )}
        {ROLE_LABELS[tour.viewerRole] && (
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              ROLE_STYLES[tour.viewerRole] || 'bg-gray-100 text-gray-700'
            }`}
          >
            התפקיד שלך: {ROLE_LABELS[tour.viewerRole]}
          </span>
        )}
      </div>
      <div className="mt-3 space-y-1.5">
        {facts.map((f, i) => (
          <div key={i} className="flex items-center gap-2 text-[13.5px] text-gray-700">
            <span className="w-5 text-center" aria-hidden>
              {f.icon}
            </span>
            <span className="min-w-0">{f.label}</span>
          </div>
        ))}
      </div>
      {tour.notes && (
        <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[13px] leading-relaxed text-amber-900">
          <span className="font-semibold">הערות: </span>
          {tour.notes}
        </div>
      )}
    </div>
  );
}

function SectionCard({ title, children }) {
  return (
    <section className="mt-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-[13px] font-bold text-gray-500">{title}</h2>
      {children}
    </section>
  );
}

// ── team ─────────────────────────────────────────────────────────────

function TeamRow({ member, isMe }) {
  return (
    <div className="flex items-center gap-3">
      {member.imageUrl ? (
        <img
          src={member.imageUrl}
          alt=""
          className="h-10 w-10 shrink-0 rounded-full border border-gray-200 object-cover"
        />
      ) : (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm font-semibold text-gray-500">
          {(member.displayName || '?').slice(0, 1)}
        </div>
      )}
      <div className="min-w-0 flex-1 text-[14px] font-medium text-gray-900">
        {member.displayName}
        {isMe && <span className="ms-1 text-[11px] font-semibold text-blue-600">(את/ה)</span>}
      </div>
      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
          ROLE_STYLES[member.role] || 'bg-gray-100 text-gray-700'
        }`}
      >
        {ROLE_LABELS[member.role] || member.role}
      </span>
    </div>
  );
}

// ── activity components ──────────────────────────────────────────────

// Tone map — static class strings (Tailwind can't see dynamic names).
const COMPONENT_TONES = {
  emerald: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  blue: 'bg-blue-50 text-blue-800 border-blue-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  rose: 'bg-rose-50 text-rose-800 border-rose-200',
  violet: 'bg-violet-50 text-violet-800 border-violet-200',
  cyan: 'bg-cyan-50 text-cyan-800 border-cyan-200',
  slate: 'bg-slate-50 text-slate-800 border-slate-200',
};

function ComponentChip({ component }) {
  const tone = COMPONENT_TONES[component.color] || COMPONENT_TONES.slate;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12.5px] font-semibold ${tone}`}
    >
      {component.icon && <span aria-hidden>{component.icon}</span>}
      {component.nameHe}
    </span>
  );
}

// ── workshop locations ───────────────────────────────────────────────

function WorkshopLocationRow({ component }) {
  const loc = component.location;
  if (!loc) return null; // defensive — the section only passes located rows
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5">
      <div className="text-[12px] font-semibold text-gray-500">
        {component.icon && <span aria-hidden>{component.icon} </span>}
        {component.nameHe}
      </div>
      <div className="mt-0.5 text-[14px] font-semibold text-gray-900">{loc.nameHe}</div>
      {loc.address && <div className="text-[12.5px] text-gray-600">{loc.address}</div>}
      {loc.instructions && (
        <div className="mt-1 text-[12.5px] leading-relaxed text-gray-600">{loc.instructions}</div>
      )}
    </div>
  );
}

// ── participants ─────────────────────────────────────────────────────

// A conditional (HELD) reservation — "probably coming, not yet confirmed". The
// server DTO already strips phone/email/coordination, so this card reuses the
// shared presentation with those omitted and adds the "עוד לא סופי" badge. No
// contact/coordination affordance can appear (nothing to render).
function HeldParticipantCard({ participant: p }) {
  return (
    <ParticipantCardView
      customerName={p.customerName || p.title}
      organizationLine={p.title && p.title !== p.customerName ? p.title : ''}
      seats={p.seats}
      byProduct={p.byProduct}
      corner={
        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
          {p.badge || 'עוד לא סופי'}
        </span>
      }
      customerInfo={p.customerInfo}
    />
  );
}

function ParticipantCard({ participant: p, coordinationEnabled, apiBase }) {
  const [coordOpen, setCoordOpen] = useState(false);
  const [coordStatus, setCoordStatus] = useState(p.coordinationStatus || null);

  // Internal operational questionnaire — opens the SAME staff fill dialog the
  // Tour Summary uses, over portal-token endpoints. No public link, no popup.
  const coordBase = `${apiBase}/bookings/${encodeURIComponent(p.bookingId)}/coordination`;
  const coordTransport = {
    load: () => portalJson(coordBase),
    saveAnswers: (_id, answers) =>
      portalJson(`${coordBase}/answers`, {
        method: 'PUT',
        body: JSON.stringify({ answers }),
      }),
    submit: (_id, answers) =>
      portalJson(`${coordBase}/submit`, {
        method: 'POST',
        body: JSON.stringify({ answers }),
      }),
    voidSubmission: () => portalJson(`${coordBase}/void`, { method: 'POST' }),
    uploadAnswerFile: async (file) => {
      const res = await fetch(`${coordBase}/upload?filename=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        cache: 'no-store',
        body: file,
      });
      if (!res.ok) throw await portalError(res);
      return res.json();
    },
  };

  // Presentation-only inversion of the DTO's title precedence: the DTO ships
  // title = organization || customer (unchanged contract); the card hierarchy
  // is customer first, organization beneath — identical to the admin card.
  const customerName = p.customerName || p.title;
  const organizationLine =
    p.title && p.title !== p.customerName
      ? [p.title, p.organizationUnit].filter(Boolean).join(' · ')
      : p.organizationUnit || 'לקוח פרטי';

  return (
    // Shared presentation (one visual source of truth with the admin card).
    // Portal-only choices: no identity link (no Deal access from the portal),
    // no Deal number in the corner (internal CRM identifier, admin-only).
    <ParticipantCardView
      customerName={customerName}
      organizationLine={organizationLine}
      seats={p.seats}
      byProduct={p.byProduct}
      phone={p.phone}
      email={p.email}
      fieldRepName={p.fieldRepName}
      customerInfo={p.customerInfo}
      corner={
        coordinationEnabled ? (
          <FormActionButton
            label="טופס שיחת תיאום"
            status={coordStatus}
            onClick={() => setCoordOpen(true)}
          />
        ) : null
      }
    >
      {coordOpen && (
        <QuestionnaireFillDialog
          open={coordOpen}
          onClose={() => setCoordOpen(false)}
          title="טופס שיחת תיאום"
          transport={coordTransport}
          adminLinks={false}
          onStatusChange={(s) => setCoordStatus(s || null)}
        />
      )}
    </ParticipantCardView>
  );
}
