import { createContext, useContext } from 'react';

// Who is logged in — hydrated from the SAME /api/auth/status round-trip the
// AdminGuard already makes on shell mount (zero extra fetches). Used for
// per-operator client-side namespacing (e.g. recent-search history); it is
// NOT an authorization mechanism — the server enforces auth on every request.
const SessionUserContext = createContext({ username: '' });

export function SessionUserProvider({ username, children }) {
  return (
    <SessionUserContext.Provider value={{ username: username || '' }}>
      {children}
    </SessionUserContext.Provider>
  );
}

export function useSessionUser() {
  return useContext(SessionUserContext);
}
