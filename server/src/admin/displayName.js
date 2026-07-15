// The ONE resolver for an admin's human-facing name.
//
// `AdminUser.displayName` is optional; `username` is the login handle and is
// always present. Every surface that shows a person MUST resolve through here
// so the fallback rule exists in exactly one place — otherwise half the app
// shows "dorko" and the other half shows "דור כהן".
//
// Pure: no Prisma import, no I/O. Takes whatever row shape you already loaded.

/**
 * @param {{ displayName?: string|null, username?: string|null }|null|undefined} user
 * @returns {string} the name to show. Empty string only if there is nothing at all.
 */
export function adminDisplayName(user) {
  if (!user) return '';
  const display = typeof user.displayName === 'string' ? user.displayName.trim() : '';
  if (display) return display;
  const username = typeof user.username === 'string' ? user.username.trim() : '';
  return username;
}

/**
 * The `select` every reader should use when it intends to render a name.
 * Keeps the two fields travelling together so a caller cannot accidentally
 * load `displayName` alone and lose the fallback.
 */
export const ADMIN_NAME_SELECT = Object.freeze({
  id: true,
  username: true,
  displayName: true,
});
