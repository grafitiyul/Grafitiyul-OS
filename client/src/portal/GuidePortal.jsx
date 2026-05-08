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
  // Correction-priority gate. When the guide taps המשך on a procedure
  // that has rejected answers, we DON'T just resume the attempt — we
  // first surface a small notice and ask for explicit confirmation.
  // The runtime will then enter correction mode at the first rejected
  // step (signalled via sessionStorage so the URL stays clean and
  // bookmarks don't accidentally re-trigger correction).
  const [correctionPrompt, setCorrectionPrompt] = useState(null);

  // Stash the portal token in BOTH session and local storage:
  //
  //   * sessionStorage — tab-scoped fallback for the runtime's home
  //     button when the user lands on /attempt/:id without the ?p
  //     query param.
  //   * localStorage   — persistent on the same origin. Helps the
  //     `/` Landing component when storage IS shared between browser
  //     and PWA. Belt-and-braces only: the AUTHORITATIVE persistence
  //     is the dynamic manifest below — it bakes the token directly
  //     into start_url, which the browser captures at install time
  //     and replays on every PWA launch. That works even on
  //     platforms where the installed PWA has its own isolated
  //     storage container (the original failure mode).
  useEffect(() => {
    if (!token) return;
    try {
      sessionStorage.setItem('gos.portalToken', token);
    } catch {
      /* ignore */
    }
    try {
      localStorage.setItem('gos.portalToken', token);
    } catch {
      /* ignore */
    }
  }, [token]);

  // Rewrite the document's <link rel="manifest"> href to a per-token
  // manifest URL while this page is mounted. When the user installs
  // the PWA from here ("Add to Home Screen", or the browser's install
  // prompt), the browser fetches the URL referenced by THIS link at
  // that moment — so the captured manifest carries
  // start_url=/launch?p=<token>. After installation, the icon launch
  // always opens /launch?p=<token>, and the Landing component
  // immediately routes the user back into their portal regardless of
  // PWA storage isolation.
  //
  // Cleanup restores the original href on unmount so that admins
  // navigating away from this guide page don't accidentally keep
  // capturing this token in a future install attempt.
  useEffect(() => {
    if (!token) return undefined;
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return undefined;
    const original = link.getAttribute('href') || '/manifest.webmanifest';
    link.setAttribute(
      'href',
      `/manifest.webmanifest?p=${encodeURIComponent(token)}`,
    );
    return () => {
      try {
        link.setAttribute('href', original);
      } catch {
        /* ignore — page is tearing down */
      }
    };
  }, [token]);

  // Two load modes:
  //   loud (default) — used on mount and explicit retry; toggles the
  //     'loading' phase so the page shows "טוען…".
  //   silent         — used by polling and by focus/visibility
  //     refresh; updates `state.data` in place without flashing the
  //     loading screen, so the user's scroll position and any open
  //     mid-tap state survive the refresh.
  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setState({ phase: 'loading' });
      try {
        const res = await fetch(`/api/portal/${encodeURIComponent(token)}`, {
          cache: 'no-store',
        });
        if (res.status === 404) {
          if (!silent) setState({ phase: 'not_found' });
          return;
        }
        if (res.status === 403) {
          if (!silent) setState({ phase: 'disabled' });
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
        setState((prev) =>
          silent && prev.phase !== 'ready'
            ? prev
            : { phase: 'ready', data },
        );
      } catch (e) {
        if (!silent) {
          setState({ phase: 'error', message: e?.message || 'שגיאה' });
        }
        // Silent failure on background refresh: keep showing the last
        // good data, the next poll will retry.
      }
    },
    [token],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Soft polling so admin reviews / new published flows surface
  // automatically. 15s matches the admin-side approvals poll. Also
  // refresh on focus/visibility so the guide who tabs back to the
  // portal sees current state without a manual reload.
  useEffect(() => {
    if (!token) return undefined;
    const t = setInterval(() => load({ silent: true }), 15000);
    const onVis = () => {
      if (document.visibilityState === 'visible') load({ silent: true });
    };
    const onFocus = () => load({ silent: true });
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
    };
  }, [token, load]);

  // Update the tab title with the guide's name once loaded.
  useEffect(() => {
    if (state.phase === 'ready') {
      const name = state.data?.person?.displayName;
      document.title = name ? `${name} · גרפיתי-יול` : 'גרפיתי-יול';
    } else {
      document.title = 'גרפיתי-יול';
    }
  }, [state]);

  const startTask = useCallback(
    async (task, { correctionMode = false } = {}) => {
      if (startingId) return;
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
        if (correctionMode) {
          // Tab-scoped flag — the runtime reads it on first load, jumps
          // to the first rejected step, then clears it. Per-attempt key
          // so opening a different attempt in another tab doesn't pick
          // up the same signal.
          try {
            sessionStorage.setItem(
              `gos.enterCorrection.${attemptId}`,
              '1',
            );
          } catch {
            /* private mode — runtime falls back to natural rendering */
          }
        }
        navigate(`/attempt/${attemptId}?p=${encodeURIComponent(token)}`);
      } catch (e) {
        setStartError(e?.message || 'שגיאה בפתיחת הנוהל');
        setStartingId(null);
      }
    },
    [token, navigate, startingId],
  );

  const handleOpen = useCallback(
    async (task) => {
      if (task.type !== 'procedure') return;
      if (startingId) return; // double-tap guard
      // Corrections take priority over normal continuation. If the
      // task has any rejected answers, we surface a confirmation
      // notice INSTEAD of immediately starting — the actual launch
      // happens after the guide picks "מעבר לתיקונים".
      const rejectedCount = task.metadata?.rejectedCount || 0;
      if (rejectedCount > 0) {
        setCorrectionPrompt({ task, rejectedCount });
        return;
      }
      startTask(task, { correctionMode: false });
    },
    [startingId, startTask],
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

  // Defensive destructuring — a server response that's missing
  // `tasks` (older schema, transient deploy artifact) shouldn't blow
  // up the page. EmptyState is the right outcome for that data.
  const person = state.data?.person || null;
  const tasks = Array.isArray(state.data?.tasks) ? state.data.tasks : [];
  return (
    <div
      className="min-h-screen bg-gray-50"
      dir="rtl"
      data-page="guide-portal"
    >
      <Header displayName={person?.displayName} token={token} />
      <main className="max-w-2xl mx-auto px-3 sm:px-6 py-4 sm:py-6 pb-12">
        {startError && (
          <div className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
            {startError}
          </div>
        )}
        <PortalSummary tasks={tasks} />
        <Sections
          tasks={tasks}
          startingId={startingId}
          onOpen={handleOpen}
        />
      </main>
      {correctionPrompt && (
        <CorrectionPrompt
          task={correctionPrompt.task}
          rejectedCount={correctionPrompt.rejectedCount}
          starting={startingId === correctionPrompt.task.id}
          onCancel={() => setCorrectionPrompt(null)}
          onConfirm={() => {
            const t = correctionPrompt.task;
            setCorrectionPrompt(null);
            startTask(t, { correctionMode: true });
          }}
          onSkip={() => {
            // "המשך ללמידה בכל זאת" — opens the runtime WITHOUT
            // setting the correction-mode flag, so the user lands on
            // the natural screen for the attempt's status (waiting /
            // approved / etc.) and can decide for themselves when to
            // pick up the corrections via the review-status modal.
            const t = correctionPrompt.task;
            setCorrectionPrompt(null);
            startTask(t, { correctionMode: false });
          }}
        />
      )}
    </div>
  );
}

// ── CorrectionPrompt ──────────────────────────────────────────────
//
// Bottom sheet (mobile) / centered modal (desktop) shown when the
// guide taps המשך on a procedure that has rejected answers. The
// notice is intentionally short — the goal is to set context, NOT
// to render a full task list. The detailed per-question correction
// happens inside the runtime once they confirm.
function CorrectionPrompt({
  task,
  rejectedCount,
  starting,
  onCancel,
  onConfirm,
  onSkip,
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div
        className="bg-white w-full sm:max-w-md rounded-t-xl sm:rounded-xl shadow-xl border border-gray-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-4 pb-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-red-100 text-red-700 text-base">
              ⚠
            </span>
            <h2 className="text-base font-semibold text-gray-900 flex-1">
              יש תיקונים ממתינים
            </h2>
            <button
              type="button"
              onClick={onCancel}
              disabled={starting}
              aria-label="סגור"
              className="text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded p-1"
            >
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden>
                <path
                  d="M3 3l10 10M13 3L3 13"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
          <div className="text-sm text-gray-700 leading-snug mb-2">
            לפני שממשיכים ב{task.title || 'נוהל זה'}, כדאי לתקן את{' '}
            <span className="font-bold text-red-700">{rejectedCount}</span>{' '}
            {rejectedCount === 1 ? 'התשובה שנדחתה' : 'התשובות שנדחו'}.
          </div>
          <div className="text-[12px] text-gray-600">
            התיקון יתבצע בתוך הנוהל הרגיל — תוכל לחזור אחורה לקרוא תוכן
            רלוונטי, לתקן את התשובה, ולחזור אחר כך למקום שעצרת.
          </div>
        </div>
        <div className="px-5 py-3 border-t border-gray-200 flex flex-col-reverse sm:flex-row sm:items-center gap-2">
          <button
            type="button"
            onClick={onSkip}
            disabled={starting}
            className="w-full sm:w-auto px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-md disabled:opacity-40"
          >
            המשך ללמידה בכל זאת
          </button>
          <div className="hidden sm:block flex-1" />
          <button
            type="button"
            onClick={onConfirm}
            disabled={starting}
            className="w-full sm:w-auto px-5 py-2.5 text-sm font-semibold bg-red-600 hover:bg-red-700 text-white rounded-md inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
          >
            {starting ? 'פותח…' : 'מעבר לתיקונים'}
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden>
              <path
                d="M10 4l-4 4 4 4"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
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
// carries the old 3-bucket model — `todo`, `available`, `done` —
// with rejection/pending state encoded in `task.badge`. We upgrade
// each task in place so the new sectioned UI works regardless of
// which server is currently live.
//
// IMPORTANT — order matters. The old server returns `bucket: 'todo'`
// AND `badge.tone: 'warning'` for needs-correction items. We MUST
// check that combination BEFORE accepting `todo` as the modern
// bucket; otherwise rejected items collapse into the regular לביצוע
// section and the admin's reject action never produces a visible
// דורש תיקון card.
function resolveBucket(task) {
  const b = task.bucket;
  // Old-server compatibility — must be evaluated first.
  if (b === 'todo' && task.badge?.tone === 'warning') return 'correction';
  if (b === 'done') {
    if (task.badge?.label === 'ממתין לאישור') return 'pending_review';
    return 'approved';
  }
  // Modern five-bucket model.
  if (
    b === 'correction' ||
    b === 'todo' ||
    b === 'available' ||
    b === 'pending_review' ||
    b === 'approved'
  ) {
    return b;
  }
  return 'todo';
}

// Compact 3-pill summary above the task list. Mirrors the per-attempt
// review-status bar in the runtime so the guide sees the same shape
// in both places. Counts are PROCEDURE-LEVEL here (not per-question):
// "ממתין" = procedures awaiting admin review, "אושר" = procedures
// fully approved, "לתיקון" = procedures with at least one rejected
// answer.
function PortalSummary({ tasks }) {
  let pending = 0;
  let approved = 0;
  let correction = 0;
  for (const t of tasks) {
    const b = resolveBucket(t);
    if (b === 'pending_review') pending += 1;
    else if (b === 'approved') approved += 1;
    else if (b === 'correction') correction += 1;
  }
  if (pending + approved + correction === 0) return null;
  return (
    <div
      className="mb-4 flex items-center gap-1.5 text-[12px] font-medium text-gray-700 bg-white border border-gray-200 rounded-md px-2.5 py-2 shadow-sm"
      role="status"
      aria-label="סיכום סטטוס נהלים"
    >
      <span className="text-[10px] uppercase tracking-wide text-gray-500">
        סיכום
      </span>
      <span className="flex-1" />
      <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-900 rounded-full px-2 py-0.5">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" aria-hidden />
        ממתין {pending}
      </span>
      <span className="inline-flex items-center gap-1 bg-green-100 text-green-900 rounded-full px-2 py-0.5">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500" aria-hidden />
        אושר {approved}
      </span>
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
          correction > 0
            ? 'bg-red-100 text-red-900'
            : 'bg-gray-100 text-gray-600'
        }`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            correction > 0 ? 'bg-red-500' : 'bg-gray-400'
          }`}
          aria-hidden
        />
        לתיקון {correction}
      </span>
    </div>
  );
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

function Header({ displayName, token }) {
  // Hide the install affordance once the page is already running in
  // a standalone PWA window — re-installing from inside a PWA isn't a
  // real use case and the button just adds visual noise. We compute
  // this once on first paint; the value can't change during the
  // session.
  const isStandalone =
    typeof window !== 'undefined' &&
    ((typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator?.standalone === true);
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
        {!isStandalone && token && (
          <a
            href={`/install-guide?p=${encodeURIComponent(token)}`}
            className="shrink-0 inline-flex items-center gap-1 text-[12px] font-medium border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md px-2.5 py-1.5"
            aria-label="התקן את האפליקציה"
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M12 3v12" />
              <path d="m7 10 5 5 5-5" />
              <path d="M5 21h14" />
            </svg>
            <span>התקן אפליקציה</span>
          </a>
        )}
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
  // Prominent prefix used by the correction-card to communicate the
  // count BEFORE the user enters runtime — matches the spec phrase
  // "X תיקונים נדרשים" so the visual cue lines up with the prompt
  // they'll see after they tap המשך.
  const correctionPrefixLabel =
    rejectedCount === 1 ? 'תיקון אחד נדרש' : `${rejectedCount} תיקונים נדרשים`;

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

        {/* Correction surface — only on cards that need fixing.
            Leads with the spec-mandated "X תיקונים נדרשים" so the
            count reads at a glance, then the most recent admin
            comment so the guide arrives at the runtime already
            knowing what to fix. The runtime correction-detour flow
            owns the actual per-question editing once they tap. */}
        {isCorrection && (
          <div className="mt-2 bg-red-50 border border-red-300 rounded-md p-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-600 text-white text-[11px] font-bold">
                !
              </span>
              <span className="text-[13px] font-bold text-red-800">
                {correctionPrefixLabel}
              </span>
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
