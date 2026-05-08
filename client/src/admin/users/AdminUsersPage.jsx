import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { relativeHebrew } from '../../lib/relativeTime.js';
import Dialog from '../common/Dialog.jsx';
import ConfirmDialog from '../common/ConfirmDialog.jsx';

// Admin user management. Sits at /admin/users behind AdminGuard.
//
// Capabilities:
//   * List active + inactive admins.
//   * Create a new admin (username + password + confirm).
//   * Change an existing user's password.
//   * Activate / deactivate. The server enforces the "last active
//     admin" rail; the UI mirrors it (disabled button + tooltip) so
//     the failure isn't a surprise.
//
// Deletion is intentionally out of scope for this slice — deactivate
// is enough and avoids the audit-trail complications of a real
// delete.

export default function AdminUsersPage() {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [pwTarget, setPwTarget] = useState(null);
  const [confirmActive, setConfirmActive] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api.adminUsers.list();
      setUsers(data.users || []);
      setError(null);
    } catch (e) {
      setError(e?.message || 'שגיאה בטעינה');
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const activeCount = (users || []).filter((u) => u.isActive).length;

  return (
    <div className="bg-gray-50 min-h-full">
      <header className="bg-white border-b border-gray-200 px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-0.5">
              ניהול מערכת
            </div>
            <h1 className="text-xl font-semibold text-gray-900">
              משתמשים
            </h1>
            <div className="text-[12px] text-gray-500 mt-0.5">
              משתמשים פנימיים שיכולים להיכנס לאזור הניהול. ניתן לערוך
              סיסמה ולהשבית, אך לא להשבית את המנהל הפעיל האחרון.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="px-3 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md"
          >
            + מנהל חדש
          </button>
        </div>
      </header>

      <div className="p-5 max-w-3xl">
        {error && (
          <div className="mb-3 bg-red-50 border border-red-200 text-red-800 rounded-md p-2 text-sm">
            {error}
          </div>
        )}
        {users === null ? (
          <div className="text-gray-500 text-sm">טוען…</div>
        ) : users.length === 0 ? (
          <div className="text-gray-500 text-sm">אין עדיין משתמשי מנהל.</div>
        ) : (
          <ul className="space-y-2">
            {users.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                onChangePassword={() => setPwTarget(u)}
                onToggleActive={() => setConfirmActive(u)}
                lastActiveBlock={u.isActive && activeCount <= 1}
              />
            ))}
          </ul>
        )}
      </div>

      {createOpen && (
        <CreateUserDialog
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            refresh();
          }}
        />
      )}

      {pwTarget && (
        <ChangePasswordDialog
          user={pwTarget}
          onClose={() => setPwTarget(null)}
          onChanged={() => {
            setPwTarget(null);
            refresh();
          }}
        />
      )}

      <ConfirmDialog
        open={!!confirmActive}
        title={
          confirmActive?.isActive ? 'השבתת משתמש' : 'הפעלת משתמש מחדש'
        }
        body={
          confirmActive?.isActive
            ? `האם להשבית את ${confirmActive?.username}? המשתמש לא יוכל להתחבר עד להפעלה מחדש.`
            : `האם להפעיל מחדש את ${confirmActive?.username}? המשתמש יוכל להתחבר שוב.`
        }
        confirmLabel={confirmActive?.isActive ? 'השבת' : 'הפעל'}
        cancelLabel="ביטול"
        danger={confirmActive?.isActive}
        onCancel={() => setConfirmActive(null)}
        onConfirm={async () => {
          if (!confirmActive) return;
          try {
            await api.adminUsers.setActive(
              confirmActive.id,
              !confirmActive.isActive,
            );
            setConfirmActive(null);
            refresh();
          } catch (e) {
            setError(
              e?.payload?.message ||
                e?.message ||
                'שגיאה בעדכון מצב המשתמש',
            );
            setConfirmActive(null);
          }
        }}
      />
    </div>
  );
}

function UserRow({ user, onChangePassword, onToggleActive, lastActiveBlock }) {
  return (
    <li className="bg-white border border-gray-200 rounded-lg px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span
            dir="ltr"
            className="font-semibold text-gray-900 text-base"
          >
            {user.username}
          </span>
          <span className="text-[11px] font-medium bg-gray-100 text-gray-700 rounded-full border border-gray-200 px-2 py-0.5">
            {user.role || 'admin'}
          </span>
          {user.isActive ? (
            <span className="text-[11px] font-medium bg-green-100 text-green-800 rounded-full border border-green-200 px-2 py-0.5">
              פעיל
            </span>
          ) : (
            <span className="text-[11px] font-medium bg-gray-100 text-gray-600 rounded-full border border-gray-200 px-2 py-0.5">
              מושבת
            </span>
          )}
        </div>
        <div className="text-[12px] text-gray-500 mt-1">
          {user.lastLoginAt
            ? `כניסה אחרונה ${relativeHebrew(user.lastLoginAt)}`
            : 'טרם התחבר'}
          {' · '}
          נוצר {relativeHebrew(user.createdAt)}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onChangePassword}
          className="text-[13px] border border-gray-300 hover:bg-gray-50 rounded-md px-3 py-1.5"
        >
          שנה סיסמה
        </button>
        <button
          type="button"
          onClick={onToggleActive}
          disabled={lastActiveBlock}
          title={
            lastActiveBlock
              ? 'לא ניתן להשבית את המנהל הפעיל האחרון'
              : undefined
          }
          className={`text-[13px] rounded-md px-3 py-1.5 ${
            user.isActive
              ? 'border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-40'
              : 'border border-green-300 text-green-800 hover:bg-green-50'
          }`}
        >
          {user.isActive ? 'השבת' : 'הפעל'}
        </button>
      </div>
    </li>
  );
}

function CreateUserDialog({ onClose, onCreated }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const usernameOk = username.trim().length >= 3;
  const passwordLongEnough = password.length >= 10;
  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const canSubmit =
    !busy && usernameOk && passwordLongEnough && passwordsMatch;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await api.adminUsers.create({
        username: username.trim(),
        password,
        confirmPassword,
      });
      onCreated();
    } catch (e) {
      setError(
        e?.payload?.message || e?.message || 'שגיאה ביצירת המשתמש',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={busy ? null : onClose}
      title="יצירת מנהל חדש"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-sm border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40"
          >
            ביטול
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="text-sm bg-blue-600 hover:bg-blue-700 text-white rounded px-3 py-1.5 disabled:opacity-40"
          >
            {busy ? 'יוצר…' : 'צור משתמש'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="block text-sm font-medium text-gray-700 mb-1">
            שם משתמש
          </span>
          <input
            autoFocus
            dir="ltr"
            type="text"
            autoComplete="off"
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
          show={showPw}
          onToggleShow={() => setShowPw((v) => !v)}
          disabled={busy}
          hint={passwordLongEnough ? null : 'לפחות 10 תווים.'}
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
      </div>
    </Dialog>
  );
}

function ChangePasswordDialog({ user, onClose, onChanged }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const longEnough = newPassword.length >= 10;
  const match = newPassword.length > 0 && newPassword === confirmPassword;
  const canSubmit = !busy && longEnough && match;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await api.adminUsers.changePassword(user.id, {
        newPassword,
        confirmPassword,
      });
      onChanged();
    } catch (e) {
      setError(
        e?.payload?.message || e?.message || 'שגיאה בעדכון הסיסמה',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={busy ? null : onClose}
      title={`שינוי סיסמה — ${user.username}`}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-sm border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40"
          >
            ביטול
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="text-sm bg-blue-600 hover:bg-blue-700 text-white rounded px-3 py-1.5 disabled:opacity-40"
          >
            {busy ? 'שומר…' : 'עדכן סיסמה'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <PasswordField
          label="סיסמה חדשה"
          autoComplete="new-password"
          value={newPassword}
          onChange={setNewPassword}
          show={showPw}
          onToggleShow={() => setShowPw((v) => !v)}
          disabled={busy}
          hint={longEnough ? null : 'לפחות 10 תווים.'}
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
            confirmPassword.length === 0 || match
              ? null
              : 'הסיסמאות לא זהות.'
          }
          hintTone={
            confirmPassword.length === 0 || match ? 'muted' : 'error'
          }
        />
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-md p-2 text-sm">
            {error}
          </div>
        )}
      </div>
    </Dialog>
  );
}

// Local copy of the password field used by AdminLogin. Kept here
// rather than refactored into a shared module because the two call
// sites have slightly different label/hint conventions and a shared
// component would have to grow extra props for both. Three of these
// total in the codebase — fine to live with the duplication for now.
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
