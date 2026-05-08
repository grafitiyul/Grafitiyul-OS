import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

// Admin sign-in page. Single-form, single-purpose. Mounted at
// /admin/login OUTSIDE the AdminGuard so an unauthenticated user can
// actually reach it. The guard redirects here with `?returnTo=<path>`;
// successful login navigates back to that path (defaulting to /admin).
//
// On mount we ping /api/auth/status to short-circuit the form when
// the user already has a valid session — typical case is a refresh
// after login, or an admin who hits /admin/login from a bookmark.
// Without this, that user would have to re-enter credentials they
// already have a valid cookie for.
export default function AdminLogin() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get('returnTo') || '/admin';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [bootChecked, setBootChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/status', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          if (data?.authenticated) {
            navigate(safeReturnTo(returnTo), { replace: true });
            return;
          }
        }
      } catch {
        /* fall through to manual login */
      } finally {
        if (!cancelled) setBootChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        navigate(safeReturnTo(returnTo), { replace: true });
        return;
      }
      if (res.status === 401) {
        setError('שם משתמש או סיסמה שגויים');
      } else if (res.status === 500) {
        const data = await res.json().catch(() => null);
        setError(
          data?.message ||
            'השרת לא מוגדר עדיין לאימות מנהל — בדוק את משתני הסביבה.',
        );
      } else {
        setError(`שגיאה (${res.status})`);
      }
    } catch (err) {
      setError(err?.message || 'שגיאת רשת');
    } finally {
      setBusy(false);
    }
  }

  if (!bootChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500 text-sm">
        טוען…
      </div>
    );
  }

  return (
    <div
      dir="rtl"
      className="min-h-screen bg-gray-50 flex items-center justify-center p-4"
    >
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm w-full max-w-sm p-6">
        <div className="text-[12px] uppercase tracking-wide text-gray-500 mb-1">
          Grafitiyul OS
        </div>
        <h1 className="text-xl font-semibold text-gray-900 mb-1">
          כניסת מנהל
        </h1>
        <p className="text-[12px] text-gray-500 mb-5">
          רק עורכי תוכן ומאשרים. מדריכים ניגשים ישירות לקישור הפורטל
          האישי שלהם.
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-1">
              שם משתמש
            </span>
            <input
              autoFocus
              dir="ltr"
              type="text"
              autoComplete="username"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-1">
              סיסמה
            </span>
            <input
              dir="ltr"
              type="password"
              autoComplete="current-password"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </label>
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-800 rounded-md p-2 text-sm">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={busy || !username.trim() || !password}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-md py-2.5 text-base font-semibold disabled:opacity-50"
          >
            {busy ? 'מתחבר…' : 'כניסה'}
          </button>
        </form>
      </div>
    </div>
  );
}

// Don't let an attacker craft a `returnTo` that escapes the SPA — only
// allow paths that start with `/`, never absolute URLs (`http://`, `//`,
// or scheme-relative). Falls back to /admin for anything suspicious.
function safeReturnTo(raw) {
  if (typeof raw !== 'string') return '/admin';
  if (!raw.startsWith('/')) return '/admin';
  if (raw.startsWith('//')) return '/admin';
  return raw;
}
