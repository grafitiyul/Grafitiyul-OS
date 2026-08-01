import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

// THE WhatsApp sender model. Every surface that can send — Deal panel, Deal
// templates, scheduled WhatsApp tasks, Contact/Organization panels, payment
// links, operational notifications, staff broadcasts — reads which numbers
// exist and which one is selected from HERE. There is exactly one
// implementation on purpose: five screens each answering "which number?"
// differently is how a customer receives a message from the wrong business
// number.
//
// The selection is stored in localStorage, NOT on the server, and this is the
// important part: several office employees share one GOS login while each
// works from a different connected number. A per-USER server preference
// synchronised one employee's choice onto everyone else's screen. The choice
// belongs to the BROWSER, so it is never synchronised between people.
//
// Restoring is defensive: a remembered number that is no longer connected (or
// was retired entirely) is never honoured — falling back is always better than
// silently queueing messages on a dead number.

const STORAGE_KEY = 'gos-whatsapp-sender'; // { accountId }

// The accounts list is shared process-wide: several surfaces can be mounted at
// once (dock + template modal + task composer) and they must never disagree
// about which numbers exist, nor each fetch their own copy.
let cache = null;
let inflight = null;
const listeners = new Set();

const broadcast = () => { for (const l of listeners) l({ accounts: cache }); };

function loadAccounts(force = false) {
  if (cache && !force) return Promise.resolve(cache);
  if (!inflight) {
    // `api` is a NAMESPACED client (api.whatsapp.*, api.deals.* …) — it has no
    // generic api.get(path). Calling one threw TypeError at module load and
    // took the whole admin shell down with it (2026-08-01).
    inflight = api.whatsapp
      .connectedAccounts()
      .then((d) => {
        cache = Array.isArray(d?.accounts) ? d.accounts : [];
        return cache;
      })
      .catch(() => {
        // A failed lookup must not be cached as "there are no numbers" — that
        // would permanently blank every picker until a reload.
        return [];
      })
      .finally(() => { inflight = null; });
  }
  return inflight.then((v) => { broadcast(); return v; });
}

export function readRememberedAccountId() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const id = raw?.accountId;
    return id ? String(id) : null;
  } catch {
    return null;
  }
}

export function rememberAccountId(accountId) {
  try {
    if (accountId) localStorage.setItem(STORAGE_KEY, JSON.stringify({ accountId: String(accountId), at: new Date().toISOString() }));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable (private mode) — selection just won't persist */
  }
}

/** A number can be sent from only if it is connected AND addressable. */
export const isUsableAccount = (a) => !!a && a.connected !== false && a.bridgeConfigured !== false;

/**
 * THE resolver. Same order on every surface:
 *   1. what the operator picked in THIS surface (explicit)
 *   2. what this browser remembers, if that number is still usable
 *   3. a caller-supplied contextual hint (e.g. the number this customer's
 *      existing conversation lives on) — only used when nothing is remembered
 *   4. the first usable number
 *   5. the first number at all (so a fully disconnected system still names one)
 */
export function resolveAccountId(accounts, { explicit = null, remembered = null, hint = null } = {}) {
  const has = (id) => (id ? accounts.find((a) => a.id === id) : null);
  const explicitAccount = has(explicit);
  if (explicitAccount) return explicitAccount.id;
  const rememberedAccount = has(remembered);
  if (rememberedAccount && isUsableAccount(rememberedAccount)) return rememberedAccount.id;
  const hintAccount = has(hint);
  if (hintAccount) return hintAccount.id;
  const usable = accounts.find(isUsableAccount);
  if (usable) return usable.id;
  return accounts[0]?.id || null;
}

/**
 * Connected numbers + this browser's remembered choice.
 *
 * `select(id)` is the ONLY way the remembered account changes, and it takes
 * effect for every mounted surface at once (a broadcast, not a re-fetch), so
 * the dock and the template modal can never show different senders.
 */
export function useConnectedAccounts() {
  const [accounts, setAccounts] = useState(cache || []);
  const [remembered, setRemembered] = useState(readRememberedAccountId);
  const [loaded, setLoaded] = useState(!!cache);

  useEffect(() => {
    const onChange = (s) => {
      setAccounts(s.accounts || []);
      setRemembered(readRememberedAccountId());
      setLoaded(true);
    };
    listeners.add(onChange);
    loadAccounts().then(() => setLoaded(true));
    return () => { listeners.delete(onChange); };
  }, []);

  // Another TAB of the same browser changing the number keeps this one honest.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY) setRemembered(readRememberedAccountId());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const select = useCallback((accountId) => {
    rememberAccountId(accountId);
    setRemembered(accountId || null);
    broadcast(); // every other mounted surface follows immediately
  }, []);

  return {
    accounts,
    loaded,
    remembered,
    select,
    reload: () => loadAccounts(true),
  };
}
