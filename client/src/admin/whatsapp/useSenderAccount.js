import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

// THE shared sender-account state.
//
// The preference is GLOBAL per operator, not per deal or per chat: picking the
// office number on one deal must still be selected on the next deal opened.
// That is why this hook keeps a module-level cache and broadcasts changes —
// two composers mounted at once must never disagree about who is sending.
//
// `mustChoose` is the honest state when several accounts are configured and the
// operator has never picked one. The server refuses to guess in that case, so
// the UI must ask rather than show a confident default that would be wrong.

let cache = null;                 // { accounts, preferred, resolved, mustChoose }
let inflight = null;
const listeners = new Set();

const broadcast = () => { for (const l of listeners) l(cache); };

async function load(force = false) {
  if (cache && !force) return cache;
  if (!inflight) {
    inflight = api.get('/api/whatsapp/sender-preference')
      .then((data) => { cache = data; return data; })
      .catch(() => { cache = { accounts: [], preferred: null, resolved: null, mustChoose: false }; return cache; })
      .finally(() => { inflight = null; });
  }
  const data = await inflight;
  broadcast();
  return data;
}

export function useSenderAccount() {
  const [state, setState] = useState(cache);

  useEffect(() => {
    listeners.add(setState);
    load();
    return () => { listeners.delete(setState); };
  }, []);

  const select = useCallback(async (accountId) => {
    // Optimistic: the picker must feel instant, and a failed write simply
    // leaves the previous preference in place on the next load.
    cache = { ...(cache || {}), preferred: accountId, resolved: accountId, mustChoose: false };
    broadcast();
    try {
      await api.put('/api/whatsapp/sender-preference', { accountId });
    } catch {
      await load(true);
    }
  }, []);

  const accounts = state?.accounts || [];
  return {
    accounts,
    // Only offer a picker when there is genuinely a choice to make.
    hasChoice: accounts.length > 1,
    accountId: state?.resolved || null,
    mustChoose: !!state?.mustChoose,
    select,
    reload: () => load(true),
  };
}
