import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import BrandMark from '../../brand/BrandMark.jsx';

// Admin sign-in page. Renders ONE of two forms based on a server-side
// "needsBootstrap" flag returned by /api/auth/status:
//
//   * needsBootstrap=true  → first-admin SetupForm (username + password
//     + confirm password). On success, the server creates the row,
//     hashes the password, and sets a session cookie — we redirect to
//     returnTo without a separate "now please log in" step.
//
//   * needsBootstrap=false → ordinary LoginForm.
//
// Both forms share the eye-toggle password field. The boot check
// also short-circuits when the visitor already has a valid session
// (refresh / bookmarked /admin/login while logged in).
export default function AdminLogin() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get('returnTo') || '/admin';

  const [phase, setPhase] = useState('booting');
  // 'booting' → 'login' (active admin exists) | 'setup' (no admin yet)
  // | 'misconfigured' (server can't sign sessions)

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/status', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (cancelled) return;
        if (!res.ok) {
          setPhase('login');
          return;
        }
        const data = await res.json();
        if (data?.authenticated) {
          navigate(safeReturnTo(returnTo), { replace: true });
          return;
        }
        setPhase(data?.needsBootstrap ? 'setup' : 'login');
      } catch {
        if (!cancelled) setPhase('login');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === 'booting') {
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
        {phase === 'setup' ? (
          <SetupForm
            returnTo={returnTo}
            onCreated={() => navigate(safeReturnTo(returnTo), { replace: true })}
            onAlreadyDone={() => setPhase('login')}
          />
        ) : (
          <LoginForm
            returnTo={returnTo}
            onAuthed={() => navigate(safeReturnTo(returnTo), { replace: true })}
          />
        )}
      </div>
    </div>
  );
}

// ── LoginForm ────────────────────────────────────────────────────
function LoginForm({ onAuthed }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

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
        onAuthed();
        return;
      }
      if (res.status === 401) {
        setError('שם משתמש או סיסמה שגויים');
      } else if (res.status === 500) {
        const data = await res.json().catch(() => null);
        if (data?.error === 'auth_misconfigured') {
          setError('ההתחברות עדיין לא הוגדרה בשרת');
        } else {
          setError('שגיאה בשרת');
        }
      } else {
        setError(`שגיאה (${res.status})`);
      }
    } catch (err) {
      setError(err?.message || 'שגיאת רשת');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex justify-center mb-4">
        <BrandMark className="h-20 w-auto" />
      </div>
      <h1 className="text-xl font-semibold text-gray-900 mb-1">כניסת מנהל</h1>
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
        <PasswordField
          label="סיסמה"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          show={showPassword}
          onToggleShow={() => setShowPassword((v) => !v)}
          disabled={busy}
        />
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
    </>
  );
}

// ── SetupForm ────────────────────────────────────────────────────
//
// Shown once per install — when the AdminUser table has no active
// rows. POST /api/auth/setup creates the user, hashes the password,
// and returns 201 with a session cookie already set, so we can jump
// straight into /admin without a separate login round-trip.
function SetupForm({ onCreated, onAlreadyDone }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Client-side gates that don't require a round-trip. The server
  // re-validates everything (single source of truth) but blocking
  // the obvious cases up front gives nicer feedback.
  const usernameOk = username.trim().length >= 3;
  const passwordLongEnough = password.length >= 10;
  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const canSubmit =
    !busy && usernameOk && passwordLongEnough && passwordsMatch;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password,
          confirmPassword,
        }),
      });
      if (res.ok) {
        onCreated();
        return;
      }
      if (res.status === 403) {
        // Someone else (or another tab) finished setup between our
        // boot check and our submit. Bounce to the regular login form.
        onAlreadyDone();
        return;
      }
      if (res.status === 400) {
        const data = await res.json().catch(() => null);
        setError(data?.message || 'נתונים לא תקינים');
      } else if (res.status === 500) {
        const data = await res.json().catch(() => null);
        if (data?.error === 'auth_misconfigured') {
          setError('ההתחברות עדיין לא הוגדרה בשרת');
        } else {
          setError('שגיאה בשרת');
        }
      } else {
        setError(`שגיאה (${res.status})`);
      }
    } catch (err) {
      setError(err?.message || 'שגיאת רשת');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex justify-center mb-4">
        <BrandMark className="h-20 w-auto" />
      </div>
      <h1 className="text-xl font-semibold text-gray-900 mb-1">
        יצירת משתמש מנהל ראשון
      </h1>
      <p className="text-[12px] text-gray-500 mb-5">
        עוד לא קיים משתמש מנהל במערכת. הזן שם משתמש וסיסמה — אחרי שתיווצר
        ההגדרה הראשונה, הכניסה לאזור הניהול תהיה מוגנת בסיסמה.
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
          <span className="block text-[11px] text-gray-500 mt-1">
            לפחות 3 תווים. אותיות באנגלית, ספרות, נקודה, מקף או קו תחתון.
          </span>
        </label>
        <PasswordField
          label="סיסמה"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          show={showPassword}
          onToggleShow={() => setShowPassword((v) => !v)}
          disabled={busy}
          hint={
            passwordLongEnough
              ? null
              : 'לפחות 10 תווים — בחר משהו ארוך וייחודי.'
          }
        />
        <PasswordField
          label="אימות סיסמה"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          show={showConfirm}
          onToggleShow={() => setShowConfirm((v) => !v)}
          disabled={busy}
          hint={
            confirmPassword.length === 0 || passwordsMatch
              ? null
              : 'הסיסמאות לא זהות.'
          }
          hintTone={
            confirmPassword.length === 0 || passwordsMatch ? 'muted' : 'error'
          }
        />
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-md p-2 text-sm">
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-md py-2.5 text-base font-semibold disabled:opacity-50"
        >
          {busy ? 'יוצר…' : 'צור מנהל וכניסה'}
        </button>
      </form>
    </>
  );
}

// ── PasswordField ────────────────────────────────────────────────
//
// Shared input + eye-toggle. Used by both LoginForm and SetupForm so
// the toggle behavior, RTL anchoring, and accessibility labels stay
// in one place.
function PasswordField({
  label,
  autoComplete,
  value,
  onChange,
  show,
  onToggleShow,
  disabled,
  hint,
  hintTone = 'muted',
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-gray-700 mb-1">
        {label}
      </span>
      <div className="relative">
        <input
          dir="ltr"
          type={show ? 'text' : 'password'}
          autoComplete={autoComplete}
          // ps-10 reserves space on the inline-start edge (LEFT in RTL)
          // for the toggle button, so long passwords don't slide under
          // the icon.
          className="w-full border border-gray-300 rounded-md ps-10 pe-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
        <button
          type="button"
          onClick={onToggleShow}
          tabIndex={-1}
          aria-label={show ? 'הסתר סיסמה' : 'הצג סיסמה'}
          title={show ? 'הסתר סיסמה' : 'הצג סיסמה'}
          className="absolute inset-y-0 start-0 flex items-center px-2 text-gray-500 hover:text-gray-800"
        >
          {show ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
      {hint && (
        <span
          className={`block text-[11px] mt-1 ${
            hintTone === 'error' ? 'text-red-700' : 'text-gray-500'
          }`}
        >
          {hint}
        </span>
      )}
    </label>
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

function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function EyeOffIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-6.5 0-10-7-10-7a18.4 18.4 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-3.16 4.19" />
      <path d="M14.12 14.12a3 3 0 0 1-4.24-4.24" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}
