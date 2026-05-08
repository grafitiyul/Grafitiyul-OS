import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

// Guide Portal — token-gated, mobile-first task feed.
//
// V1 only renders procedure tasks, but the UI is built around a generic
// `Task` shape returned by the server, so future task types
// (training_plan, tour, feedback, payment) drop into the same list
// without UI changes — only `iconForType` and the click handler need
// new branches when their runtime arrives.
//
// Auth: the URL token IS the credential. There's no login form.
// Server enforces `portalEnabled` and returns 403 if disabled.

const KIND_NOUN = {
  procedure: 'נוהל',
  // training_plan: 'מערך הדרכה',
  // tour: 'סיור',
  // feedback: 'משוב',
  // payment: 'תשלום',
};

export default function GuidePortal() {
  const { token } = useParams();
  const navigate = useNavigate();

  const [state, setState] = useState({ phase: 'loading' });
  const [startingId, setStartingId] = useState(null);
  const [startError, setStartError] = useState(null);

  // Stash the portal token in sessionStorage so the runtime's home
  // button can recover it when the user lands on /attempt/:id without
  // the ?p query param — typical cases: a runtime URL bookmarked from
  // before this slice deployed, or a manual refresh that drops the
  // query for whatever reason. URL stays the primary source of truth
  // for bookmarkability; sessionStorage is the tab-scoped fallback.
  useEffect(() => {
    if (!token) return;
    try {
      sessionStorage.setItem('gos.portalToken', token);
    } catch {
      /* private mode / disabled storage — ignore, URL still works */
    }
  }, [token]);

  const load = useCallback(async () => {
    setState({ phase: 'loading' });
    try {
      const res = await fetch(`/api/portal/${encodeURIComponent(token)}`, {
        cache: 'no-store',
      });
      if (res.status === 404) {
        setState({ phase: 'not_found' });
        return;
      }
      if (res.status === 403) {
        setState({ phase: 'disabled' });
        return;
      }
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status} ${txt}`);
      }
      const data = await res.json();
      // Diagnostic — easy way to confirm in DevTools whether the
      // server is returning the new 5-bucket model. If every task
      // has bucket: 'done' (the old name), the server is stale and
      // we'll fall through the compatibility map below; if buckets
      // are correct, any visibility issue is purely client/CSS.
      try {
        // eslint-disable-next-line no-console
        console.log(
          '[guide portal] tasks',
          (data?.tasks || []).map((t) => ({
            id: t.id,
            bucket: t.bucket,
            status: t.status,
            rejectedCount: t.metadata?.rejectedCount || 0,
          })),
        );
      } catch {
        /* ignore */
      }
      setState({ phase: 'ready', data });
    } catch (e) {
      setState({ phase: 'error', message: e?.message || 'שגיאה' });
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  // Update the tab title with the guide's name once loaded.
  useEffect(() => {
    if (state.phase === 'ready') {
      const name = state.data?.person?.displayName;
      document.title = name ? `${name} · גרפיתי-יול` : 'גרפיתי-יול';
    } else {
      document.title = 'גרפיתי-יול';
    }
  }, [state]);

  const handleOpen = useCallback(
    async (task) => {
      // Only procedure tasks have a runtime today. Future task types
      // dispatch on `task.type` here.
      if (task.type !== 'procedure') return;
      if (startingId) return; // double-tap guard
      setStartError(null);
      setStartingId(task.id);
      try {
        const res = await fetch(
          `/api/portal/${encodeURIComponent(token)}/tasks/${encodeURIComponent(task.id)}/start`,
          { method: 'POST', cache: 'no-store' },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { attemptId } = await res.json();
        if (!attemptId) throw new Error('missing_attempt_id');
        // Carry the portal token through to the attempt URL so the
        // runtime's home button knows where to return. Query param
        // (RESTful, bookmark-safe) avoids needing sessionStorage.
        navigate(`/attempt/${attemptId}?p=${encodeURIComponent(token)}`);
      } catch (e) {
        setStartError(e?.message || 'שגיאה בפתיחת הנוהל');
        setStartingId(null);
      }
    },
    [token, navigate, startingId],
  );

  if (state.phase === 'loading') return <CenteredMessage text="טוען…" />;
  if (state.phase === 'not_found') return <NotFoundScreen />;
  if (state.phase === 'disabled') return <DisabledScreen />;
  if (state.phase === 'error') {
    return (
      <CenteredMessage
        text="שגיאה בטעינת המסך."
        sub={state.message}
        onRetry={load}
      />
    );
  }

  const { person, tasks } = state.data;
  return (
    <div
      className="min-h-screen bg-gray-50"
      dir="rtl"
      data-page="guide-portal"
    >
      <Header displayName={person?.displayName} />
      <main className="max-w-2xl mx-auto px-3 sm:px-6 py-4 sm:py-6 pb-12">
        {startError && (
          <div className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
            {startError}
          </div>
        )}
        <Sections
          tasks={tasks}
          startingId={startingId}
          onOpen={handleOpen}
        />
      </main>
    </div>
  );
}

// ── Section grouping ──────────────────────────────────────────────
//
// Tasks come back from the server already tagged with a `bucket`:
//   todo      — needs the guide's attention (in-progress + mandatory
//                not-started + corrections-required)
//   available — visible but optional and untouched (the "shelf")
//   done      — completed from the guide's POV (waiting / approved)
//
// Empty sections are hidden so the page stays compact. If ALL three
// are empty, we fall back to the EmptyState — that's the case where
// the guide has nothing visible at all (no published flows reach them).
//
// Five sections matching the server's 5-bucket task model. Order is
// deliberate: the first thing the guide should see is anything that's
// blocked on them ("דורש תיקון"), then their open queue, then optional
// reading material, then status feedback for what's already submitted.
const SECTIONS = [
  {
    key: 'correction',
    title: 'דורש תיקון',
    subtitle: 'נהלים שהמאשר ביקש מכם לתקן — דורש פעולה',
    accent: 'red',
  },
  {
    key: 'todo',
    title: 'לביצוע',
    subtitle: 'נהלים שמחכים לכם להתחיל או להמשיך',
  },
  {
    key: 'available',
    title: 'זמינות לקריאה',
    subtitle: 'נהלים פתוחים — אפשר לעיין בכל זמן',
  },
  {
    key: 'pending_review',
    title: 'ממתין לבדיקה',
    subtitle: 'תשובות שנשלחו וממתינות לאישור המאשר',
  },
  {
    key: 'approved',
    title: 'אושר',
    subtitle: 'נהלים שאושרו — תיעוד שהשלמתם',
  },
];

// Legacy-server-compatibility shim. If the server hasn't redeployed
// yet (e.g., Railway still has the previous build), the response
// will still carry the old 3-bucket model: `todo`, `available`,
// `done`. This map upgrades each task in place so the new sectioned
// UI works regardless of which server is live. Fields used:
//   - task.bucket    — server's bucket label
//   - task.status    — coarse status the old model returned
//   - task.badge     — the old model put rejection/pending hints here
function resolveBucket(task) {
  const b = task.bucket;
  if (
    b === 'correction' ||
    b === 'todo' ||
    b === 'available' ||
    b === 'pending_review' ||
    b === 'approved'
  ) {
    return b;
  }
  // Old server: `done` lumped both pending_review and approved.
  // Disambiguate via the badge text the old server set.
  if (b === 'done') {
    if (task.badge?.label === 'ממתין לאישור') return 'pending_review';
    return 'approved';
  }
  // Old server: `todo` could include needs-correction (warning badge).
  // We need to lift those out so they show under דורש תיקון.
  if (b === 'todo' && task.badge?.tone === 'warning') return 'correction';
  return b || 'todo';
}

function Sections({ tasks, startingId, onOpen }) {
  const grouped = useMemo(() => {
    const out = {
      correction: [],
      todo: [],
      available: [],
      pending_review: [],
      approved: [],
    };
    for (const t of tasks) {
      const b = resolveBucket(t);
      // Normalise task.bucket to the resolved value so per-bucket
      // card styling (border, ring, CTA) matches the section it's
      // rendered in even when the server returned a legacy bucket.
      const normalised = t.bucket === b ? t : { ...t, bucket: b };
      (out[b] || out.todo).push(normalised);
    }
    return out;
  }, [tasks]);

  const totalVisible = SECTIONS.reduce(
    (n, s) => n + (grouped[s.key]?.length || 0),
    0,
  );
  if (totalVisible === 0) return <EmptyState />;

  return (
    <div className="space-y-6">
      {SECTIONS.map((s) => {
        const items = grouped[s.key];
        if (!items || items.length === 0) return null;
        const titleColor =
          s.accent === 'red' ? 'text-red-800' : 'text-gray-900';
        return (
          <section key={s.key}>
            <div className="px-1 mb-2">
              <h2 className={`text-sm font-bold ${titleColor}`}>
                {s.title}
                <span className="ms-2 text-[11px] font-medium text-gray-500">
                  ({items.length})
                </span>
              </h2>
              <div className="text-[11px] text-gray-500">{s.subtitle}</div>
            </div>
            <ul className="space-y-3">
              {items.map((task) => (
                <li key={task.id}>
                  <TaskCard
                    task={task}
                    starting={startingId === task.id}
                    disabled={!!startingId && startingId !== task.id}
                    onOpen={() => onOpen(task)}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Header({ displayName }) {
  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
      <div className="max-w-2xl mx-auto px-4 py-3 sm:py-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center font-semibold text-sm shrink-0">
          {(displayName || '?').slice(0, 1)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] text-gray-500 leading-tight">
            שלום
          </div>
          <div className="font-semibold text-gray-900 truncate text-base sm:text-lg">
            {displayName || 'אורח'}
          </div>
        </div>
      </div>
    </header>
  );
}

// Per-bucket card styling. Cards re-use the same base layout but the
// bucket controls the border tint, the icon ring, the status pill,
// and the CTA copy/color.
function bucketStyle(bucket) {
  switch (bucket) {
    case 'correction':
      return {
        border: 'border-red-300 hover:border-red-400 active:bg-red-50/50',
        ring: 'bg-red-50 text-red-700 border-red-200',
        statusLabel: 'דורש תיקון',
        statusCls: 'bg-red-100 text-red-800',
        cta: 'תקן תשובה',
        ctaCls: 'text-red-700',
      };
    case 'pending_review':
      return {
        border: 'border-gray-200',
        ring: 'bg-amber-50 text-amber-700 border-amber-200',
        statusLabel: 'ממתין לבדיקה',
        statusCls: 'bg-amber-100 text-amber-900',
        cta: 'צפה',
        ctaCls: 'text-gray-600',
      };
    case 'approved':
      return {
        border: 'border-gray-200',
        ring: 'bg-green-50 text-green-700 border-green-200',
        statusLabel: 'אושר',
        statusCls: 'bg-green-100 text-green-800',
        cta: 'צפה',
        ctaCls: 'text-gray-600',
      };
    case 'available':
      return {
        border: 'border-gray-200 hover:border-blue-300 active:bg-blue-50/50',
        ring: 'bg-blue-50 text-blue-700 border-blue-200',
        statusLabel: 'זמין',
        statusCls: 'bg-gray-100 text-gray-700',
        cta: 'התחל',
        ctaCls: 'text-blue-700',
      };
    case 'todo':
    default:
      return {
        border: 'border-gray-200 hover:border-blue-300 active:bg-blue-50/50',
        ring: 'bg-blue-50 text-blue-700 border-blue-200',
        statusLabel: 'בתהליך',
        statusCls: 'bg-blue-100 text-blue-800',
        cta: 'המשך',
        ctaCls: 'text-blue-700',
      };
  }
}

// Decide CTA text from bucket + whether the attempt has been started.
// `bucketStyle` returns the default; this overrides it for the
// not-yet-started case in the `todo` bucket.
function ctaForTask(task, style) {
  if (task.bucket === 'todo' && !task.metadata?.attemptId) return 'התחל';
  return style.cta;
}

function TaskCard({ task, starting, disabled, onOpen }) {
  const bucket = task.bucket || 'todo';
  const style = bucketStyle(bucket);
  const cta = ctaForTask(task, style);
  const isCompleted =
    bucket === 'approved' || bucket === 'pending_review';
  const isCorrection = bucket === 'correction';
  const rejectionComment = task.metadata?.rejectionComment;
  const rejectedCount = task.metadata?.rejectedCount || 0;

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      className={`w-full text-right bg-white border rounded-xl p-4 sm:p-5 transition shadow-sm flex gap-3 items-start ${style.border} ${
        isCompleted ? 'opacity-95' : ''
      } ${disabled ? 'opacity-50' : ''}`}
    >
      <TaskIcon type={task.type} ring={style.ring} bucket={bucket} />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
            {KIND_NOUN[task.type] || task.type}
          </span>
          {task.metadata?.mandatory && !isCompleted && (
            <span className="text-[10px] font-semibold bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded">
              חובה
            </span>
          )}
        </div>
        <div className="text-base sm:text-lg font-semibold text-gray-900 leading-snug">
          {task.title}
        </div>
        {task.description && !isCorrection && (
          <div className="text-sm text-gray-600 mt-1 line-clamp-2">
            {task.description}
          </div>
        )}

        {/* Correction surface — only on cards that need fixing. We
            show the most recent admin comment so the guide knows what
            to address before tapping in. The runtime ResubmitScreen
            still owns the full per-question flow once they tap. */}
        {isCorrection && (
          <div className="mt-2 bg-red-50 border border-red-200 rounded-md p-2.5">
            <div className="text-[11px] font-bold text-red-800 mb-0.5">
              {rejectedCount > 1
                ? `${rejectedCount} שאלות נדחו ודורשות תיקון`
                : 'תשובה נדחתה ודורשת תיקון'}
            </div>
            {rejectionComment && (
              <div className="text-[12px] text-red-900 line-clamp-3 whitespace-pre-wrap">
                <span className="font-semibold">הערת מאשר: </span>
                {rejectionComment}
              </div>
            )}
          </div>
        )}

        <div className="mt-3 flex items-center justify-between">
          <span
            className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${style.statusCls}`}
          >
            {style.statusLabel}
          </span>
          {cta && (
            <span
              className={`text-sm font-semibold inline-flex items-center gap-1 ${style.ctaCls}`}
            >
              {starting ? 'פותח…' : cta}
              {/* SVG chevron — drawn explicitly so it doesn't get
                  mirrored or reordered by the bidi resolver. In RTL,
                  forward / proceed = LEFT, hence ChevronLeft. */}
              {!starting && <ChevronLeftCta />}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function TaskIcon({ type, ring, bucket }) {
  const glyph =
    bucket === 'correction'
      ? '⚠'
      : bucket === 'approved'
      ? '✓'
      : bucket === 'pending_review'
      ? '⏳'
      : type === 'procedure'
      ? '📋'
      : '•';
  return (
    <div
      className={`w-10 h-10 sm:w-11 sm:h-11 shrink-0 rounded-full border flex items-center justify-center text-lg ${ring}`}
      aria-hidden
    >
      {glyph}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
      <div className="text-4xl mb-3 opacity-50">📭</div>
      <div className="text-base font-semibold text-gray-800 mb-1">
        אין משימות פתוחות כרגע
      </div>
      <div className="text-sm text-gray-500">
        כשיהיו לך נהלים או משימות חדשות הם יופיעו כאן.
      </div>
    </div>
  );
}

function CenteredMessage({ text, sub, onRetry }) {
  return (
    <div
      className="min-h-screen bg-gray-50 flex items-center justify-center p-6"
      dir="rtl"
    >
      <div className="text-center max-w-sm">
        <div className="text-base text-gray-700">{text}</div>
        {sub && (
          <div className="text-[12px] text-gray-500 mt-1 font-mono" dir="ltr">
            {sub}
          </div>
        )}
        {onRetry && (
          <button
            onClick={onRetry}
            className="mt-3 text-sm border border-gray-300 rounded px-3 py-1.5 hover:bg-white"
          >
            נסה שוב
          </button>
        )}
      </div>
    </div>
  );
}

function NotFoundScreen() {
  return (
    <div
      className="min-h-screen bg-gray-50 flex items-center justify-center p-6"
      dir="rtl"
    >
      <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-sm w-full text-center">
        <div className="text-3xl mb-2">🔒</div>
        <div className="text-base font-semibold text-gray-900 mb-1">
          הקישור אינו תקף
        </div>
        <div className="text-sm text-gray-600">
          הקישור שגוי או פג. פנה למנהל לקבלת קישור מעודכן.
        </div>
      </div>
    </div>
  );
}

// Direction-explicit chevron — SVG, never mirrored by the bidi
// resolver. Used in the task card's "התחל / המשך" CTA.
function ChevronLeftCta() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      aria-hidden
    >
      <path
        d="M10 4l-4 4 4 4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DisabledScreen() {
  return (
    <div
      className="min-h-screen bg-gray-50 flex items-center justify-center p-6"
      dir="rtl"
    >
      <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-sm w-full text-center">
        <div className="text-3xl mb-2">⛔</div>
        <div className="text-base font-semibold text-gray-900 mb-1">
          הגישה לפורטל סגורה
        </div>
        <div className="text-sm text-gray-600">
          המנהל סגר את הגישה שלך לפורטל. ניתן לפנות אליו לפרטים נוספים.
        </div>
      </div>
    </div>
  );
}
