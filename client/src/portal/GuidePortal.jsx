import { useCallback, useEffect, useState } from 'react';
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
        navigate(`/attempt/${attemptId}`);
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
        {tasks.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="space-y-3">
            {tasks.map((task) => (
              <li key={task.id}>
                <TaskCard
                  task={task}
                  starting={startingId === task.id}
                  disabled={!!startingId && startingId !== task.id}
                  onOpen={() => handleOpen(task)}
                />
              </li>
            ))}
          </ul>
        )}
      </main>
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

function TaskCard({ task, starting, disabled, onOpen }) {
  const isCompleted = task.status === 'completed';
  const cta = ctaFor(task.status);
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      className={`w-full text-right bg-white border rounded-xl p-4 sm:p-5 transition shadow-sm flex gap-3 items-start ${
        isCompleted
          ? 'border-gray-200 opacity-90'
          : 'border-gray-200 hover:border-blue-300 active:bg-blue-50/50'
      } ${disabled ? 'opacity-50' : ''}`}
    >
      <TaskIcon type={task.type} status={task.status} />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
            {KIND_NOUN[task.type] || task.type}
          </span>
          {task.metadata?.mandatory && task.status !== 'completed' && (
            <span className="text-[10px] font-semibold bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded">
              חובה
            </span>
          )}
          {task.badge && (
            <span
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                task.badge.tone === 'warning'
                  ? 'bg-amber-100 text-amber-900'
                  : 'bg-gray-100 text-gray-700'
              }`}
            >
              {task.badge.label}
            </span>
          )}
        </div>
        <div className="text-base sm:text-lg font-semibold text-gray-900 leading-snug">
          {task.title}
        </div>
        {task.description && (
          <div className="text-sm text-gray-600 mt-1 line-clamp-2">
            {task.description}
          </div>
        )}
        <div className="mt-3 flex items-center justify-between">
          <StatusPill status={task.status} />
          {cta && (
            <span
              className={`text-sm font-semibold inline-flex items-center gap-1 ${
                isCompleted ? 'text-gray-600' : 'text-blue-700'
              }`}
            >
              {starting ? 'פותח…' : cta}
              {!starting && <span aria-hidden>‹</span>}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function ctaFor(status) {
  if (status === 'not_started') return 'התחל';
  if (status === 'in_progress') return 'המשך';
  if (status === 'completed') return 'צפה';
  return null;
}

function StatusPill({ status }) {
  const map = {
    not_started: { label: 'טרם התחיל', cls: 'bg-gray-100 text-gray-700' },
    in_progress: { label: 'בתהליך', cls: 'bg-amber-100 text-amber-900' },
    completed: { label: 'הושלם', cls: 'bg-green-100 text-green-800' },
  };
  const m = map[status] || map.not_started;
  return (
    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${m.cls}`}>
      {m.label}
    </span>
  );
}

function TaskIcon({ type, status }) {
  const ring =
    status === 'completed'
      ? 'bg-green-50 text-green-700 border-green-200'
      : status === 'in_progress'
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-blue-50 text-blue-700 border-blue-200';
  const glyph = type === 'procedure' ? '📋' : '•';
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
